# kitcount-server

The self-hosted sync server for [Kitcount](../README.md). It is a small Go
service backed by Postgres that relays **encrypted** event envelopes between a
program's phones and tablets.

The server is **zero-knowledge**. Devices encrypt every event with the
program key (XChaCha20-Poly1305) before upload, and that key never leaves the
devices. The server stores opaque blobs, the id of the device that uploaded
each one, and a timestamp. A stolen server or database dump reveals no visit
counts, supplies, referrals or participant codes.

Licensed under the **GNU AGPL-3.0** (see [LICENSE](LICENSE)). `/healthz`
reports the source URL, as section 13 of the AGPL requires.

## Run it

### Docker Compose (recommended)

```bash
cd deploy
cp .env.example .env      # set POSTGRES_PASSWORD (and KITCOUNT_DOMAIN for HTTPS)
docker compose up -d                     # http://localhost:8080
docker compose --profile https up -d     # Caddy with automatic Let's Encrypt HTTPS
```

### Binary

Download `kitcount-server_<version>_<os>_<arch>.tar.gz` from the
[releases page](https://github.com/lobojoel2003/Kitcount/releases), then:

```bash
export KITCOUNT_DATABASE_URL='postgres://kitcount:secret@localhost:5432/kitcount'
kitcount-server serve        # applies migrations, then listens on :8080
```

For a throwaway demo with no database, use `KITCOUNT_DATABASE_URL=memory`.

## Enrol devices

Each phone or tablet gets its own token. The token is shown once; only its
SHA-256 hash is stored.

```bash
kitcount-server device add -name "Van 1"
kitcount-server device list
kitcount-server device revoke <id>    # lost phone or staff member left: refuse it
kitcount-server device wipe <id>      # the phone erases its local data on next sync
kitcount-server device restore <id>
```

In the app, go to **Settings → Sync**, enter the server address and paste the
token. With Docker: `docker compose exec server kitcount-server device add -name "Van 1"`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `KITCOUNT_DATABASE_URL` | — | `postgres://…` connection string (required), or `memory` |
| `KITCOUNT_LISTEN` | `:8080` | Listen address |
| `KITCOUNT_ADMIN_TOKEN` | — | Enables the `/v1/admin` HTTP API (at least 32 characters) |
| `KITCOUNT_TLS_CERT`, `KITCOUNT_TLS_KEY` | — | Serve HTTPS directly instead of behind a reverse proxy |
| `KITCOUNT_TRUST_PROXY` | `false` | Use `X-Forwarded-For` for rate limiting and logs |
| `KITCOUNT_RATE_LIMIT` | `20` | Requests per second per client address (burst ×2) |
| `KITCOUNT_MAX_BODY_BYTES` | `8388608` | Maximum request body size |
| `KITCOUNT_LOG_FORMAT` | `json` | `json` or `text` |
| `KITCOUNT_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

Always put the server behind HTTPS on the public internet. The app refuses
plain `http://` except on local network addresses.

## API

See [docs/sync-protocol.md](../docs/sync-protocol.md) for the full protocol.

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /healthz` | — | Liveness, version and source URL |
| `GET /readyz` | — | Database readiness |
| `GET /v1/whoami` | device | Device identity and protocol limits |
| `POST /v1/events` | device | Upload up to 500 encrypted envelopes (idempotent) |
| `GET /v1/events?after=N&limit=M` | device | Download envelopes after sequence `N` |
| `GET /v1/admin/devices` | admin | List devices |
| `POST /v1/admin/devices` | admin | Enrol a device: `{"name": "Van 1"}` returns its token |
| `POST /v1/admin/devices/{id}/revoke\|wipe\|restore` | admin | Change a device's status |
| `GET /v1/admin/stats` | admin | Event and device counts |

## Develop

```bash
go test ./...                                         # unit tests, in-memory store
KITCOUNT_TEST_DATABASE_URL=postgres://… go test ./... # also runs the Postgres contract tests
go build -o kitcount-server ./cmd/kitcount-server
```
