// Package store persists devices and encrypted event envelopes.
//
// The server is zero-knowledge: an event is an opaque blob encrypted on the
// device with the program key, which the server never receives. The store
// only knows each blob's id, which device uploaded it, and when.
package store

import (
	"context"
	"errors"
	"time"
)

// DeviceStatus controls what a device is allowed to do.
type DeviceStatus string

const (
	// StatusActive devices can push and pull.
	StatusActive DeviceStatus = "active"
	// StatusRevoked devices are refused (lost device, staff left).
	StatusRevoked DeviceStatus = "revoked"
	// StatusWipe devices are told to erase their local data on next contact.
	StatusWipe DeviceStatus = "wipe"
)

// Valid reports whether s is a known status.
func (s DeviceStatus) Valid() bool {
	return s == StatusActive || s == StatusRevoked || s == StatusWipe
}

// Device is an enrolled phone or tablet.
type Device struct {
	ID         string       `json:"id"`
	Name       string       `json:"name"`
	Status     DeviceStatus `json:"status"`
	CreatedAt  time.Time    `json:"created_at"`
	LastSeenAt *time.Time   `json:"last_seen_at,omitempty"`
	// TokenHash is never serialised.
	TokenHash []byte `json:"-"`
}

// Envelope is an encrypted event as uploaded by a device.
type Envelope struct {
	ID   string
	Blob []byte
}

// Record is a stored envelope with its server-assigned sequence number.
type Record struct {
	Seq        int64
	ID         string
	DeviceID   string
	Blob       []byte
	ReceivedAt time.Time
}

// Stats summarises the store for the admin endpoint.
type Stats struct {
	Events     int64 `json:"events"`
	Devices    int64 `json:"devices"`
	Active     int64 `json:"active_devices"`
	LastSeq    int64 `json:"last_seq"`
	BlobsBytes int64 `json:"blob_bytes"`
}

var (
	// ErrNotFound is returned when a device does not exist.
	ErrNotFound = errors.New("not found")
	// ErrConflict is returned when a unique value already exists.
	ErrConflict = errors.New("conflict")
)

// Store is implemented by the Postgres store and the in-memory store.
type Store interface {
	// CreateDevice enrols a device identified by the hash of its token.
	CreateDevice(ctx context.Context, name string, tokenHash []byte) (Device, error)
	// DeviceByTokenHash looks up a device for authentication.
	DeviceByTokenHash(ctx context.Context, tokenHash []byte) (Device, error)
	ListDevices(ctx context.Context) ([]Device, error)
	SetDeviceStatus(ctx context.Context, id string, status DeviceStatus) (Device, error)
	// TouchDevice records that a device was seen (implementations may throttle).
	TouchDevice(ctx context.Context, id string, at time.Time) error

	// AppendEvents stores envelopes idempotently. It returns how many were
	// new and how many already existed (same id). Sequence numbers are
	// assigned in commit order so pullers never miss a record.
	AppendEvents(ctx context.Context, deviceID string, envs []Envelope) (accepted, duplicates int, err error)
	// EventsAfter returns up to limit records with seq > after, ascending.
	EventsAfter(ctx context.Context, after int64, limit int) ([]Record, error)

	Stats(ctx context.Context) (Stats, error)
	Ping(ctx context.Context) error
	Close()
}
