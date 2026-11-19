#!/usr/bin/env bash
# Prints the CHANGELOG.md section for a version (used for GitHub release notes).
#   scripts/release-notes.sh 1.0.0
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="${1:?usage: scripts/release-notes.sh VERSION}"
notes="$(awk -v v="$version" '
  $0 ~ "^## \\[" v "\\]" { found=1; next }
  found && /^## \[/ { exit }
  found { print }
' "$root/CHANGELOG.md")"
if [[ -z "${notes//[[:space:]]/}" ]]; then
  echo "No CHANGELOG.md entry for $version" >&2
  exit 1
fi
printf '%s\n' "$notes" | sed -e '/./,$!d'
