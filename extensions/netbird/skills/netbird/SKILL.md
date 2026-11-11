---
name: netbird
description: Reach this project's apps through NetBird and check their addresses
---
This project is reached through NetBird in one of two ways, chosen when the extension
was installed (`access` in `.copier-answers.ext-netbird.yml`):

- `private`: NetBird peers open `http://panel.<web_domain>:<port>` (and `dagu.…`,
  `omb.…`, each app). DNS records in a NetBird zone point those names at this peer.
- `https`: anyone the NetBird reverse proxy lets in opens `https://panel.<web_domain>`.
  One reverse proxy service per address terminates TLS. This is the project's HTTPS
  provider: features that need HTTPS, such as the remote MCP, depend on it.

In both, the `ext-netbird-forward` process relays this peer's NetBird address to the
gateway, and the project's own login applies.

- To see what is missing or drifted, run the Dagu workflow `ext-netbird-sync` with
  `APPLY=false` (the default). It never changes anything in that mode.
- Only with a person's go-ahead, run it with `APPLY=true`: it creates what is missing
  and updates what drifted. It never deletes.
- A new app needs the workflow run again.
- With `https`, read the lines that start with `!` in the output: they say whether the
  addresses are public. Restricting them is the NetBird administrator's task; report
  it to the person, do not try to change it.
- `netbird status` shows whether this peer is connected. Never print `NETBIRD_API_TOKEN`.

Enable this skill explicitly in team.yaml.
