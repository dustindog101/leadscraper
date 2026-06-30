#!/usr/bin/env bash
# One-time setup: configures git, sets up auth, does the first commit + push.
#
# Usage:
#   GITHUB_TOKEN=ghp_xxxxxxxx ./scripts/git-setup.sh

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: Set GITHUB_TOKEN env var first."
  echo ""
  echo "  Get one at: https://github.com/settings/tokens/new"
  echo "  Scope needed: repo"
  echo ""
  echo "  Then run:"
  echo "    GITHUB_TOKEN=ghp_xxxxxxxx ./scripts/git-setup.sh"
  exit 1
fi

echo "=== Configuring git ==="
GIT_USER_NAME="${GIT_USER_NAME:-Manny}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-manny@cybershare.tech}"
git config user.name "$GIT_USER_NAME"
git config user.email "$GIT_USER_EMAIL"

echo "=== Setting remote URL with token auth ==="
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/dustindog101/leadscraper.git" 2>/dev/null || \
  git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/dustindog101/leadscraper.git"

echo "=== Staging all files ==="
git add -A

echo "=== Committing ==="
git commit -m "Initial commit: Cybershare Lead Scraper" --quiet || echo "(nothing new to commit)"

echo "=== Forcing push to main (overwrites remote if it has the default README) ==="
git branch -M main
git push -u origin main --force

echo ""
echo "=== Done! ==="
echo "Repo: https://github.com/dustindog101/leadscraper"
echo ""
echo "To start the auto-commit watcher (runs forever, polls every 30s):"
echo "  nohup ./scripts/auto-commit.sh > /tmp/auto-commit.log 2>&1 &"
echo ""
echo "Or with a custom interval:"
echo "  WATCH_INTERVAL=10 nohup ./scripts/auto-commit.sh > /tmp/auto-commit.log 2>&1 &"
