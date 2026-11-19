// Package api implements the Kitcount sync HTTP API (docs/sync-protocol.md).
package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lobojoel2003/Kitcount/server/internal/auth"
	"github.com/lobojoel2003/Kitcount/server/internal/store"
	"github.com/lobojoel2003/Kitcount/server/internal/version"
)

// Protocol limits. Clients learn them from docs/sync-protocol.md.
const (
	MaxPushEvents   = 500
	MaxPullLimit    = 1000
	DefaultPullSize = 500
	MinBlobBytes    = 41 // version(1) + nonce(24) + tag(16)
	MaxBlobBytes    = 64 * 1024
	MaxDeviceName   = 80
)

// Options configures the HTTP server.
type Options struct {
	Store  store.Store
	Logger *slog.Logger
	// AdminToken enables the /v1/admin API when non-empty.
	AdminToken string
	// MaxBodyBytes bounds request bodies (default 8 MiB).
	MaxBodyBytes int64
	// TrustProxy uses X-Forwarded-For for client addresses (rate limiting, logs).
	TrustProxy bool
	// RateLimit is requests per second per client address (default 20, burst 2x).
	RateLimit float64
	// Now is injectable for tests.
	Now func() time.Time
}

// Server is an http.Handler serving the sync API.
type Server struct {
	opts     Options
	mux      *http.ServeMux
	limiter  *limiter
	authFail *limiter
}

// New builds the API handler.
func New(opts Options) *Server {
	if opts.Logger == nil {
		opts.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	if opts.MaxBodyBytes <= 0 {
		opts.MaxBodyBytes = 8 << 20
	}
	if opts.RateLimit <= 0 {
		opts.RateLimit = 20
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	s := &Server{
		opts:     opts,
		mux:      http.NewServeMux(),
		limiter:  newLimiter(opts.RateLimit, int(opts.RateLimit*2)),
		authFail: newLimiter(10.0/60.0, 10), // 10 failed auths, then one per 6s
	}
	s.routes()
	return s
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.handleHealth)
	s.mux.HandleFunc("GET /readyz", s.handleReady)
	s.mux.HandleFunc("GET /v1/whoami", s.device(s.handleWhoami))
	s.mux.HandleFunc("POST /v1/events", s.device(s.handlePush))
	s.mux.HandleFunc("GET /v1/events", s.device(s.handlePull))
	s.mux.HandleFunc("GET /v1/admin/devices", s.admin(s.handleListDevices))
	s.mux.HandleFunc("POST /v1/admin/devices", s.admin(s.handleCreateDevice))
	s.mux.HandleFunc("POST /v1/admin/devices/{id}/{action}", s.admin(s.handleDeviceAction))
	s.mux.HandleFunc("GET /v1/admin/stats", s.admin(s.handleStats))
	s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "No such endpoint")
	})
}

