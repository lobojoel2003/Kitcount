#!/usr/bin/env bash
# Prints release metadata as KEY=value lines (suitable for $GITHUB_OUTPUT).
#
#   VERSION  semantic version from /VERSION (single source of truth)
#   BUILD    build number = number of commits on HEAD. Strictly increasing on
#            main, reproducible anywhere, and used as Android versionCode,
#            iOS buildNumber and the server's build number.
#   COMMIT   full commit SHA
#   TAG      v$VERSION
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(tr -d '[:space:]' < "$root/VERSION")"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "VERSION must be MAJOR.MINOR.PATCH (got '$version')" >&2
  exit 1
fi
build="$(git -C "$root" rev-list --count HEAD)"
commit="$(git -C "$root" rev-parse HEAD)"
echo "VERSION=$version"
echo "BUILD=$build"
echo "COMMIT=$commit"
echo "TAG=v$version"
echo "DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
