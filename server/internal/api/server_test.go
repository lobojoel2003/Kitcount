package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lobojoel2003/Kitcount/server/internal/store"
)

const adminToken = "test-admin-token-that-is-long-enough-123"

type harness struct {
	t   *testing.T
	srv *Server
	st  *store.Memory
	log *bytes.Buffer
}

func newHarness(t *testing.T, mutate ...func(*Options)) *harness {
	st := store.NewMemory()
	logs := &bytes.Buffer{}
	opts := Options{Store: st, AdminToken: adminToken, Logger: slog.New(slog.NewTextHandler(logs, nil)), RateLimit: 1000}
	for _, m := range mutate {
		m(&opts)
	}
	return &harness{t: t, srv: New(opts), st: st, log: logs}
}

func (h *harness) do(method, path, token string, body any) (*httptest.ResponseRecorder, map[string]any) {
	h.t.Helper()
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		rd = strings.NewReader(b)
	default:
		raw, _ := json.Marshal(b)
		rd = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, rd)
	req.RemoteAddr = "192.0.2.1:1234"
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if rd != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.srv.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func (h *harness) enrol(name string) (string, string) {
	h.t.Helper()
	rec, out := h.do("POST", "/v1/admin/devices", adminToken, map[string]string{"name": name})
	if rec.Code != http.StatusCreated {
		h.t.Fatalf("enrol: %d %s", rec.Code, rec.Body)
	}
	return out["token"].(string), out["device"].(map[string]any)["id"].(string)
}

func envelope(id string, size int) map[string]string {
	return map[string]string{"id": id, "blob": base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, size))}
}

func uuidN(n int) string { return fmt.Sprintf("30000000-0000-4000-8000-%012d", n) }

func TestHealthAndHeaders(t *testing.T) {
	h := newHarness(t)
	rec, out := h.do("GET", "/healthz", "", nil)
	if rec.Code != 200 || out["status"] != "ok" || out["version"] == nil {
		t.Fatalf("healthz: %d %v", rec.Code, out)
	}
	for _, k := range []string{"X-Content-Type-Options", "Cache-Control", "Content-Security-Policy", "Referrer-Policy", "X-Frame-Options"} {
		if rec.Header().Get(k) == "" {
			t.Errorf("missing header %s", k)
		}
	}
	if rec, _ := h.do("GET", "/readyz", "", nil); rec.Code != 200 {
		t.Fatalf("readyz: %d", rec.Code)
	}
	if rec, out := h.do("GET", "/nope", "", nil); rec.Code != 404 || out["error"] != "not_found" {
		t.Fatalf("404: %d %v", rec.Code, out)
	}
}

func TestHSTSOnTLS(t *testing.T) {
	h := newHarness(t)
	req := httptest.NewRequest("GET", "/healthz", nil)
	req.TLS = &tls.ConnectionState{}
	rec := httptest.NewRecorder()
	h.srv.ServeHTTP(rec, req)
	if rec.Header().Get("Strict-Transport-Security") == "" {
		t.Fatal("HSTS missing on TLS request")
	}
}

func TestDeviceAuth(t *testing.T) {
	h := newHarness(t)
	if rec, out := h.do("GET", "/v1/whoami", "", nil); rec.Code != 401 || out["error"] != "unauthorized" {
		t.Fatalf("no token: %d %v", rec.Code, out)
	}
	if rec, _ := h.do("GET", "/v1/whoami", "kc_dev_wrong", nil); rec.Code != 401 {
		t.Fatalf("wrong token: %d", rec.Code)
	}
	token, id := h.enrol("Van 1")
	rec, out := h.do("GET", "/v1/whoami", token, nil)
	if rec.Code != 200 {
		t.Fatalf("whoami: %d", rec.Code)
	}
	dev := out["device"].(map[string]any)
	if dev["id"] != id || dev["name"] != "Van 1" {
		t.Fatalf("whoami body: %v", out)
	}
	if out["limits"].(map[string]any)["max_push_events"].(float64) != MaxPushEvents {
		t.Fatal("limits missing")
	}

	// Revoke, wipe, restore.
	if rec, _ := h.do("POST", "/v1/admin/devices/"+id+"/revoke", adminToken, nil); rec.Code != 200 {
		t.Fatalf("revoke: %d", rec.Code)
	}
	if rec, out := h.do("GET", "/v1/events", token, nil); rec.Code != 401 || out["error"] != "device_revoked" {
		t.Fatalf("revoked: %d %v", rec.Code, out)
	}
	if rec, _ := h.do("POST", "/v1/admin/devices/"+id+"/wipe", adminToken, nil); rec.Code != 200 {
		t.Fatalf("wipe: %d", rec.Code)
	}
	if rec, out := h.do("GET", "/v1/events", token, nil); rec.Code != 410 || out["error"] != "device_wipe" {
		t.Fatalf("wipe: %d %v", rec.Code, out)
	}
	if rec, _ := h.do("POST", "/v1/admin/devices/"+strings.ToUpper(id)+"/restore", adminToken, nil); rec.Code != 200 {
		t.Fatalf("restore: %d", rec.Code)
	}
	if rec, _ := h.do("GET", "/v1/events", token, nil); rec.Code != 200 {
		t.Fatalf("restored: %d", rec.Code)
	}
	if !strings.Contains(h.log.String(), "device="+id) {
		t.Fatal("access log should include the device id")
	}
	if strings.Contains(h.log.String(), token) {
		t.Fatal("token leaked into logs")
	}
}

