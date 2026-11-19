package store

import (
	"bytes"
	"context"
	"crypto/rand"
	"fmt"
	"sort"
	"sync"
	"time"
)

// Memory is a non-persistent Store for tests, demos and local development.
type Memory struct {
	mu      sync.Mutex
	devices map[string]*Device
	events  []Record
	ids     map[string]struct{}
}

// NewMemory returns an empty in-memory store.
func NewMemory() *Memory {
	return &Memory{devices: map[string]*Device{}, ids: map[string]struct{}{}}
}

// NewUUID returns a random RFC 4122 version 4 UUID.
func NewUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func (m *Memory) CreateDevice(_ context.Context, name string, tokenHash []byte) (Device, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, d := range m.devices {
		if bytes.Equal(d.TokenHash, tokenHash) {
			return Device{}, ErrConflict
		}
	}
	d := &Device{ID: NewUUID(), Name: name, Status: StatusActive, CreatedAt: time.Now().UTC(), TokenHash: tokenHash}
	m.devices[d.ID] = d
	return *d, nil
}

func (m *Memory) DeviceByTokenHash(_ context.Context, tokenHash []byte) (Device, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, d := range m.devices {
		if bytes.Equal(d.TokenHash, tokenHash) {
			return *d, nil
		}
	}
	return Device{}, ErrNotFound
}

func (m *Memory) ListDevices(_ context.Context) ([]Device, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Device, 0, len(m.devices))
	for _, d := range m.devices {
		out = append(out, *d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (m *Memory) SetDeviceStatus(_ context.Context, id string, status DeviceStatus) (Device, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.devices[id]
	if !ok {
		return Device{}, ErrNotFound
	}
	d.Status = status
	return *d, nil
}

func (m *Memory) TouchDevice(_ context.Context, id string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if d, ok := m.devices[id]; ok {
		t := at.UTC()
		d.LastSeenAt = &t
	}
	return nil
}

func (m *Memory) AppendEvents(_ context.Context, deviceID string, envs []Envelope) (int, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	accepted, dup := 0, 0
	now := time.Now().UTC()
	for _, e := range envs {
		if _, ok := m.ids[e.ID]; ok {
			dup++
			continue
		}
		m.ids[e.ID] = struct{}{}
		blob := append([]byte(nil), e.Blob...)
		m.events = append(m.events, Record{Seq: int64(len(m.events) + 1), ID: e.ID, DeviceID: deviceID, Blob: blob, ReceivedAt: now})
		accepted++
	}
	return accepted, dup, nil
}

func (m *Memory) EventsAfter(_ context.Context, after int64, limit int) ([]Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	start := int(after)
	if start < 0 {
		start = 0
	}
	if start >= len(m.events) {
		return []Record{}, nil
	}
	end := start + limit
	if end > len(m.events) {
		end = len(m.events)
	}
	out := make([]Record, end-start)
	copy(out, m.events[start:end])
	return out, nil
}

func (m *Memory) Stats(_ context.Context) (Stats, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := Stats{Events: int64(len(m.events)), Devices: int64(len(m.devices)), LastSeq: int64(len(m.events))}
	for _, d := range m.devices {
		if d.Status == StatusActive {
			s.Active++
		}
	}
	for _, e := range m.events {
		s.BlobsBytes += int64(len(e.Blob))
	}
	return s, nil
}

func (m *Memory) Ping(context.Context) error { return nil }

func (m *Memory) Close() {}
