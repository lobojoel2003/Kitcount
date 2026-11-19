# Changelog

All notable changes to Kitcount are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). One version number
covers the app, the sync server and the report template format.

## [Unreleased]

## [1.0.0] - 2026-11-19

The first release of Kitcount, the offline-first, privacy-first data app for
syringe services programs.

### App (Android and iOS)

- **Log a visit in about 15 seconds, one-handed**: participant code with instant
  *new* / *returning* feedback, supply tiles (tap to add, hold to remove),
  syringes collected, overdose reversals, secondary distribution, referrals,
  and undo.
- **Privacy**: no names or free-text fields; participant codes stored only as
  an HMAC keyed by the program secret.
- **Security**: SQLCipher-encrypted database with its key in the Keychain or
  Keystore; 6-digit PIN; auto-lock; screenshot blocking; wipe after 10 wrong
  PINs; duress PIN; hold-to-confirm panic wipe; remote wipe.
- **Inventory**: per-device stock that counts down with every visit, program
  totals, deliveries, physical counts and removals, naloxone-first low-stock
  warnings with visits-left forecasts.
- **Reports**: YAML report templates with metrics, filters, formulas and
  manually entered rows; month, quarter and year navigation; PDF and CSV
  export; template import.
- **Sync**: end-to-end encrypted (XChaCha20-Poly1305) with automatic retry;
  enrol devices by QR code with a program fingerprint check.
- Configurable supply catalog, referral types and participant code format,
  synced to every device.
- Light and dark themes; browser demo with synthetic data.

### Sync server

- Zero-knowledge relay in Go with Postgres: stores only encrypted envelopes.
- Device tokens stored as SHA-256 hashes; revoke, wipe and restore devices
  from the CLI or the optional admin API.
- Gap-free, commit-ordered sequence numbers; idempotent uploads; rate limiting;
  security headers; health and readiness endpoints.
- Static, non-root Docker image and a Docker Compose deployment with optional
  automatic HTTPS (Caddy).

### Report templates

- `generic-monthly`, `generic-quarterly` and a fully commented
  `example-state-form`, plus a JSON Schema for editor support.

### Project

- CI: lint, type checks, unit tests with coverage thresholds, Postgres-backed
  server tests, cross-language end-to-end sync tests, a browser smoke test,
  Docker and Android builds, CodeQL and Dependabot.
- Release automation: server binaries for five platforms, a multi-arch GHCR
  image, Android APK and App Bundle, web demo, checksums and build provenance
  attestations.

[Unreleased]: https://github.com/lobojoel2003/Kitcount/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/lobojoel2003/Kitcount/releases/tag/v1.0.0