func TestPushPull(t *testing.T) {
	h := newHarness(t)
	tokA, idA := h.enrol("A")
	tokB, _ := h.enrol("B")

	rec, out := h.do("POST", "/v1/events", tokA, map[string]any{"events": []any{envelope(uuidN(1), 41), envelope(uuidN(2), 100), envelope(uuidN(1), 41)}})
	if rec.Code != 200 || out["accepted"].(float64) != 2 || out["duplicates"].(float64) != 1 {
		t.Fatalf("push: %d %v", rec.Code, out)
	}
	if rec, out := h.do("POST", "/v1/events", tokB, map[string]any{"events": []any{}}); rec.Code != 200 || out["accepted"].(float64) != 0 {
		t.Fatalf("empty push: %d %v", rec.Code, out)
	}
	_, _ = h.do("POST", "/v1/events", tokB, map[string]any{"events": []any{envelope(strings.ToUpper(uuidN(3)), 50)}})

	rec, out = h.do("GET", "/v1/events?after=0&limit=2", tokB, nil)
	if rec.Code != 200 {
		t.Fatalf("pull: %d", rec.Code)
	}
	events := out["events"].([]any)
	if len(events) != 2 || out["next"].(float64) != 2 || out["more"] != true {
		t.Fatalf("pull page 1: %v", out)
	}
	first := events[0].(map[string]any)
	if first["id"] != uuidN(1) || first["device"] != idA || first["seq"].(float64) != 1 || first["received_at"] == "" {
		t.Fatalf("record: %v", first)
	}
	raw, err := base64.RawURLEncoding.DecodeString(first["blob"].(string))
	if err != nil || len(raw) != 41 {
		t.Fatalf("blob round trip: %v %d", err, len(raw))
	}
	_, out = h.do("GET", "/v1/events?after=2", tokB, nil)
	if len(out["events"].([]any)) != 1 || out["next"].(float64) != 3 || out["more"] != false {
		t.Fatalf("pull page 2: %v", out)
	}
	if got := out["events"].([]any)[0].(map[string]any)["id"]; got != uuidN(3) {
		t.Fatalf("ids should be normalised to lowercase, got %v", got)
	}
	_, out = h.do("GET", "/v1/events?after=3", tokB, nil)
	if len(out["events"].([]any)) != 0 || out["next"].(float64) != 3 {
		t.Fatalf("pull empty: %v", out)
	}
}

func TestPushValidation(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.MaxBodyBytes = 64 << 10 })
	tok, _ := h.enrol("A")
	cases := []struct {
		name   string
		body   any
		status int
		code   string
	}{
		{"bad json", "{", 400, "bad_json"},
		{"unknown field", `{"events":[],"extra":1}`, 400, "bad_json"},
		{"trailing data", `{"events":[]} {}`, 400, "bad_json"},
		{"bad id", map[string]any{"events": []any{envelope("x", 41)}}, 422, "invalid_event"},
		{"bad blob", map[string]any{"events": []any{map[string]string{"id": uuidN(1), "blob": "***"}}}, 422, "invalid_event"},
		{"small blob", map[string]any{"events": []any{envelope(uuidN(1), 40)}}, 422, "invalid_event"},
		{"large blob", map[string]any{"events": []any{envelope(uuidN(1), MaxBlobBytes+1)}}, 413, "too_large"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec, out := h.do("POST", "/v1/events", tok, c.body)
			if rec.Code != c.status || out["error"] != c.code {
				t.Fatalf("got %d %v", rec.Code, out)
			}
		})
	}

	big := newHarness(t)
	tok2, _ := big.enrol("B")
	tooMany2 := make([]any, MaxPushEvents+1)
	for i := range tooMany2 {
		tooMany2[i] = envelope(uuidN(i), 41)
	}
	if rec, out := big.do("POST", "/v1/events", tok2, map[string]any{"events": tooMany2}); rec.Code != 413 || out["error"] != "too_many_events" {
		t.Fatalf("too many events: %d %v", rec.Code, out)
	}
	if rec, out := big.do("POST", "/v1/events", tok2, map[string]any{"events": []any{envelope(uuidN(1), MaxBlobBytes+1)}}); rec.Code != 422 {
		t.Fatalf("oversized blob: %d %v", rec.Code, out)
	}

	req := httptest.NewRequest("POST", "/v1/events", strings.NewReader(`{"events":[]}`))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	h.srv.ServeHTTP(rec, req)
	if rec.Code != 415 {
		t.Fatalf("content type: %d", rec.Code)
	}
}