// ServeHTTP applies security headers, rate limiting and access logging.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Frame-Options", "DENY")
	if r.TLS != nil {
		h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
	}

	rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	ip := s.clientIP(r)
	if !strings.HasPrefix(r.URL.Path, "/healthz") && !s.limiter.allow(ip, s.opts.Now()) {
		rec.Header().Set("Retry-After", "1")
		writeError(rec, http.StatusTooManyRequests, "rate_limited", "Too many requests")
	} else {
		r.Body = http.MaxBytesReader(rec, r.Body, s.opts.MaxBodyBytes)
		s.mux.ServeHTTP(rec, r)
	}

	if r.URL.Path != "/healthz" {
		// Never log query strings, bodies or tokens.
		s.opts.Logger.Info("request",
			"method", r.Method, "path", r.URL.Path, "status", rec.status,
			"duration_ms", time.Since(start).Milliseconds(), "device", rec.device, "ip", ip)
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	device string
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (s *Server) clientIP(r *http.Request) string {
	if s.opts.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			first, _, _ := strings.Cut(xff, ",")
			if ip := net.ParseIP(strings.TrimSpace(first)); ip != nil {
				return ip.String()
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

type errorBody struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, errorBody{Error: code, Message: msg})
}

func (s *Server) internalError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, context.Canceled) {
		return
	}
	s.opts.Logger.Error("internal error", "path", r.URL.Path, "err", err)
	writeError(w, http.StatusInternalServerError, "internal", "Internal server error")
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if ct := r.Header.Get("Content-Type"); ct != "" && !strings.HasPrefix(ct, "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Send application/json")
		return false
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "Request body is too large")
		} else {
			writeError(w, http.StatusBadRequest, "bad_json", "Request body is not valid JSON for this endpoint")
		}
		return false
	}
	if dec.More() {
		writeError(w, http.StatusBadRequest, "bad_json", "Unexpected data after JSON body")
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

type ctxKey int

const deviceKey ctxKey = 1

func deviceFrom(ctx context.Context) store.Device {
	d, _ := ctx.Value(deviceKey).(store.Device)
	return d
}

func (s *Server) device(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := s.clientIP(r)
		token, err := auth.BearerToken(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Missing device token")
			return
		}
		d, err := s.opts.Store.DeviceByTokenHash(r.Context(), auth.HashToken(token))
		if errors.Is(err, store.ErrNotFound) {
			if !s.authFail.allow(ip, s.opts.Now()) {
				writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many failed sign-ins")
				return
			}
			writeError(w, http.StatusUnauthorized, "unauthorized", "Unknown device token")
			return
		}
		if err != nil {
			s.internalError(w, r, err)
			return
		}
		if rec, ok := w.(*statusRecorder); ok {
			rec.device = d.ID
		}
		switch d.Status {
		case store.StatusWipe:
			writeError(w, http.StatusGone, "device_wipe", "This device must erase its local data")
			return
		case store.StatusRevoked:
			writeError(w, http.StatusUnauthorized, "device_revoked", "This device has been revoked")
			return
		}
		if err := s.opts.Store.TouchDevice(r.Context(), d.ID, s.opts.Now()); err != nil {
			s.opts.Logger.Warn("touch device", "err", err)
		}
		next(w, r.WithContext(context.WithValue(r.Context(), deviceKey, d)))
	}
}

