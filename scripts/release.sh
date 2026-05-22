#!/usr/bin/env bash
set -euo pipefail

TARGET_FILE="docs/sportadmin-helper.user.js"
DEFAULT_REMOTE="origin"

do_push=false
version=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      do_push=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--push] [YYYY.MM.MINOR]"
      exit 0
      ;;
    *)
      if [[ -n "$version" ]]; then
        echo "Usage: $0 [--push] [YYYY.MM.MINOR]" >&2
        exit 1
      fi
      version="$1"
      shift
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: this script must be run inside a git repository" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree is not clean. Commit or stash changes first." >&2
  echo "Hint: run 'git status --short' to inspect pending changes." >&2
  exit 1
fi

version_arg=()
if [[ -n "$version" ]]; then
  version_arg=("$version")
fi

bash scripts/bump-version.sh "${version_arg[@]}"

new_version="$({ grep -E '^// @version[[:space:]]+' "$TARGET_FILE" || true; } | head -n1 | sed -E 's|^// @version[[:space:]]+||')"
if [[ -z "$new_version" ]]; then
  echo "Error: failed to read new version from $TARGET_FILE" >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"

git add "$TARGET_FILE"
git commit -m "release: v$new_version"

echo "Release complete: v$new_version"
if [[ "$do_push" == "true" ]]; then
  git push "$DEFAULT_REMOTE" "$branch"
  echo "Pushed branch '$branch' to '$DEFAULT_REMOTE'."
else
  echo "Push skipped by default. Use --push to publish."
fi
