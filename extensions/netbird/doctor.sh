#!/usr/bin/env bash
# NetBird client connected, and the proxy entry answering on this peer.
set -euo pipefail
command -v netbird >/dev/null || { echo "netbird client not installed" >&2; exit 1; }
netbird status --json | node -e 'const s=JSON.parse(require("fs").readFileSync(0)); if(!s.management?.connected){console.error("NetBird is not connected to its management service"); process.exit(1)}'
# Only while the gateway runs: the panel's public name must ask for the project login.
if lsof -nP -iTCP:"$FYSO_EXT_NETBIRD_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  name=panel${FYSO_EXT_NETBIRD_SUFFIX:+-$FYSO_EXT_NETBIRD_SUFFIX}.$FYSO_EXT_NETBIRD_DOMAIN
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $name" "http://127.0.0.1:$FYSO_EXT_NETBIRD_PORT/")
  [ "$code" = 401 ] || { echo "proxy entry for $name answered $code, expected 401" >&2; exit 1; }
fi
