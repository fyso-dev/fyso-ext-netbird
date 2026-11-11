---
name: netbird
description: Reach this project's apps from NetBird peers and check their addresses
---
NetBird peers open this project at its own addresses (`http://panel.<web_domain>:<port>`,
`dagu.…`, `omb.…`, each app). DNS records in a NetBird zone point those names at this
peer, and the `ext-netbird-forward` process relays the peer's NetBird address to the
gateway, so the project login works as it does locally.

- To see which records are missing or drifted, run the Dagu workflow `ext-netbird-sync`
  with `APPLY=false` (the default). It never changes anything in that mode.
- Only with a person's go-ahead, run it with `APPLY=true`: it creates missing records and
  updates drifted ones. It never deletes a record.
- A new app needs the workflow run again.
- `netbird status` shows whether this peer is connected. Never print `NETBIRD_API_TOKEN`.

Enable this skill explicitly in team.yaml.
