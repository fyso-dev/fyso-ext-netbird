---
name: netbird
description: Publish this project's apps through the NetBird reverse proxy and check them
---
Each app of the panel is published as `<name>[-suffix].<proxy domain>` by one NetBird
reverse proxy service that targets this peer on `FYSO_EXT_NETBIRD_PORT`.

- To see what is missing or drifted, run the Dagu workflow `ext-netbird-sync` with
  `APPLY=false` (the default). It never changes anything in that mode.
- Only with a person's go-ahead, run it with `APPLY=true`: it creates missing services
  and updates drifted ones. It never deletes a service.
- A new app needs the workflow run again; its link in the panel updates with it.
- `netbird status` shows whether this peer is connected. Never print `NETBIRD_API_TOKEN`.

Enable this skill explicitly in team.yaml.
