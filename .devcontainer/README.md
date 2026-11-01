# Dev container

A container with Home Assistant (the version of the production installation, see `HA_VERSION` in
`devcontainer.json`), Python 3.14 with pytest, ruff and mypy, and Node 24 for the frontend. Works with Zed, VS Code
or the `devcontainer` CLI.

## First start

1. On the host, copy the production data that NeonPlan 3D needs into the untracked `dev/config/.storage`:

   ```bash
   python3 scripts/dev_import_prod.py            # /Volumes/config, or give another config folder
   ```

   It copies the instance id (`core.uuid`), the `neonplan3d.*` stores, the area and floor registries and the
   NeonPlan 3D config entry, and checks that the installed packs are bound to that instance id. The packs from
   the shop are signed for a fingerprint of the instance id, so without this copy the shop refuses updates and
   new installs in the dev instance.

2. Open the repository in Zed (`Open Dev Container` from the command palette; needs the `devcontainer` CLI:
   `npm install -g @devcontainers/cli`) or in VS Code (`Reopen in Container`).

3. In the container, start Home Assistant: Zed task `Home Assistant (dev)` or `scripts/dev-ha.sh`. It loads the
   integration straight from `custom_components/neonplan3d` (a symlink in `dev/config/custom_components`), so a
   restart picks up Python changes. The very first start installs the requirements of Home Assistant's own
   integrations and may report missing modules; start it a second time.

4. Open http://localhost:8123 and create a local user (onboarding). NeonPlan 3D is already set up with the
   production plan and packs.

## Updating from production

When the production plan has moved on (more floors, rooms, furniture, new packs), stop the dev Home Assistant and
run the same script again on the host:

```bash
python3 scripts/dev_import_prod.py
```

It refuses while the dev Home Assistant answers on port 8123: Home Assistant keeps the stores in memory and would
write its old state over the copy when it stops. The dev files it replaces are kept in
`dev/config/.storage-backups/<time>/` (copy them back to undo), and it prints the plan before and after. Your dev
user, the onboarding and everything else in `dev/config` stay as they are.

## Frontend

`npm run watch` in `frontend/` (Zed task `Frontend: watch`) rebuilds the bundles in
`custom_components/neonplan3d/frontend/`; reload the browser to see them. `node_modules` lives in a Docker volume,
because the host's copy holds macOS binaries.

## Careful

The dev instance carries the production instance id. Keep it a local test instance: no Nabu Casa cloud, no
analytics, no `default_config` (see `dev/config/configuration.yaml`). It talks to the shop like the production
installation does (the daily pack check), which is harmless, since both are the same installation for the shop.
