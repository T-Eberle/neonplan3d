#!/usr/bin/env bash
# Starts the development Home Assistant (inside the dev container) on http://localhost:8123.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
config="$root/dev/config"

mkdir -p "$config/custom_components"
ln -sfn ../../../custom_components/neonplan3d "$config/custom_components/neonplan3d"

exec hass --config "$config" "$@"
