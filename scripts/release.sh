#!/usr/bin/env bash
# Cuts a release: bumps /VERSION and the app's package.json, moves the
# "Unreleased" changelog entries under the new version, commits and creates an
# annotated tag. Pushing the tag triggers .github/workflows/release.yml.
#
#   scripts/release.sh 1.1.0
#   git push origin main --follow-tags
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

new="${1:-}"
if ! [[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: scripts/release.sh MAJOR.MINOR.PATCH" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean; commit or stash first." >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$new" >/dev/null; then
  echo "Tag v$new already exists." >&2
  exit 1
fi
if ! grep -q '^## \[Unreleased\]' CHANGELOG.md; then
  echo "CHANGELOG.md needs an '## [Unreleased]' section." >&2
  exit 1
fi

today="$(date -u +%Y-%m-%d)"
echo "$new" > VERSION
node -e '
  const fs = require("fs");
  const p = "app/package.json";
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  pkg.version = process.argv[1];
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
' "$new"
# Keep an empty Unreleased section on top and date the new release.
awk -v v="$new" -v d="$today" '
  /^## \[Unreleased\]/ && !done { print; print ""; print "## [" v "] - " d; done=1; next }
  { print }
' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md

git add VERSION app/package.json CHANGELOG.md
git commit -m "Release v$new"
git tag -a "v$new" -m "Kitcount v$new"
echo "Tagged v$new (build $(git rev-list --count HEAD)). Push with: git push origin main --follow-tags"
