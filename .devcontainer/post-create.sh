#!/usr/bin/env bash
# Runs once after the container was created: frontend dependencies and the dev Home Assistant config folder.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

# the node_modules volume is created by root
sudo chown vscode:vscode "$root/frontend/node_modules"
(cd "$root/frontend" && npm ci)

# Home Assistant loads the integration straight from the repository
mkdir -p "$root/dev/config/custom_components"
ln -sfn ../../../custom_components/neonplan3d "$root/dev/config/custom_components/neonplan3d"

if [ ! -f "$root/dev/config/.storage/core.uuid" ]; then
  echo
  echo "No production data in dev/config yet. On the host, run:"
  echo "  python3 scripts/dev_import_prod.py"
  echo "Without it the packs are not accepted (they are bound to the production instance id)."
fi
