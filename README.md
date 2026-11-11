# fyso-ext-netbird

Fyso Agentic Framework extension that lets NetBird peers open a project's apps
at the project's own addresses, with the project's web login, over WireGuard.

Requires a framework with configurable `web_domain` (D61, `v0.1.0-rc.2` or later).

```sh
# 1. In NetBird: Dashboard → DNS → Zones, a zone such as etendo.internal for your peers.
# 2. The project's addresses inside that zone:
uvx copier update --trust --skip-answered -d web_domain=host1.etendo.internal
# 3. The extension, from the panel (Apps → Marketplace) or the terminal:
mise run ext:add netbird
mise run secrets            # NETBIRD_API_TOKEN
mise run netbird:plan       # or the Dagu workflow ext-netbird-sync
mise run netbird:sync       # creates/updates DNS records; never deletes
```

- Addresses: the panel, login, Dagu, OpenMausBot and every app on
  `web_domain`, e.g. `http://panel.host1.etendo.internal:<port>`. One A record
  each, in the most specific enabled zone that holds `web_domain`, pointing at
  this peer's NetBird IP.
- The `ext-netbird-forward` process listens on this peer's NetBird IP and the
  gateway's port, accepts NetBird peers only (100.64.0.0/10) and relays to the
  loopback gateway. Host, port and scheme stay the same end to end, so the
  login, its cookies and the same-origin checks work unchanged.
- Plain HTTP inside WireGuard: only NetBird peers reach it. This is not public
  HTTPS; the framework keeps that behind its Phase 6 gate.
- The management URL and this peer come from `netbird status`.

From v0.2: the public reverse-proxy services that v0.2 created are not removed;
delete them in the NetBird dashboard once peers use the new addresses.
