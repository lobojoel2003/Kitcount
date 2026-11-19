# Deploying Kitcount

A program needs two things: the **app** on each outreach phone or tablet, and
(optionally) one **sync server** at the office. Without a server, every device
works on its own and reports cover only that device.

## 1. Run the sync server

Requirements: a small Linux machine or VM (1 vCPU, 1 GB RAM is plenty),
Docker, and a domain name pointing at it if it will be reachable from the
internet.

```bash
git clone https://github.com/lobojoel2003/Kitcount.git
cd Kitcount/deploy
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD (openssl rand -base64 24) and KITCOUNT_DOMAIN.
docker compose --profile https up -d
```

Caddy obtains a Let's Encrypt certificate for `KITCOUNT_DOMAIN`
automatically. To run behind your own reverse proxy instead, use
`docker compose up -d` and proxy to port 8080 (set `KITCOUNT_TRUST_PROXY=true`).

Check it: `curl https://sync.example.org/healthz`.

### Backups

The `pgdata` volume holds only ciphertext, but it is still your program's only
off-device copy. Back it up nightly:

```bash
docker compose exec -T db pg_dump -U kitcount kitcount | gzip > kitcount-$(date +%F).sql.gz
```

### Upgrades

```bash
cd Kitcount && git pull
cd deploy && docker compose pull && docker compose up -d   # migrations run automatically
```

Pin `KITCOUNT_VERSION` in `.env` to a release (for example `1.0.0`) to
upgrade deliberately.

## 2. Set up the first device

1. Install the app. Android: download `kitcount-<version>-build<n>.apk` from
   the [latest release](https://github.com/lobojoel2003/Kitcount/releases/latest)
   and allow installation from your browser or file manager. iOS: build with
   Xcode (`npx expo run:ios --configuration Release`) or EAS. A store listing
   is on the roadmap.
2. Open Kitcount → **Set up a new program**, name the program, pick a default
   report and choose a 6-digit PIN.
3. Settings → **Supplies & referrals**: switch off tiles you don't hand out,
   and set tap amounts and warning levels.
4. Settings → **Program details**: write how staff should build participant
   codes. Optionally add a pattern to enforce it.

## 3. Connect devices to the server

On the server, create one token per device:

```bash
docker compose exec server kitcount-server device add -name "Van 1"
```

In the app: Settings → **Sync** → enter the server address and paste the token.

## 4. Add more devices

On a set-up device: Settings → **Add a device** → enter the PIN → show the QR
code. On the new device: **Join with an enrollment code** → scan → check that
the fingerprints match → choose a PIN → connect it to sync with its own token.

## Lost or stolen device

```bash
docker compose exec server kitcount-server device list
docker compose exec server kitcount-server device wipe <id>    # erase on next contact
# or
docker compose exec server kitcount-server device revoke <id>  # just block it
```

If the enrollment code itself may have leaked, start a new program and
re-enrol all devices: the old program secret can decrypt old data.
