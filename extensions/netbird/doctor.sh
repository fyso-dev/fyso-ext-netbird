#!/usr/bin/env bash
# NetBird connected, web_domain set, the relay listening and this project's
# addresses resolving to this peer.
set -euo pipefail
command -v netbird >/dev/null || { echo "netbird client not installed" >&2; exit 1; }
ip=$(netbird status --json | node -e 'const s=JSON.parse(require("fs").readFileSync(0)); if(!s.management?.connected){console.error("NetBird is not connected to its management service"); process.exit(1)} console.log(s.netbirdIp.split("/")[0])')
case "${FYSO_WEB_DOMAIN:-}" in
  ''|*.localhost) echo "web_domain is ${FYSO_WEB_DOMAIN:-empty}: answer it with a name in a NetBird DNS zone" >&2; exit 1 ;;
esac
# Only while the gateway runs. This peer cannot reach its own NetBird IP (the
# packets enter the tunnel), so the relay is checked by its listener, not a request.
if lsof -nP -iTCP:"$FYSO_HTTP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  lsof -nP -iTCP@"$ip:$FYSO_HTTP_PORT" -sTCP:LISTEN >/dev/null 2>&1 \
    || { echo "no relay listens on $ip:$FYSO_HTTP_PORT (process ext-netbird-forward)" >&2; exit 1; }
  host=panel.$FYSO_WEB_DOMAIN
  resolved=$(node -e 'require("dns").lookup(process.argv[1], {family: 4}, (e, a) => console.log(e ? "" : a))' "$host")
  [ "$resolved" = "$ip" ] || { echo "$host resolves to ${resolved:-nothing}, expected $ip: run netbird:sync" >&2; exit 1; }
fi
