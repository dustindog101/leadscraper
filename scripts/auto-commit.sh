#!/usr/bin/env bash
# Auto-commit + push watcher for the leadscraper repo.
#
# Polls `git status` every WATCH_INTERVAL seconds; whenever there are
# uncommitted changes, stages everything, commits with a timestamped
# message, and pushes to origin.
#
# Usage:
#   ./scripts/auto-commit.sh                  # default 30s interval
#   GITHUB_TOKEN=ghp_xxx ./scripts/auto-commit.sh
#   WATCH_INTERVAL=10 ./scripts/auto-commit.sh
#
# To stop: pkill -f auto-commit.sh
#
# Authentication:
#   Set GITHUB_TOKEN env var to a GitHub Personal Access Token with `repo` scope.

cd "$(dirname "$0")/.."

WATCH_INTERVAL="${WATCH_INTERVAL:-30}"
REPO_URL="https://github.com/dustindog101/leadscraper.git"

# Configure remote URL with token if provided
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  echo "[auto-commit] using GITHUB_TOKEN for auth"
  git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/dustindog101/leadscraper.git" 2>/dev/null || true
fi

echo "[auto-commit] watching for changes every ${WATCH_INTERVAL}s — Ctrl+C to stop"
echo "[auto-commit] remote: ${REPO_URL}"

# Make sure we're on main
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  git branch -M main 2>/dev/null || true
fi

# Make sure git identity is set
if [[ -z "$(git config user.email 2>/dev/null)" ]]; then
  git config user.name "dustindog101"
  git config user.email "56493866+dustindog101@users.noreply.github.com"
fi

while true; do
  # Stage all changes (including new files)
  git add -A 2>/dev/null || true

  # Check if there's anything to commit (git diff returns 1 if changes exist)
  if git diff --cached --quiet 2>/dev/null; then
    sleep "$WATCH_INTERVAL"
    continue
  fi

  # Build a useful commit message listing changed files
  CHANGED=$(git diff --cached --name-only 2>/dev/null | head -10)
  COUNT=$(git diff --cached --name-only 2>/dev/null | wc -l)
  TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

  # Commit
  if git commit -m "auto: ${TIMESTAMP} (${COUNT} file(s))" -m "Changed files:" -m "${CHANGED}" --quiet 2>/dev/null; then
    NEW_HASH=$(git rev-parse HEAD 2>/dev/null)
    echo "[auto-commit ${TIMESTAMP}] committed ${NEW_HASH:0:8} (${COUNT} files)"

    # Push
    if git push origin main --quiet 2>&1; then
      echo "[auto-commit] pushed to origin/main"
    else
      echo "[auto-commit] push failed — will retry next cycle"
    fi
  fi

  sleep "$WATCH_INTERVAL"
done
