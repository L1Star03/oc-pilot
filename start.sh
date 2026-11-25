#!/bin/bash
# oc-pilot start script (Linux/macOS)
# Usage: PILOT_TOKEN=secret ./start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN="${PILOT_TOKEN:-}"
PORT="${PORT:-4097}"

if [ -z "$TOKEN" ]; then
  echo "[auto-token] generating random token..."
  TOKEN=$(openssl rand -hex 8 2>/dev/null || head -c8 /dev/urandom | xxd -p)
fi

export PILOT_TOKEN="$TOKEN"
export PORT="$PORT"

echo "oc-pilot starting on http://127.0.0.1:$PORT"
echo "  token: $TOKEN"
echo "  opencode: ${OPENCODE_PORT:-4096}"

cd "$SCRIPT_DIR"
node server.js
