# Sync protocol (v1)

Kitcount devices share data through a small, self-hosted server. The server
is a **zero-knowledge relay**: it stores encrypted envelopes and hands them
to other devices of the same program. It cannot read them.

## Keys

Each program has a random 32-byte **program secret** and a random 16-byte
**program id**. The program's first device creates both. Other devices receive
them through the enrollment QR code. The server never receives the secret.

Sub-keys are derived with HKDF-SHA256 (salt `"kitcount"`):

| Key | `info` | Use |
| --- | --- | --- |
| `codeKey` | `kitcount/v1/participant-code/<programId>` | HMAC of participant codes |
| `syncKey` | `kitcount/v1/sync-envelope/<programId>` | XChaCha20-Poly1305 for sync envelopes |

The **program fingerprint** shown on both devices during enrollment is
`HMAC-SHA256(secret, "kitcount/v1/fingerprint/<programId>")`, truncated to 4
bytes and shown as `XXXX-XXXX`.

## Events

All data is an append-only log of JSON events (`app/src/core/domain/events.ts`):

| Type | Fields |
| --- | --- |
| `visit.logged` | `participant` (32-hex HMAC or `null`), `out` (supply → units), `syringesIn`, `reversals`, `referrals[]`, `secondary` |
| `visit.voided` | `visit` (id of the visit being undone) |
| `stock.received` | `supply`, `qty` |
| `stock.adjusted` | `supply`, `delta` (signed), `reason` |
| `config.set` | `key` (`programName`, `templateId`, `codeHint`, `codePattern`, `catalog`), `value` |

Every event has `id` (UUID v4), `v` (1), `at` (ISO-8601 UTC) and `device` (the
recording device's random id). There are no free-text fields.

Because events are immutable and every derived value is order-independent
(sums for stock, min/max for participant history, last-writer-wins on
`(at, id)` for settings), devices converge however late or out of order they
sync.

## Envelopes

```
blob = base64url( 0x01 || nonce[24] || XChaCha20-Poly1305(syncKey, nonce, aad, JSON(event)) )
aad  = "kitcount/v1|" + programId + "|" + eventId
```

Binding the program id and event id as associated data means a ciphertext
cannot be replayed under another id or moved to another program without
failing authentication. Receivers also check that the decrypted event's `id`
equals the envelope id, and validate the event strictly before storing it.
Envelopes that fail any check are counted and skipped.

## HTTP API

All requests use `Authorization: Bearer <device token>`. Tokens are 256-bit
random strings (`kc_dev_…`). The server stores only their SHA-256 hash.

### `GET /v1/whoami`

```json
{ "device": { "id": "…", "name": "Van 1" },
  "server": { "version": "1.0.0", "build": "42" },
  "limits": { "max_push_events": 500, "max_pull_limit": 1000, "max_blob_bytes": 65536 } }
```

### `POST /v1/events`

```json
{ "events": [ { "id": "<uuid>", "blob": "<base64url>" } ] }
```

The request is idempotent. Ids the server already has are counted as
duplicates and never overwritten. Response: `{ "accepted": 1, "duplicates": 0 }`.

### `GET /v1/events?after=<seq>&limit=<n>`

```json
{ "events": [ { "seq": 1, "id": "…", "device": "…", "blob": "…", "received_at": "…" } ],
  "next": 1, "more": false }
```

Sequence numbers are assigned in commit order: appends are serialised with a
Postgres advisory lock. A client that has seen `seq = N` therefore can never
later miss a record with a smaller sequence number. Clients store `next` as
their cursor only after the page's events are safely written.

### Errors

| Status | `error` | Client behaviour |
| --- | --- | --- |
| 401 | `unauthorized` | Token unknown: ask the administrator for a new one |
| 401 | `device_revoked` | Device revoked: stop syncing, show a notice |
| 410 | `device_wipe` | **Erase all local data immediately** (remote wipe) |
| 413, 422, 400 | various | Request rejected; nothing was stored |
| 429 | `rate_limited` | Back off and retry later |

## Client algorithm

1. **Push**: read up to 200 pending events, seal each, `POST /v1/events`,
   mark them synced, and repeat until none are pending.
2. **Pull**: `GET /v1/events?after=cursor` and open, validate and store each
   event (duplicates are ignored). Save `next` as the cursor and repeat while
   `more` is true.

The client syncs on unlock, about 15 seconds after each new event, every
3 minutes while the app is open, and when staff tap **Sync now**. Offline
failures are silent; the event queue simply waits.
