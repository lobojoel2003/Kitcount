// Package auth issues and verifies bearer tokens.
//
// Device tokens are 256-bit random values. The server stores only their
// SHA-256 hash, so a database dump cannot be used to impersonate a device.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
)

// DeviceTokenPrefix makes tokens recognisable to secret scanners and humans.
const DeviceTokenPrefix = "kc_dev_"

// NewDeviceToken returns a new random device token.
func NewDeviceToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return DeviceTokenPrefix + base64.RawURLEncoding.EncodeToString(b), nil
}

// HashToken returns the SHA-256 digest of a token.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// ErrNoToken is returned when the Authorization header is missing or malformed.
var ErrNoToken = errors.New("missing bearer token")

// BearerToken extracts the token from an Authorization: Bearer header.
func BearerToken(r *http.Request) (string, error) {
	h := r.Header.Get("Authorization")
	const prefix = "bearer "
	if len(h) <= len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return "", ErrNoToken
	}
	t := strings.TrimSpace(h[len(prefix):])
	if t == "" || len(t) > 512 {
		return "", ErrNoToken
	}
	return t, nil
}

// Equal compares two secrets in constant time (by hashing first, so lengths
// do not leak).
func Equal(a, b string) bool {
	ha := sha256.Sum256([]byte(a))
	hb := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(ha[:], hb[:]) == 1
}
