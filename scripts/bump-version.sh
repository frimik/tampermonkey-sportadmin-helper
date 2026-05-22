#!/usr/bin/env bash
set -euo pipefail

SCRIPT_FILE="docs/sportadmin-helper.user.js"
VERSION_PATTERN='^[0-9]{4}\.[0-9]{2}\.[0-9]+$'

if [[ ! -f "$SCRIPT_FILE" ]]; then
  echo "Error: $SCRIPT_FILE not found" >&2
  exit 1
fi

current_version="$({ grep -E '^// @version[[:space:]]+' "$SCRIPT_FILE" || true; } | head -n1 | sed -E 's|^// @version[[:space:]]+||')"
if [[ -z "$current_version" ]]; then
  echo "Error: could not find @version in $SCRIPT_FILE" >&2
  exit 1
fi

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [YYYY.MM.MINOR]" >&2
  exit 1
fi

if [[ $# -eq 1 ]]; then
  new_version="$1"
  if [[ ! "$new_version" =~ $VERSION_PATTERN ]]; then
    echo "Error: explicit version must match YYYY.MM.MINOR (example: 2026.05.0)" >&2
    exit 1
  fi
else
  now_prefix="$(date -u +%Y.%m)"

  if [[ "$current_version" =~ ^([0-9]{4})\.([0-9]{2})\.([0-9]+)$ ]]; then
    current_prefix="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
    current_minor="${BASH_REMATCH[3]}"
  else
    echo "Error: current version '$current_version' does not match YYYY.MM.MINOR" >&2
    exit 1
  fi

  if [[ "$current_prefix" == "$now_prefix" ]]; then
    new_minor=$((current_minor + 1))
  else
    new_minor=0
  fi

  new_version="$now_prefix.$new_minor"
fi

tmp_file="$(mktemp)"
awk -v new_version="$new_version" '
  BEGIN { updated = 0 }
  {
    if (!updated && $0 ~ /^\/\/ @version[[:space:]]+/) {
      print "// @version      " new_version
      updated = 1
      next
    }
    print
  }
  END {
    if (!updated) {
      exit 2
    }
  }
' "$SCRIPT_FILE" > "$tmp_file"

mv "$tmp_file" "$SCRIPT_FILE"

echo "Updated $SCRIPT_FILE"
echo "Old version: $current_version"
echo "New version: $new_version"