func TestPullValidation(t *testing.T) {
	h := newHarness(t)
	tok, _ := h.enrol("A")
	for _, q := range []string{"after=-1", "after=x", "limit=0", "limit=1001", "limit=x"} {
		if rec, _ := h.do("GET", "/v1/events?"+q, tok, nil); rec.Code != 400 {
			t.Errorf("%s: %d", q, rec.Code)
		}
	}
}

func TestAdminAPI(t *testing.T) {
	h := newHarness(t)
	if rec, _ := h.do("GET", "/v1/admin/devices", "", nil); rec.Code != 401 {
		t.Fatalf("no admin token: %d", rec.Code)
	}
	if rec, _ := h.do("GET", "/v1/admin/devices", "wrong", nil); rec.Code != 401 {
		t.Fatalf("wrong admin token: %d", rec.Code)
	}
	for _, name := range []string{"", "   ", strings.Repeat("x", 81), "bad\nname"} {
		if rec, _ := h.do("POST", "/v1/admin/devices", adminToken, map[string]string{"name": name}); rec.Code != 422 {
			t.Errorf("name %q: %d", name, rec.Code)
		}
	}
	tok, id := h.enrol("Outreach backpack")
	if !strings.HasPrefix(tok, "kc_dev_") {
		t.Fatalf("token format: %s", tok)
	}
	rec, out := h.do("GET", "/v1/admin/devices", adminToken, nil)
	devices := out["devices"].([]any)
	if rec.Code != 200 || len(devices) != 1 {
		t.Fatalf("list: %d %v", rec.Code, out)
	}
	if _, leaked := devices[0].(map[string]any)["TokenHash"]; leaked {
		t.Fatal("token hash serialised")
	}
	if rec, _ := h.do("POST", "/v1/admin/devices/"+id+"/explode", adminToken, nil); rec.Code != 404 {
		t.Fatalf("bad action: %d", rec.Code)
	}
	if rec, _ := h.do("POST", "/v1/admin/devices/"+uuidN(9)+"/revoke", adminToken, nil); rec.Code != 404 {
		t.Fatalf("missing device: %d", rec.Code)
	}
	rec, out = h.do("GET", "/v1/admin/stats", adminToken, nil)
	if rec.Code != 200 || out["stats"].(map[string]any)["devices"].(float64) != 1 {
		t.Fatalf("stats: %d %v", rec.Code, out)
	}

	disabled := newHarness(t, func(o *Options) { o.AdminToken = "" })
	if rec, out := disabled.do("GET", "/v1/admin/devices", adminToken, nil); rec.Code != 404 || out["error"] != "admin_disabled" {
		t.Fatalf("disabled admin: %d %v", rec.Code, out)
	}
}

func TestRateLimits(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	h := newHarness(t, func(o *Options) {
		o.RateLimit = 1
		o.Now = func() time.Time { return now }
	})
	codes := []int{}
	for i := 0; i < 4; i++ {
		rec, _ := h.do("GET", "/v1/whoami", "", nil)
		codes = append(codes, rec.Code)
	}
	if codes[0] != 401 || codes[3] != 429 {
		t.Fatalf("expected limit to kick in: %v", codes)
	}
	// Health checks are never rate limited.
	if rec, _ := h.do("GET", "/healthz", "", nil); rec.Code != 200 {
		t.Fatalf("healthz limited: %d", rec.Code)
	}

	// Repeated bad tokens are throttled separately.
	f := newHarness(t, func(o *Options) { o.Now = func() time.Time { return now } })
	var last int
	for i := 0; i < 12; i++ {
		rec, _ := f.do("GET", "/v1/whoami", "kc_dev_guess", nil)
		last = rec.Code
	}
	if last != 429 {
		t.Fatalf("auth failures not throttled: %d", last)
	}
	var lastAdmin int
	for i := 0; i < 12; i++ {
		rec, _ := f.do("GET", "/v1/admin/devices", "guess", nil)
		lastAdmin = rec.Code
	}
	if lastAdmin != 429 {
		t.Fatalf("admin auth failures not throttled: %d", lastAdmin)
	}
}

