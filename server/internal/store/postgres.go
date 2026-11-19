package store

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// Advisory lock keys (arbitrary, stable).
const (
	lockMigrate int64 = 0x4b6974636f756e74 // "Kitcount"
	lockAppend  int64 = 0x4b63417070656e64 // "KcAppend"
)

// Postgres is the production Store.
type Postgres struct {
	pool *pgxpool.Pool
}

// OpenPostgres connects to Postgres. Call Migrate before serving.
func OpenPostgres(ctx context.Context, url string) (*Postgres, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	if cfg.MaxConns < 4 {
		cfg.MaxConns = 4
	}
	cfg.MaxConnIdleTime = 5 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &Postgres{pool: pool}, nil
}

type migration struct {
	version int
	name    string
	sql     string
}

func loadMigrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrationFS, "migrations")
	if err != nil {
		return nil, err
	}
	var out []migration
	for _, e := range entries {
		name := e.Name()
		prefix, _, ok := strings.Cut(name, "_")
		if !ok {
			return nil, fmt.Errorf("migration %q must be named NNNN_description.sql", name)
		}
		v, err := strconv.Atoi(prefix)
		if err != nil {
			return nil, fmt.Errorf("migration %q: %w", name, err)
		}
		body, err := migrationFS.ReadFile("migrations/" + name)
		if err != nil {
			return nil, err
		}
		out = append(out, migration{version: v, name: name, sql: string(body)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	return out, nil
}

// Migrate applies pending schema migrations. It is safe to run concurrently
// from several instances: a session advisory lock serialises them.
func (p *Postgres) Migrate(ctx context.Context) (applied []string, err error) {
	migs, err := loadMigrations()
	if err != nil {
		return nil, err
	}
	conn, err := p.pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", lockMigrate); err != nil {
		return nil, err
	}
	defer func() {
		_, _ = conn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", lockMigrate)
	}()
	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version int PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return nil, err
	}
	for _, m := range migs {
		var exists bool
		if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)", m.version).Scan(&exists); err != nil {
			return applied, err
		}
		if exists {
			continue
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return applied, err
		}
		if _, err := tx.Exec(ctx, m.sql); err != nil {
			_ = tx.Rollback(ctx)
			return applied, fmt.Errorf("migration %s: %w", m.name, err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", m.version, m.name); err != nil {
			_ = tx.Rollback(ctx)
			return applied, err
		}
		if err := tx.Commit(ctx); err != nil {
			return applied, err
		}
		applied = append(applied, m.name)
	}
	return applied, nil
}

const deviceCols = "id::text, name, status, created_at, last_seen_at, token_hash"

func scanDevice(row pgx.Row) (Device, error) {
	var d Device
	var status string
	err := row.Scan(&d.ID, &d.Name, &status, &d.CreatedAt, &d.LastSeenAt, &d.TokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Device{}, ErrNotFound
	}
	d.Status = DeviceStatus(status)
	return d, err
}

func (p *Postgres) CreateDevice(ctx context.Context, name string, tokenHash []byte) (Device, error) {
	row := p.pool.QueryRow(ctx,
		"INSERT INTO devices (id, name, token_hash) VALUES ($1, $2, $3) RETURNING "+deviceCols,
		NewUUID(), name, tokenHash)
	d, err := scanDevice(row)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return Device{}, ErrConflict
	}
	return d, err
}

func (p *Postgres) DeviceByTokenHash(ctx context.Context, tokenHash []byte) (Device, error) {
	return scanDevice(p.pool.QueryRow(ctx, "SELECT "+deviceCols+" FROM devices WHERE token_hash = $1", tokenHash))
}

func (p *Postgres) ListDevices(ctx context.Context) ([]Device, error) {
	rows, err := p.pool.Query(ctx, "SELECT "+deviceCols+" FROM devices ORDER BY created_at, id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Device{}
	for rows.Next() {
		d, err := scanDevice(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (p *Postgres) SetDeviceStatus(ctx context.Context, id string, status DeviceStatus) (Device, error) {
	if !isUUID(id) {
		return Device{}, ErrNotFound
	}
	return scanDevice(p.pool.QueryRow(ctx,
		"UPDATE devices SET status = $2, status_changed_at = now() WHERE id = $1 RETURNING "+deviceCols, id, string(status)))
}

func (p *Postgres) TouchDevice(ctx context.Context, id string, at time.Time) error {
	// Throttled so busy devices do not turn every read into a write.
	_, err := p.pool.Exec(ctx,
		"UPDATE devices SET last_seen_at = $2::timestamptz WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < $2::timestamptz - interval '1 minute')",
		id, at.UTC())
	return err
}

func (p *Postgres) AppendEvents(ctx context.Context, deviceID string, envs []Envelope) (int, int, error) {
	if len(envs) == 0 {
		return 0, 0, nil
	}
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	// Serialise appends so sequence numbers become visible in order: a
	// puller that has seen seq N can never later miss a record with seq < N.
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", lockAppend); err != nil {
		return 0, 0, err
	}
	var next int64
	if err := tx.QueryRow(ctx, "SELECT COALESCE(MAX(seq), 0) FROM events").Scan(&next); err != nil {
		return 0, 0, err
	}
	accepted := 0
	for _, e := range envs {
		tag, err := tx.Exec(ctx,
			"INSERT INTO events (seq, id, device_id, blob) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
			next+1, e.ID, deviceID, e.Blob)
		if err != nil {
			return 0, 0, err
		}
		if tag.RowsAffected() == 1 {
			next++
			accepted++
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return accepted, len(envs) - accepted, nil
}

func (p *Postgres) EventsAfter(ctx context.Context, after int64, limit int) ([]Record, error) {
	rows, err := p.pool.Query(ctx,
		"SELECT seq, id::text, device_id::text, blob, received_at FROM events WHERE seq > $1 ORDER BY seq LIMIT $2",
		after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Record{}
	for rows.Next() {
		var r Record
		if err := rows.Scan(&r.Seq, &r.ID, &r.DeviceID, &r.Blob, &r.ReceivedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (p *Postgres) Stats(ctx context.Context) (Stats, error) {
	var s Stats
	err := p.pool.QueryRow(ctx, `SELECT
		(SELECT COUNT(*) FROM events),
		(SELECT COUNT(*) FROM devices),
		(SELECT COUNT(*) FROM devices WHERE status = 'active'),
		(SELECT COALESCE(MAX(seq), 0) FROM events),
		(SELECT COALESCE(SUM(octet_length(blob)), 0) FROM events)`).Scan(&s.Events, &s.Devices, &s.Active, &s.LastSeq, &s.BlobsBytes)
	return s, err
}

func (p *Postgres) Ping(ctx context.Context) error { return p.pool.Ping(ctx) }

func (p *Postgres) Close() { p.pool.Close() }

// resetForTests drops all data. Only used by tests against a throwaway database.
func (p *Postgres) resetForTests(ctx context.Context) error {
	_, err := p.pool.Exec(ctx, "TRUNCATE events, devices")
	return err
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
				return false
			}
		}
	}
	return true
}

// IsUUID reports whether s is a canonical UUID string.
func IsUUID(s string) bool { return isUUID(s) }
