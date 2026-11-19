package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"
)

// Each Store implementation must pass the same contract. The Postgres run
// needs KITCOUNT_TEST_DATABASE_URL pointing at a throwaway database.
func stores(t *testing.T) map[string]func(t *testing.T) Store {
	out := map[string]func(t *testing.T) Store{
		"memory": func(*testing.T) Store { return NewMemory() },
	}
	if url := os.Getenv("KITCOUNT_TEST_DATABASE_URL"); url != "" {
		out["postgres"] = func(t *testing.T) Store {
			ctx := context.Background()
			pg, err := OpenPostgres(ctx, url)
			if err != nil {
				t.Fatalf("open postgres: %v", err)
			}
			if _, err := pg.Migrate(ctx); err != nil {
				t.Fatalf("migrate: %v", err)
			}
			// Idempotent.
			if applied, err := pg.Migrate(ctx); err != nil || len(applied) != 0 {
				t.Fatalf("second migrate: %v %v", applied, err)
			}
			if err := pg.resetForTests(ctx); err != nil {
				t.Fatalf("reset: %v", err)
			}
			t.Cleanup(pg.Close)
			return pg
		}
	} else {
		t.Log("KITCOUNT_TEST_DATABASE_URL not set; skipping Postgres contract tests")
	}
	return out
}

func hash(s string) []byte {
	h := sha256.Sum256([]byte(s))
	return h[:]
}

func blob(n int, fill byte) []byte { return bytes.Repeat([]byte{fill}, n) }

func TestStoreContract(t *testing.T) {
	for name, open := range stores(t) {
		t.Run(name, func(t *testing.T) {
			t.Run("devices", func(t *testing.T) { testDevices(t, open(t)) })
			t.Run("events", func(t *testing.T) { testEvents(t, open(t)) })
			t.Run("concurrent appends", func(t *testing.T) { testConcurrentAppends(t, open(t)) })
		})
	}
}

