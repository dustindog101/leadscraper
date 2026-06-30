#!/usr/bin/env bash
# Start the auto-commit watcher in the background.
# Run this once when you start working on the project.
#
# Usage:
#   ./scripts/start-watcher.sh
#
# To stop:
#   pkill -f auto-commit.sh
#
# To check if it's running:
#   pgrep -f auto-commit.sh

cd "$(dirname "$0")/.."

if pgrep -f "auto-commit.sh" > /dev/null; then
  echo "[watcher] Already running (PID $(pgrep -f auto-commit.sh | head -1))"
  exit 0
fi

if [[ -z "${GITHUB_TOKEN:-${GH_TOKEN:-}}" ]]; then
  echo "ERROR: Set GITHUB_TOKEN env var first."
  echo ""
  echo "  GITHUB_TOKEN=ghp_xxxxxxxx ./scripts/start-watcher.sh"
  exit 1
fi

# Use the token from whichever env var is set
TOKEN="${GITHUB_TOKEN:-$GH_TOKEN}"

# Start the watcher, detached from this shell
GITHUB_TOKEN="$TOKEN" nohup bash ./scripts/auto-commit.sh > /home/z/my-project/auto-commit.log 2>&1 &
WATCHER_PID=$!
disown

echo "[watcher] Started auto-commit watcher (PID $WATCHER_PID)"
echo "[watcher] Polling every 30 seconds for changes"
echo "[watcher] Log: /home/z/my-project/auto-commit.log"
echo ""
echo "[watcher] To stop: pkill -f auto-commit.sh"
echo "[watcher] To check: pgrep -f auto-commit.sh"
