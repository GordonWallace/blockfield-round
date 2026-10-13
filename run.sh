#!/usr/bin/env sh
# Serves Blockfield Round on http://localhost:8000 (needs Python 3 or Node.js).
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"
echo "Blockfield Round: http://localhost:$PORT"
if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server "$PORT"; fi
exec npx --yes http-server -p "$PORT" -c-1 .
