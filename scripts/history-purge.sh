#!/usr/bin/env bash
# Purge a provided literal secret from Git history using git-filter-repo.
# Usage: bash scripts/history-purge.sh "<secret-to-purge>"
set -euo pipefail

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "Install git-filter-repo first: https://github.com/newren/git-filter-repo" >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo 'Usage: bash scripts/history-purge.sh "<secret-to-purge>"' >&2
  exit 64
fi

SECRET="$1"
printf "%s==>REDACTED\n" "$SECRET" > /tmp/redactions.txt

git filter-repo --replace-text /tmp/redactions.txt --force
echo "✅ History rewritten. Force-push your branches:  git push --force-with-lease --all"

