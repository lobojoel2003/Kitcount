// Command kitcount-server is the self-hosted sync server for Kitcount.
//
//	kitcount-server serve                 Run the HTTP API (default)
//	kitcount-server migrate               Apply database migrations and exit
//	kitcount-server device add -name NAME Enrol a device and print its token
//	kitcount-server device list           List devices
//	kitcount-server device revoke ID      Refuse a device (lost phone, staff left)
//	kitcount-server device wipe ID        Tell a device to erase itself on next sync
//	kitcount-server device restore ID     Re-activate a revoked device
//	kitcount-server healthcheck           Probe /healthz (for container health checks)
//	kitcount-server version               Print version information
//
// Configuration is read from environment variables; see server/README.md.
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/lobojoel2003/Kitcount/server/internal/api"
	"github.com/lobojoel2003/Kitcount/server/internal/store"
	"github.com/lobojoel2003/Kitcount/server/internal/version"
)

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

type config struct {
	listen       string
	databaseURL  string
	adminToken   string
	tlsCert      string
	tlsKey       string
	trustProxy   bool
	maxBodyBytes int64
	rateLimit    float64
	logFormat    string
	logLevel     slog.Level
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func loadConfig() (config, error) {
	c := config{
		listen:      env("KITCOUNT_LISTEN", ":8080"),
		databaseURL: env("KITCOUNT_DATABASE_URL", env("DATABASE_URL", "")),
		adminToken:  env("KITCOUNT_ADMIN_TOKEN", ""),
		tlsCert:     env("KITCOUNT_TLS_CERT", ""),
		tlsKey:      env("KITCOUNT_TLS_KEY", ""),
		logFormat:   env("KITCOUNT_LOG_FORMAT", "json"),
	}
	var err error
	if c.trustProxy, err = strconv.ParseBool(env("KITCOUNT_TRUST_PROXY", "false")); err != nil {
		return c, fmt.Errorf("KITCOUNT_TRUST_PROXY: %w", err)
	}
	if c.maxBodyBytes, err = strconv.ParseInt(env("KITCOUNT_MAX_BODY_BYTES", "8388608"), 10, 64); err != nil || c.maxBodyBytes < 1024 {
		return c, errors.New("KITCOUNT_MAX_BODY_BYTES must be an integer >= 1024")
	}
	if c.rateLimit, err = strconv.ParseFloat(env("KITCOUNT_RATE_LIMIT", "20"), 64); err != nil || c.rateLimit <= 0 {
		return c, errors.New("KITCOUNT_RATE_LIMIT must be a positive number")
	}
	if err := c.logLevel.UnmarshalText([]byte(env("KITCOUNT_LOG_LEVEL", "info"))); err != nil {
		return c, fmt.Errorf("KITCOUNT_LOG_LEVEL: %w", err)
	}
	if c.adminToken != "" && len(c.adminToken) < 32 {
		return c, errors.New("KITCOUNT_ADMIN_TOKEN must be at least 32 characters (try: openssl rand -base64 32)")
	}
	if (c.tlsCert == "") != (c.tlsKey == "") {
		return c, errors.New("set both KITCOUNT_TLS_CERT and KITCOUNT_TLS_KEY, or neither")
	}
	return c, nil
}

func newLogger(c config, w io.Writer) *slog.Logger {
	opts := &slog.HandlerOptions{Level: c.logLevel}
	if c.logFormat == "text" {
		return slog.New(slog.NewTextHandler(w, opts))
	}
	return slog.New(slog.NewJSONHandler(w, opts))
}

func openStore(ctx context.Context, c config, log *slog.Logger, migrate bool) (store.Store, error) {
	switch {
	case c.databaseURL == "":
		return nil, errors.New("KITCOUNT_DATABASE_URL is not set (use a postgres:// URL, or \"memory\" for a throwaway demo)")
	case c.databaseURL == "memory" || c.databaseURL == "memory://":
		log.Warn("using the in-memory store: all data is lost when the server stops")
		return store.NewMemory(), nil
	}
	pg, err := store.OpenPostgres(ctx, c.databaseURL)
	if err != nil {
		return nil, err
	}
	if migrate {
		applied, err := pg.Migrate(ctx)
		if err != nil {
			pg.Close()
			return nil, fmt.Errorf("migrate: %w", err)
		}
		for _, m := range applied {
			log.Info("applied migration", "name", m)
		}
	}
	return pg, nil
}

func run(args []string, stdout, stderr io.Writer) error {
	cmd := "serve"
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "version", "-version", "--version", "-v":
		fmt.Fprintln(stdout, version.Get().String())
		return nil
	case "help", "-h", "--help":
		usage(stdout)
		return nil
	case "healthcheck":
		return healthcheck(args)
	}

	c, err := loadConfig()
	if err != nil {
		return err
	}
	log := newLogger(c, stderr)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch cmd {
	case "serve":
		return serve(ctx, c, log)
	case "migrate":
		st, err := openStore(ctx, c, log, true)
		if err != nil {
			return err
		}
		st.Close()
		fmt.Fprintln(stdout, "database is up to date")
		return nil
	case "device", "devices":
		return deviceCmd(ctx, c, log, args, stdout)
	default:
		usage(stderr)
		return fmt.Errorf("unknown command %q", cmd)
	}
}

