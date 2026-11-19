-- Kitcount sync server schema, version 1.
-- The server stores only encrypted envelopes; see docs/sync-protocol.md.

CREATE TABLE devices (
    id           uuid PRIMARY KEY,
    name         text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    token_hash   bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    status       text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'wipe')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz,
    status_changed_at timestamptz
);

CREATE TABLE events (
    seq         bigint      PRIMARY KEY,
    id          uuid        NOT NULL UNIQUE,
    device_id   uuid        NOT NULL REFERENCES devices (id),
    blob        bytea       NOT NULL CHECK (octet_length(blob) BETWEEN 41 AND 65536),
    received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_device_idx ON events (device_id);
