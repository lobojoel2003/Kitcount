package main

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func runCmd(t *testing.T, env map[string]string, args ...string) (string, string, error) {
	t.Helper()
	for k, v := range env {
		t.Setenv(k, v)
	}
	var out, errOut bytes.Buffer
	err := run(args, &out, &errOut)
	return out.String(), errOut.String(), err
}

func TestVersionAndHelp(t *testing.T) {
	out, _, err := runCmd(t, nil, "version")
	if err != nil || !strings.HasPrefix(out, "kitcount-server ") {
		t.Fatalf("version: %q %v", out, err)
	}
	out, _, err = runCmd(t, nil, "help")
	if err != nil || !strings.Contains(out, "KITCOUNT_DATABASE_URL") {
		t.Fatalf("help: %v", err)
	}
	if _, _, err := runCmd(t, map[string]string{"KITCOUNT_DATABASE_URL": "memory"}, "frobnicate"); err == nil {
		t.Fatal("unknown command should fail")
	}
}

func TestConfigValidation(t *testing.T) {
	cases := []map[string]string{
		{"KITCOUNT_ADMIN_TOKEN": "short"},
		{"KITCOUNT_TLS_CERT": "/x.pem"},
		{"KITCOUNT_TRUST_PROXY": "maybe"},
		{"KITCOUNT_MAX_BODY_BYTES": "10"},
		{"KITCOUNT_RATE_LIMIT": "-1"},
		{"KITCOUNT_LOG_LEVEL": "loud"},
	}
	for _, env := range cases {
		if _, _, err := runCmd(t, env, "migrate"); err == nil {
			t.Errorf("%v: expected config error", env)
		}
		for k := range env {
			os.Unsetenv(k)
		}
	}
	if _, _, err := runCmd(t, map[string]string{"KITCOUNT_DATABASE_URL": ""}, "migrate"); err == nil || !strings.Contains(err.Error(), "KITCOUNT_DATABASE_URL") {
		t.Fatalf("missing database: %v", err)
	}
}

func TestMemoryCommands(t *testing.T) {
	env := map[string]string{"KITCOUNT_DATABASE_URL": "memory", "KITCOUNT_LOG_FORMAT": "text"}
	out, _, err := runCmd(t, env, "migrate")
	if err != nil || !strings.Contains(out, "up to date") {
		t.Fatalf("migrate: %q %v", out, err)
	}
	out, _, err = runCmd(t, env, "device", "add", "-name", "Van 1")
	if err != nil || !strings.Contains(out, "kc_dev_") {
		t.Fatalf("device add: %q %v", out, err)
	}
	out, _, err = runCmd(t, env, "device", "add", "-json", "Backpack", "2")
	if err != nil {
		t.Fatal(err)
	}
	var created struct {
		Device struct{ Name string } `json:"device"`
		Token  string                `json:"token"`
	}
	if err := json.Unmarshal([]byte(out), &created); err != nil || created.Device.Name != "Backpack 2" || created.Token == "" {
		t.Fatalf("json add: %q %v", out, err)
	}
	if _, _, err := runCmd(t, env, "device", "add"); err == nil {
		t.Fatal("add without a name should fail")
	}
	out, _, err = runCmd(t, env, "device", "list")
	if err != nil || !strings.Contains(out, "LAST SEEN") {
		t.Fatalf("list: %q %v", out, err)
	}
	if _, _, err := runCmd(t, env, "device", "revoke"); err == nil {
		t.Fatal("revoke without id should fail")
	}
	if _, _, err := runCmd(t, env, "device", "wipe", "00000000-0000-4000-8000-000000000000"); err == nil {
		t.Fatal("wipe of unknown device should fail")
	}
	if _, _, err := runCmd(t, env, "device"); err == nil {
		t.Fatal("bare device should fail")
	}
	if _, _, err := runCmd(t, env, "device", "paint"); err == nil {
		t.Fatal("unknown device command should fail")
	}
}

func TestHealthcheck(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
	defer ok.Close()
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(503) }))
	defer bad.Close()
	if _, _, err := runCmd(t, nil, "healthcheck", "-url", ok.URL); err != nil {
		t.Fatalf("healthy: %v", err)
	}
	if _, _, err := runCmd(t, nil, "healthcheck", "-url", bad.URL); err == nil {
		t.Fatal("unhealthy should fail")
	}
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	addr := l.Addr().String()
	l.Close()
	if _, _, err := runCmd(t, map[string]string{"KITCOUNT_LISTEN": addr}, "healthcheck"); err == nil {
		t.Fatal("nothing listening should fail")
	}
}