func (s *Server) admin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.opts.AdminToken == "" {
			writeError(w, http.StatusNotFound, "admin_disabled", "The admin API is disabled; set KITCOUNT_ADMIN_TOKEN or use the CLI")
			return
		}
		ip := s.clientIP(r)
		token, err := auth.BearerToken(r)
		if err != nil || !auth.Equal(token, s.opts.AdminToken) {
			if !s.authFail.allow(ip, s.opts.Now()) {
				writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many failed sign-ins")
				return
			}
			writeError(w, http.StatusUnauthorized, "unauthorized", "Admin token required")
			return
		}
		next(w, r)
	}
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "version": version.Get()})
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.opts.Store.Ping(ctx); err != nil {
		s.opts.Logger.Warn("readiness check failed", "err", err)
		writeError(w, http.StatusServiceUnavailable, "not_ready", "Database is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

type whoamiResponse struct {
	Device struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"device"`
	Server struct {
		Version string `json:"version"`
		Build   string `json:"build"`
	} `json:"server"`
	Limits struct {
		MaxPushEvents int `json:"max_push_events"`
		MaxPullLimit  int `json:"max_pull_limit"`
		MaxBlobBytes  int `json:"max_blob_bytes"`
	} `json:"limits"`
}

func (s *Server) handleWhoami(w http.ResponseWriter, r *http.Request) {
	d := deviceFrom(r.Context())
	var resp whoamiResponse
	resp.Device.ID, resp.Device.Name = d.ID, d.Name
	v := version.Get()
	resp.Server.Version, resp.Server.Build = v.Version, v.Build
	resp.Limits.MaxPushEvents, resp.Limits.MaxPullLimit, resp.Limits.MaxBlobBytes = MaxPushEvents, MaxPullLimit, MaxBlobBytes
	writeJSON(w, http.StatusOK, resp)
}

type pushRequest struct {
	Events []struct {
		ID   string `json:"id"`
		Blob string `json:"blob"`
	} `json:"events"`
}

func (s *Server) handlePush(w http.ResponseWriter, r *http.Request) {
	var req pushRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.Events) == 0 {
		writeJSON(w, http.StatusOK, map[string]int{"accepted": 0, "duplicates": 0})
		return
	}
	if len(req.Events) > MaxPushEvents {
		writeError(w, http.StatusRequestEntityTooLarge, "too_many_events", "Send at most "+strconv.Itoa(MaxPushEvents)+" events per request")
		return
	}
	envs := make([]store.Envelope, 0, len(req.Events))
	for i, e := range req.Events {
		id := strings.ToLower(e.ID)
		if !store.IsUUID(id) {
			writeError(w, http.StatusUnprocessableEntity, "invalid_event", "events["+strconv.Itoa(i)+"].id must be a UUID")
			return
		}
		blob, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(e.Blob, "="))
		if err != nil {
			writeError(w, http.StatusUnprocessableEntity, "invalid_event", "events["+strconv.Itoa(i)+"].blob must be base64url")
			return
		}
		if len(blob) < MinBlobBytes || len(blob) > MaxBlobBytes {
			writeError(w, http.StatusUnprocessableEntity, "invalid_event", "events["+strconv.Itoa(i)+"].blob has an invalid size")
			return
		}
		envs = append(envs, store.Envelope{ID: id, Blob: blob})
	}
	accepted, dup, err := s.opts.Store.AppendEvents(r.Context(), deviceFrom(r.Context()).ID, envs)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"accepted": accepted, "duplicates": dup})
}

type pullRecord struct {
	Seq        int64  `json:"seq"`
	ID         string `json:"id"`
	Device     string `json:"device"`
	Blob       string `json:"blob"`
	ReceivedAt string `json:"received_at"`
}

func (s *Server) handlePull(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	after := int64(0)
	if v := q.Get("after"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			writeError(w, http.StatusBadRequest, "invalid_cursor", "after must be a non-negative integer")
			return
		}
		after = n
	}
	limit := DefaultPullSize
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > MaxPullLimit {
			writeError(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and "+strconv.Itoa(MaxPullLimit))
			return
		}
		limit = n
	}
	recs, err := s.opts.Store.EventsAfter(r.Context(), after, limit+1)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	more := len(recs) > limit
	if more {
		recs = recs[:limit]
	}
	out := make([]pullRecord, len(recs))
	next := after
	for i, rec := range recs {
		out[i] = pullRecord{
			Seq: rec.Seq, ID: rec.ID, Device: rec.DeviceID,
			Blob:       base64.RawURLEncoding.EncodeToString(rec.Blob),
			ReceivedAt: rec.ReceivedAt.UTC().Format(time.RFC3339),
		}
		next = rec.Seq
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": out, "next": next, "more": more})
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

func (s *Server) handleListDevices(w http.ResponseWriter, r *http.Request) {
	devices, err := s.opts.Store.ListDevices(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": devices})
}

// ValidDeviceName reports whether a device label is acceptable.
func ValidDeviceName(name string) bool {
	n := utf8.RuneCountInString(name)
	if n < 1 || n > MaxDeviceName {
		return false
	}
	for _, c := range name {
		if c < 0x20 || c == 0x7f {
			return false
		}
	}
	return true
}

// CreateDevice enrols a device and returns it with its one-time token.
func CreateDevice(ctx context.Context, st store.Store, name string) (store.Device, string, error) {
	token, err := auth.NewDeviceToken()
	if err != nil {
		return store.Device{}, "", err
	}
	d, err := st.CreateDevice(ctx, name, auth.HashToken(token))
	return d, token, err
}

func (s *Server) handleCreateDevice(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if !ValidDeviceName(name) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_name", "name must be 1-80 printable characters")
		return
	}
	d, token, err := CreateDevice(r.Context(), s.opts.Store, name)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	s.opts.Logger.Info("device created", "device", d.ID)
	writeJSON(w, http.StatusCreated, map[string]any{"device": d, "token": token})
}

func (s *Server) handleDeviceAction(w http.ResponseWriter, r *http.Request) {
	id := strings.ToLower(r.PathValue("id"))
	var status store.DeviceStatus
	switch r.PathValue("action") {
	case "revoke":
		status = store.StatusRevoked
	case "wipe":
		status = store.StatusWipe
	case "restore":
		status = store.StatusActive
	default:
		writeError(w, http.StatusNotFound, "not_found", "Unknown action; use revoke, wipe or restore")
		return
	}
	d, err := s.opts.Store.SetDeviceStatus(r.Context(), id, status)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "No such device")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	s.opts.Logger.Info("device status changed", "device", d.ID, "status", d.Status)
	writeJSON(w, http.StatusOK, map[string]any{"device": d})
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	st, err := s.opts.Store.Stats(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stats": st, "version": version.Get()})
}
