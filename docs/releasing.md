# Versioning and releases

## Version numbers

| What | Where | Example |
| --- | --- | --- |
| **Version** | [`/VERSION`](../VERSION) — single source of truth ([SemVer](https://semver.org)) | `1.0.0` |
| **Build number** | Commit count on `HEAD` (`git rev-list --count HEAD`), strictly increasing on `main` | `42` |
| **Tag** | `v` + version | `v1.0.0` |

[`scripts/version.sh`](../scripts/version.sh) prints all of them. They flow into:

- **App**: `app.config.ts` reads `/VERSION` for the version name, and
  `KITCOUNT_BUILD_NUMBER` for the Android `versionCode` and iOS
  `buildNumber`. Settings → About shows *Version 1.0.0 · build 42 · commit*.
- **Server**: linker flags set `version.Version`, `Build`, `Commit` and
  `Date`. `kitcount-server version` and `GET /healthz` report them.
- **Docker**: image tags `1.0.0`, `1.0`, `1` and `latest`, plus OCI labels.

## Cutting a release

1. Make sure `main` is green and `CHANGELOG.md` has entries under
   `## [Unreleased]`.
2. Run:

   ```bash
   scripts/release.sh 1.1.0
   git push origin main --follow-tags
   ```

   The script bumps `VERSION` and `app/package.json`, dates the changelog
   section, commits `Release v1.1.0` and creates the annotated tag.

   **Or release from the browser:** bump `VERSION`, `app/package.json` and
   `CHANGELOG.md` on `main`, then open **Actions → Release → Run workflow**
   on `main` and enter the tag (for example `v1.1.0`). The workflow builds
   the current `main` commit and creates the tag on it only after every
   artifact has built. Running it for a tag that already exists rebuilds
   that tag.
3. The tag (or the manual run) triggers [`release.yml`](../.github/workflows/release.yml):

   | Job | Output |
   | --- | --- |
   | Prepare | Checks the tag matches `VERSION`; release notes from `CHANGELOG.md` |
   | CI | Full test suite (reused from `ci.yml`) |
   | Server binaries | `kitcount-server_<v>_{linux,darwin}_{amd64,arm64}.tar.gz`, `windows_amd64.zip` |
   | Docker | Multi-arch image pushed to `ghcr.io/lobojoel2003/kitcount-server` |
   | Android | Signed APK and App Bundle |
   | Web demo | Static demo bundle (synthetic data) |
   | Publish | `SHA256SUMS` and the GitHub release with all assets |

   Every binary, APK, AAB and image gets a build provenance attestation:

   ```bash
   gh attestation verify kitcount-1.1.0-build57.apk --repo lobojoel2003/Kitcount
   ```

## Android signing

Without secrets, release builds are signed with the debug key. That is fine
for sideloading and testing, but Google Play needs your own upload key. Create
one once and store it as repository secrets:

```bash
keytool -genkeypair -v -keystore upload.jks -alias kitcount -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 upload.jks   # → ANDROID_UPLOAD_KEYSTORE_BASE64
```

| Secret | Value |
| --- | --- |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | base64 of `upload.jks` |
| `ANDROID_UPLOAD_STORE_PASSWORD` | keystore password |
| `ANDROID_UPLOAD_KEY_ALIAS` | `kitcount` |
| `ANDROID_UPLOAD_KEY_PASSWORD` | key password |

Keep `upload.jks` somewhere safe. Losing it means you can no longer update
the Play listing without Google's key reset process.

## Continuous integration

[`ci.yml`](../.github/workflows/ci.yml) runs on every push and pull request:

| Job | Checks |
| --- | --- |
| App | Template bundle up to date, Prettier, ESLint, TypeScript, Jest with coverage thresholds |
| Server | gofmt, `go vet`, `go test -race` against Postgres 17, govulncheck, build |
| End-to-end | TypeScript sync client ↔ compiled server ↔ Postgres |
| Web | Exports the web demo and drives it with Playwright |
| Docker | Builds the image and runs a health check |
| Android | Release APK build (on `main`; uploaded as a workflow artifact) |

[`codeql.yml`](../.github/workflows/codeql.yml) scans TypeScript, Go and the
workflows themselves. Dependabot keeps npm, Go modules, the Docker base image
and actions current. Expo SDK upgrades are done by hand with
`npx expo install --fix`.
