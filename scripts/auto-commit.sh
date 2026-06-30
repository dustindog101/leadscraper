#!/usr/bin/env bash
# Auto-commit + push watcher for the leadscraper repo.
#
# Polls `git status` every WATCH_INTERVAL seconds; whenever there are
# uncommitted changes, stages everything, commits with a timestamped
# message, and pushes to origin.
#
# Usage:
#   ./scripts/auto-commit.sh                  # default 30s interval
#   WATCH_INTERVAL=10 ./scripts/auto-commit.sh  # custom interval
#
# To stop: kill the process or `pkill -f auto-commit.sh`.
#
# Authentication:
#   Set the GITHUB_TOKEN env var to a GitHub Personal Access Token
#   with `repo` scope. The script will configure the remote URL with
#   the token embedded so pushes don't prompt for credentials.
#   Alternative: run `gh auth login` once and the credential helper
#   will be used automatically.

set -euo pipefail

cd "$(dirname "$0")/.."

WATCH_INTERVAL="${WATCH_INTERVAL:-30}"
REPO_URL="https://github.com/dustindog101/leadscraper.git"

# Configure remote URL with token if provided
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  echo "[auto-commit] using GITHUB_TOKEN for auth"
  git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/dustindog101/leadscraper.git"
fi

echo "[auto-commit] watching for changes every ${WATCH_INTERVAL}s — Ctrl+C to stop"
echo "[auto-commit] remote: ${REPO_URL}"

# Make sure we're on main
git branch --show-current 2>/dev/null | grep -q main || git branch -M main

# Make sure git identity is set (use GitHub noreply email to avoid publish-private-email errors)
if [[ -z "$(git config user.email)" ]]; then
  git config user.name "dustindog101"
  git config user.email "56493866+dustindog101@users.noreply.github.com"
fi

LAST_HASH=$(git rev-parse HEAD 2>/dev/null || echo "none")

while true; do
  # Stage all changes (including new files)
  git add -A

  # Check if there's anything to commit
  if git diff --cached --quiet; then
    sleep "$WATCH_INTERVAL"
    continue
  fi

  # Build a useful commit message listing changed files
  CHANGED=$(git diff --cached --name-only | head -10)
  COUNT=$(git diff --cached --name-only | wc -l)
  TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

  # Commit
  if git commit -m "auto: ${TIMESTAMP} (${COUNT} file(s))" -m "Changed files:" -m "${CHANGED}" --quiet; then
    NEW_HASH=$(git rev-parse HEAD)
    echo "[auto-commit ${TIMESTAMP}] committed ${NEW_HASH:0:8} (${COUNT} files)"

    # Push
    if git push origin main --quiet 2>&1; then
      echo "[auto-commit] pushed to origin/main"
    else
      echo "[auto-commit] push failed — will retry next cycle"
      # Undo the commit so it gets retried with the next batch
      # (Actually keep it — next push will include any new changes too)
    fi

    LAST_HASH="$NEW_HASH"
  fi

  sleep "$WATCH_INTERVAL"
done
