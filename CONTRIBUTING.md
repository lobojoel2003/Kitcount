# Contributing to Kitcount

Thank you for helping. Kitcount exists for outreach workers and the people
they serve, so the most valuable contributions often come from people who do
this work: feedback from the field, state report templates, and bug reports
from real shifts.

## Ground rules

1. **Never add personal data.** No names, free-text notes, locations, photos
   or device identifiers about participants. If a feature seems to need them,
   open an issue first to discuss alternatives.
2. **Offline first.** Every feature must work with no signal and converge when
   devices sync later. Prefer new event types over editing old events.
3. **Keep the visit flow fast.** Logging a visit should stay at about 15
   seconds, one-handed.
4. **Never paste real data** into issues, pull requests, tests or screenshots.
   Use the demo data.

## Development setup

Requirements: Node.js 22, Go 1.26+, Postgres 15+ (for the server's contract
tests), and the Android SDK or Xcode to run the native app.

```bash
# App
cd app
npm ci
npm run web          # browser demo
npm run android      # development build on a device or emulator (SQLCipher needs a native build)
npm test             # unit tests
npm run lint && npm run typecheck && npm run format:check

# Server
cd server
go test ./...
KITCOUNT_TEST_DATABASE_URL=postgres://localhost/kitcount_test go test ./...
KITCOUNT_DATABASE_URL=memory go run ./cmd/kitcount-server
```

## Report templates

Templates live in [`/templates`](templates) and are documented in
[docs/report-templates.md](docs/report-templates.md). After editing one:

```bash
cd app && npm run templates && npm test
```

Commit both the YAML and the regenerated `src/core/reports/bundled-templates.ts`.
Link the official form in the template's `source`. A template for a real state
should come from, or be checked by, someone who files that state's report.

## Pull requests

- Keep each pull request focused on one change, with tests.
- Add a line to `CHANGELOG.md` under **Unreleased**.
- CI must be green: lint, types, unit tests, server tests, end-to-end, web
  smoke test, Docker and CodeQL.
- By contributing you agree that your contribution is licensed under the
  license of the part you change (GPL-3.0-or-later for the app and templates,
  AGPL-3.0 for the server).

## Code of conduct

Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
