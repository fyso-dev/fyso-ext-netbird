# fyso-ext-netbird

Fyso Agentic Framework extension that opens a project's apps through NetBird at the
project's own addresses, with the project's web login. Two ways in:

| `access` | Addresses | Who reaches them | Needs |
|---|---|---|---|
| `private` (default) | `http://<app>.<web_domain>:<port>` | NetBird peers, over WireGuard | a NetBird DNS zone; framework D61 (`v0.1.0-rc.2`) |
| `https` | `https://<app>.<web_domain>` | whoever the NetBird reverse proxy lets in | an online NetBird reverse proxy cluster; framework D62 |

With `https` this extension is the project's **HTTPS provider** (framework D62): it sets
`FYSO_WEB_SCHEME=https`, so the login, its `Secure` cookie and every link follow that
scheme, and features that need HTTPS (the remote MCP) become available.

## Private access

```sh
# 1. In NetBird: Dashboard → DNS → Zones, a zone such as corp.internal for your peers.
# 2. The project's addresses inside that zone:
uvx copier update --trust --skip-answered -d web_domain=host1.corp.internal
# 3. The extension, from the panel (Apps → Marketplace) or the terminal:
mise run ext:add netbird
mise run secrets            # NETBIRD_API_TOKEN
mise run netbird:plan       # or the Dagu workflow ext-netbird-sync
mise run netbird:sync       # creates/updates DNS records; never deletes
```

One A record per address, in the most specific enabled zone that holds `web_domain`,
pointing at this peer's NetBird IP. Plain HTTP inside WireGuard: only peers reach it.

## HTTPS access

```sh
# 1. The project's addresses under the reverse proxy cluster's domain
#    (Dashboard → Reverse Proxy), one name per host:
uvx copier update --trust --skip-answered -d web_domain=host1.proxy.example.com
# 2. The extension as HTTPS provider:
mise run ext:add netbird -- -d access=https     # or ext:update netbird -- -d access=https
mise run secrets            # NETBIRD_API_TOKEN
mise run netbird:plan
mise run netbird:sync       # creates/updates reverse proxy services; never deletes
mise run down && mise run up
```

One reverse proxy service per address (`panel.host1.proxy.example.com`, `auth.…`,
`dagu.…`, `omb.…`, each app), all reaching this peer on the gateway's port with the
original `Host`. NetBird issues the certificates. Nested names give each project its
own parent domain, which the shared login cookie needs.

**Who can open the addresses is decided in NetBird, not here.** A new service is public
unless the project already has services, whose access settings it copies. `netbird:plan`
and `netbird:sync` end with a line starting with `!` when addresses answer anyone on
the internet, and say whether the cluster offers NetBird-only access. Restricting them
(NetBird-only access, SSO groups, IP ranges) is the NetBird administrator's task. The
project's login and application permissions apply either way.

## Both

- The `ext-netbird-forward` process listens on this peer's NetBird IP and the gateway's
  port, accepts NetBird addresses only (100.64.0.0/10) and relays to the loopback
  gateway.
- The management URL and this peer come from `netbird status`.
- Nothing is ever deleted: remove unused DNS records and reverse proxy services in the
  NetBird dashboard, including those an earlier `access` left behind.

From v0.2: its public reverse proxy services (`panel-<suffix>.<proxy domain>`) are not
reused or removed; delete them in the NetBird dashboard.