func TestClientIP(t *testing.T) {
	trusted := New(Options{Store: store.NewMemory(), TrustProxy: true})
	untrusted := New(Options{Store: store.NewMemory()})
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.0.0.1:5555"
	req.Header.Set("X-Forwarded-For", "203.0.113.9, 10.0.0.1")
	if ip := trusted.clientIP(req); ip != "203.0.113.9" {
		t.Fatalf("trusted: %s", ip)
	}
	if ip := untrusted.clientIP(req); ip != "10.0.0.1" {
		t.Fatalf("untrusted: %s", ip)
	}
	req.RemoteAddr = "weird"
	if ip := untrusted.clientIP(req); ip != "weird" {
		t.Fatalf("fallback: %s", ip)
	}
}

func TestLimiterEviction(t *testing.T) {
	l := newLimiter(1, 0)
	now := time.Unix(0, 0)
	l.allow("a", now)
	l.allow("b", now.Add(2*time.Minute))
	l.allow("c", now.Add(15*time.Minute))
	if _, ok := l.buckets["a"]; ok {
		t.Fatal("idle bucket not evicted")
	}
}

// failingStore wraps Memory and fails selected operations.
type failingStore struct {
	*store.Memory
	fail string
}

func (f failingStore) err(op string) error {
	if f.fail == op {
		return fmt.Errorf("boom: %s", op)
	}
	return nil
}
func (f failingStore) AppendEvents(ctx context.Context, d string, e []store.Envelope) (int, int, error) {
	if err := f.err("append"); err != nil {
		return 0, 0, err
	}
	return f.Memory.AppendEvents(ctx, d, e)
}
func (f failingStore) EventsAfter(ctx context.Context, a int64, l int) ([]store.Record, error) {
	if err := f.err("pull"); err != nil {
		return nil, err
	}
	return f.Memory.EventsAfter(ctx, a, l)
}
func (f failingStore) ListDevices(ctx context.Context) ([]store.Device, error) {
	if err := f.err("list"); err != nil {
		return nil, err
	}
	return f.Memory.ListDevices(ctx)
}
func (f failingStore) Stats(ctx context.Context) (store.Stats, error) {
	if err := f.err("stats"); err != nil {
		return store.Stats{}, err
	}
	return f.Memory.Stats(ctx)
}
func (f failingStore) Ping(ctx context.Context) error { return f.err("ping") }

func TestInternalErrors(t *testing.T) {
	for _, op := range []string{"append", "pull", "list", "stats", "ping"} {
		t.Run(op, func(t *testing.T) {
			mem := store.NewMemory()
			h := newHarness(t, func(o *Options) { o.Store = failingStore{Memory: mem, fail: op} })
			d, tok, err := CreateDevice(context.Background(), mem, "A")
			if err != nil || d.ID == "" {
				t.Fatal(err)
			}
			var rec *httptest.ResponseRecorder
			switch op {
			case "append":
				rec, _ = h.do("POST", "/v1/events", tok, map[string]any{"events": []any{envelope(uuidN(1), 41)}})
			case "pull":
				rec, _ = h.do("GET", "/v1/events", tok, nil)
			case "list":
				rec, _ = h.do("GET", "/v1/admin/devices", adminToken, nil)
			case "stats":
				rec, _ = h.do("GET", "/v1/admin/stats", adminToken, nil)
			case "ping":
				rec, _ = h.do("GET", "/readyz", "", nil)
				if rec.Code != 503 {
					t.Fatalf("readyz: %d", rec.Code)
				}
				return
			}
			if rec.Code != 500 {
				t.Fatalf("%s: %d", op, rec.Code)
			}
			if strings.Contains(rec.Body.String(), "boom") {
				t.Fatal("internal error details leaked to client")
			}
		})
	}
}

func TestValidDeviceName(t *testing.T) {
	if !ValidDeviceName("Van 1 — downtown") || ValidDeviceName("") || ValidDeviceName("a\x7f") {
		t.Fatal("ValidDeviceName")
	}
}
