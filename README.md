# fyso-ext-netbird

Fyso Agentic Framework extension that publishes a project's apps through the
NetBird reverse proxy over HTTPS, one service per app, all reaching this peer
on one port of the project's extension block.

```sh
mise run ext:add <this repo> -- --vcs-ref <tag> \
  -d proxy_domain=proxy.example.com -d name_suffix=host1
mise run secrets            # NETBIRD_API_TOKEN
mise run netbird:plan       # or the Dagu workflow ext-netbird-sync
mise run netbird:sync       # creates/updates services; never deletes
```

- Public names: `<app>[-suffix].<proxy_domain>`; `aliases` renames app ids
  (default `omb: bots`). Apps are those the gateway serves as `<id>.localhost`,
  plus the panel.
- The route listens on all interfaces but only accepts NetBird peers
  (100.64.0.0/10) and loopback, behind the project login, and allows
  same-origin API calls only.
- New services copy the access settings (SSO groups, password…) of the
  project's existing services, if any.
- The management URL and this peer come from `netbird status`.