func testDevices(t *testing.T, s Store) {
	ctx := context.Background()
	d, err := s.CreateDevice(ctx, "Van 1", hash("token-1"))
	if err != nil {
		t.Fatal(err)
	}
	if d.Status != StatusActive || d.Name != "Van 1" || !IsUUID(d.ID) {
		t.Fatalf("unexpected device %+v", d)
	}
	if _, err := s.CreateDevice(ctx, "dup", hash("token-1")); !errors.Is(err, ErrConflict) {
		t.Fatalf("want ErrConflict, got %v", err)
	}
	got, err := s.DeviceByTokenHash(ctx, hash("token-1"))
	if err != nil || got.ID != d.ID {
		t.Fatalf("lookup: %v %+v", err, got)
	}
	if _, err := s.DeviceByTokenHash(ctx, hash("nope")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	if err := s.TouchDevice(ctx, d.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	got, _ = s.DeviceByTokenHash(ctx, hash("token-1"))
	if got.LastSeenAt == nil {
		t.Fatal("last seen not recorded")
	}
	for _, st := range []DeviceStatus{StatusRevoked, StatusWipe, StatusActive} {
		u, err := s.SetDeviceStatus(ctx, d.ID, st)
		if err != nil || u.Status != st {
			t.Fatalf("set %s: %v %+v", st, err, u)
		}
	}
	if _, err := s.SetDeviceStatus(ctx, "00000000-0000-4000-8000-000000000000", StatusRevoked); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	if _, err := s.SetDeviceStatus(ctx, "not-a-uuid", StatusRevoked); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound for bad id, got %v", err)
	}
	if _, err := s.CreateDevice(ctx, "Van 2", hash("token-2")); err != nil {
		t.Fatal(err)
	}
	list, err := s.ListDevices(ctx)
	if err != nil || len(list) != 2 || list[0].ID != d.ID {
		t.Fatalf("list: %v %+v", err, list)
	}
	if err := s.Ping(ctx); err != nil {
		t.Fatal(err)
	}
}

func testEvents(t *testing.T, s Store) {
	ctx := context.Background()
	a, _ := s.CreateDevice(ctx, "A", hash("a"))
	b, _ := s.CreateDevice(ctx, "B", hash("b"))
	ids := []string{
		"10000000-0000-4000-8000-000000000001",
		"10000000-0000-4000-8000-000000000002",
		"10000000-0000-4000-8000-000000000003",
	}
	acc, dup, err := s.AppendEvents(ctx, a.ID, []Envelope{{ID: ids[0], Blob: blob(50, 1)}, {ID: ids[1], Blob: blob(60, 2)}, {ID: ids[0], Blob: blob(50, 9)}})
	if err != nil || acc != 2 || dup != 1 {
		t.Fatalf("append: %d %d %v", acc, dup, err)
	}
	acc, dup, err = s.AppendEvents(ctx, b.ID, []Envelope{{ID: ids[1], Blob: blob(60, 7)}, {ID: ids[2], Blob: blob(70, 3)}})
	if err != nil || acc != 1 || dup != 1 {
		t.Fatalf("append b: %d %d %v", acc, dup, err)
	}
	if acc, dup, err := s.AppendEvents(ctx, b.ID, nil); err != nil || acc != 0 || dup != 0 {
		t.Fatalf("empty append: %d %d %v", acc, dup, err)
	}

	all, err := s.EventsAfter(ctx, 0, 10)
	if err != nil || len(all) != 3 {
		t.Fatalf("pull: %v %d", err, len(all))
	}
	for i, r := range all {
		if r.Seq != int64(i+1) || r.ID != ids[i] {
			t.Fatalf("record %d: %+v", i, r)
		}
	}
	if all[0].DeviceID != a.ID || all[2].DeviceID != b.ID {
		t.Fatal("device attribution wrong")
	}
	if !bytes.Equal(all[1].Blob, blob(60, 2)) {
		t.Fatal("duplicate overwrote original blob")
	}
	page, _ := s.EventsAfter(ctx, 1, 1)
	if len(page) != 1 || page[0].Seq != 2 {
		t.Fatalf("page: %+v", page)
	}
	if rest, _ := s.EventsAfter(ctx, 3, 10); len(rest) != 0 {
		t.Fatalf("expected nothing after 3, got %d", len(rest))
	}
	if rest, _ := s.EventsAfter(ctx, 99, 10); len(rest) != 0 {
		t.Fatalf("expected nothing after 99, got %d", len(rest))
	}
	st, err := s.Stats(ctx)
	if err != nil || st.Events != 3 || st.Devices != 2 || st.Active != 2 || st.LastSeq != 3 || st.BlobsBytes != 180 {
		t.Fatalf("stats: %v %+v", err, st)
	}
}

// Sequence numbers must be gap-free and strictly increasing in commit order
// even under concurrent writers, or pullers could skip records.
func testConcurrentAppends(t *testing.T, s Store) {
	ctx := context.Background()
	d, _ := s.CreateDevice(ctx, "C", hash("c"))
	const writers, perWriter = 8, 25
	var wg sync.WaitGroup
	errs := make(chan error, writers)
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < perWriter; i++ {
				id := fmt.Sprintf("20000000-0000-4000-8000-%04d%08d", w, i)
				if _, _, err := s.AppendEvents(ctx, d.ID, []Envelope{{ID: id, Blob: blob(41, byte(w))}}); err != nil {
					errs <- err
					return
				}
			}
		}(w)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	all, err := s.EventsAfter(ctx, 0, writers*perWriter+10)
	if err != nil || len(all) != writers*perWriter {
		t.Fatalf("got %d records: %v", len(all), err)
	}
	for i, r := range all {
		if r.Seq != int64(i+1) {
			t.Fatalf("gap at %d: seq %d", i, r.Seq)
		}
	}
}

func TestStatusValid(t *testing.T) {
	for _, s := range []DeviceStatus{StatusActive, StatusRevoked, StatusWipe} {
		if !s.Valid() {
			t.Fatalf("%s should be valid", s)
		}
	}
	if DeviceStatus("deleted").Valid() {
		t.Fatal("unknown status should be invalid")
	}
}

func TestIsUUID(t *testing.T) {
	for s, want := range map[string]bool{
		NewUUID():                              true,
		"10000000-0000-4000-8000-000000000001": true,
		"10000000-0000-4000-8000-00000000000g": false,
		"10000000x0000-4000-8000-000000000001": false,
		"short":                                false,
	} {
		if IsUUID(s) != want {
			t.Errorf("IsUUID(%q) = %v", s, !want)
		}
	}
}

func TestLoadMigrations(t *testing.T) {
	migs, err := loadMigrations()
	if err != nil || len(migs) == 0 || migs[0].version != 1 {
		t.Fatalf("migrations: %v %+v", err, migs)
	}
}
