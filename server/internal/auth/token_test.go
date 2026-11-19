package auth

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNewDeviceToken(t *testing.T) {
	a, err := NewDeviceToken()
	if err != nil {
		t.Fatal(err)
	}
	b, _ := NewDeviceToken()
	if a == b || !strings.HasPrefix(a, DeviceTokenPrefix) || len(a) != len(DeviceTokenPrefix)+43 {
		t.Fatalf("unexpected tokens %q %q", a, b)
	}
	if len(HashToken(a)) != 32 || string(HashToken(a)) == string(HashToken(b)) {
		t.Fatal("hash")
	}
}

func TestBearerToken(t *testing.T) {
	cases := map[string]string{
		"Bearer abc":                         "abc",
		"bearer   abc  ":                     "abc",
		"BEARER abc":                         "abc",
		"Basic abc":                          "",
		"Bearer ":                            "",
		"":                                   "",
		"Bearer " + strings.Repeat("x", 600): "",
	}
	for header, want := range cases {
		r := httptest.NewRequest("GET", "/", nil)
		if header != "" {
			r.Header.Set("Authorization", header)
		}
		got, err := BearerToken(r)
		if want == "" && err == nil {
			t.Errorf("%q: expected error", header)
		}
		if want != "" && got != want {
			t.Errorf("%q: got %q", header, got)
		}
	}
}

func TestEqual(t *testing.T) {
	if !Equal("same", "same") || Equal("same", "diff") || Equal("short", "longer value") {
		t.Fatal("Equal")
	}
}