func usage(w io.Writer) {
	fmt.Fprint(w, `kitcount-server — self-hosted, zero-knowledge sync server for Kitcount

Usage:
  kitcount-server [serve]               Run the HTTP API
  kitcount-server migrate               Apply database migrations
  kitcount-server device add -name NAME Enrol a device and print its token (shown once)
  kitcount-server device list           List devices
  kitcount-server device revoke ID      Refuse a device
  kitcount-server device wipe ID        Make a device erase its data on next sync
  kitcount-server device restore ID     Re-activate a device
  kitcount-server healthcheck [-url U]  Exit 0 if the server is healthy
  kitcount-server version               Print version information

Environment:
  KITCOUNT_DATABASE_URL   postgres://user:pass@host/db (required; "memory" for a demo)
  KITCOUNT_LISTEN         Listen address (default :8080)
  KITCOUNT_ADMIN_TOKEN    Enables the /v1/admin HTTP API (>= 32 chars)
  KITCOUNT_TLS_CERT/KEY   Serve HTTPS directly instead of behind a proxy
  KITCOUNT_TRUST_PROXY    Trust X-Forwarded-For (default false)
  KITCOUNT_RATE_LIMIT     Requests per second per client (default 20)
  KITCOUNT_LOG_FORMAT     json or text (default json)
  KITCOUNT_LOG_LEVEL      debug, info, warn, error (default info)
`)
}

func serve(ctx context.Context, c config, log *slog.Logger) error {
	st, err := openStore(ctx, c, log, true)
	if err != nil {
		return err
	}
	defer st.Close()

	handler := api.New(api.Options{
		Store: st, Logger: log, AdminToken: c.adminToken, MaxBodyBytes: c.maxBodyBytes,
		TrustProxy: c.trustProxy, RateLimit: c.rateLimit,
	})
	srv := &http.Server{
		Addr:              c.listen,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    32 << 10,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}
	if c.tlsCert != "" {
		srv.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("kitcount-server listening", "addr", c.listen, "tls", c.tlsCert != "", "admin_api", c.adminToken != "", "version", version.Version, "build", version.Build)
		if c.tlsCert != "" {
			errCh <- srv.ListenAndServeTLS(c.tlsCert, c.tlsKey)
		} else {
			errCh <- srv.ListenAndServe()
		}
	}()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		log.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}

func deviceCmd(ctx context.Context, c config, log *slog.Logger, args []string, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: kitcount-server device add|list|revoke|wipe|restore")
	}
	sub, args := args[0], args[1:]
	st, err := openStore(ctx, c, log, true)
	if err != nil {
		return err
	}
	defer st.Close()

	switch sub {
	case "add":
		fs := flag.NewFlagSet("device add", flag.ContinueOnError)
		name := fs.String("name", "", "label for the device, e.g. \"Van 1\"")
		asJSON := fs.Bool("json", false, "print JSON")
		if err := fs.Parse(args); err != nil {
			return err
		}
		n := strings.TrimSpace(*name)
		if n == "" && fs.NArg() > 0 {
			n = strings.TrimSpace(strings.Join(fs.Args(), " "))
		}
		if !api.ValidDeviceName(n) {
			return errors.New("give the device a name of 1-80 characters with -name")
		}
		d, token, err := api.CreateDevice(ctx, st, n)
		if err != nil {
			return err
		}
		if *asJSON {
			return json.NewEncoder(stdout).Encode(map[string]any{"device": d, "token": token})
		}
		fmt.Fprintf(stdout, "Device %q enrolled (id %s).\n\nDevice token (shown once — enter it in Kitcount under Settings → Sync):\n\n  %s\n\n", d.Name, d.ID, token)
		return nil
	case "list", "ls":
		devices, err := st.ListDevices(ctx)
		if err != nil {
			return err
		}
		tw := tabwriter.NewWriter(stdout, 0, 4, 2, ' ', 0)
		fmt.Fprintln(tw, "ID\tNAME\tSTATUS\tCREATED\tLAST SEEN")
		for _, d := range devices {
			seen := "never"
			if d.LastSeenAt != nil {
				seen = d.LastSeenAt.UTC().Format(time.RFC3339)
			}
			fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n", d.ID, d.Name, d.Status, d.CreatedAt.UTC().Format(time.RFC3339), seen)
		}
		return tw.Flush()
	case "revoke", "wipe", "restore":
		if len(args) != 1 {
			return fmt.Errorf("usage: kitcount-server device %s DEVICE_ID", sub)
		}
		status := map[string]store.DeviceStatus{"revoke": store.StatusRevoked, "wipe": store.StatusWipe, "restore": store.StatusActive}[sub]
		d, err := st.SetDeviceStatus(ctx, strings.ToLower(args[0]), status)
		if errors.Is(err, store.ErrNotFound) {
			return fmt.Errorf("no device with id %s", args[0])
		}
		if err != nil {
			return err
		}
		fmt.Fprintf(stdout, "Device %q (%s) is now %s.\n", d.Name, d.ID, d.Status)
		return nil
	default:
		return fmt.Errorf("unknown device command %q", sub)
	}
}

func healthcheck(args []string) error {
	fs := flag.NewFlagSet("healthcheck", flag.ContinueOnError)
	addr := env("KITCOUNT_LISTEN", ":8080")
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	url := fs.String("url", "http://"+addr+"/healthz", "health endpoint")
	if err := fs.Parse(args); err != nil {
		return err
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(*url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unhealthy: HTTP %d", resp.StatusCode)
	}
	return nil
}
