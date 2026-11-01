"""Copies what NeonPlan 3D needs from a production Home Assistant config folder into dev/config.

Run it on the host (the dev container does not see the production share), first to set up the dev instance and
again whenever the production plan has moved on (more floors, rooms, furniture, packs):

    python3 scripts/dev_import_prod.py [/Volumes/config]

Stop the dev Home Assistant first: it keeps the stores in memory and would write its old state over the copy. The
dev files it replaces are kept in dev/config/.storage-backups/<time>/.

Copied: the instance id (core.uuid, the packs are bound to its fingerprint), the NeonPlan 3D stores (building,
images, history, packs, licence, voice), the area and floor registries and the NeonPlan 3D config entry. Nothing
else of the production installation, and everything lands in the untracked dev/config/.storage.

The dev instance then carries the production instance id: it must stay a local test instance (no Nabu Casa
cloud, no analytics), see dev/config/configuration.yaml.
"""

from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import shutil
import socket
import sys

ROOT = Path(__file__).resolve().parent.parent
DEV_STORAGE = ROOT / "dev" / "config" / ".storage"
DEV_BACKUPS = ROOT / "dev" / "config" / ".storage-backups"
DEFAULT_SOURCE = Path("/Volumes/config")
# the dev container publishes Home Assistant on this port of the host
DEV_PORT = 8123

# stores of the integration that are copied whenever they exist (neonplan3d.diagnostics stays: it is the opt-in
# of the production installation)
NEONPLAN_STORES = ("building", "images", "history", "packs", "license", "voice")
REGISTRIES = ("core.area_registry", "core.floor_registry")


def fingerprint(instance_id: str) -> str:
    """The same hash as custom_components/neonplan3d/packs.py."""
    return hashlib.sha256(f"neonplan3d:{instance_id}".encode()).hexdigest()[:16]


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    path.chmod(0o600)


def dev_ha_running() -> bool:
    """Whether a web server answers on the dev Home Assistant's port. An open port alone says nothing: Docker
    accepts connections on a published port even when nothing listens in the container, and then closes them."""
    try:
        with socket.create_connection(("127.0.0.1", DEV_PORT), timeout=1) as conn:
            conn.settimeout(2)
            conn.sendall(b"GET / HTTP/1.0\r\nHost: localhost\r\n\r\n")
            return conn.recv(5) == b"HTTP/"
    except OSError:
        return False


def plan_size(storage: Path) -> str | None:
    """Floors, rooms and furniture of a building store, for the before/after line."""
    path = storage / "neonplan3d.building"
    if not path.exists():
        return None
    floors = load(path)["data"].get("building", {}).get("floors", [])
    rooms = sum(len(f.get("rooms", [])) for f in floors)
    furniture = sum(len(f.get("furniture", [])) for f in floors)
    return f"{len(floors)} floors, {rooms} rooms, {furniture} furniture"


def pack_count(storage: Path) -> int:
    path = storage / "neonplan3d.packs"
    return len(load(path)["data"].get("packs", [])) if path.exists() else 0


def backup(names: list[str]) -> Path | None:
    """Keep the dev files that are about to be replaced."""
    present = [n for n in names if (DEV_STORAGE / n).exists()]
    if not present:
        return None
    target = DEV_BACKUPS / datetime.now().strftime("%Y%m%d-%H%M%S")
    target.mkdir(parents=True)
    for name in present:
        shutil.copy2(DEV_STORAGE / name, target / name)
    return target


def copy(src: Path, name: str) -> None:
    shutil.copyfile(src / name, DEV_STORAGE / name)
    (DEV_STORAGE / name).chmod(0o600)
    print(f"  {name}")


def merge_config_entry(src: Path) -> None:
    """Put the production NeonPlan 3D config entry into the dev core.config_entries (kept or created)."""
    prod = load(src / "core.config_entries")
    entries = [e for e in prod["data"]["entries"] if e["domain"] == "neonplan3d"]
    if not entries:
        print("  (no NeonPlan 3D config entry in production; add the integration in the dev UI)")
        return
    target = DEV_STORAGE / "core.config_entries"
    dev = load(target) if target.exists() else {**prod, "data": {"entries": []}}
    dev["data"]["entries"] = [e for e in dev["data"]["entries"] if e["domain"] != "neonplan3d"] + entries
    write(target, dev)
    print("  core.config_entries (NeonPlan 3D entry only)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "source",
        type=Path,
        nargs="?",
        default=DEFAULT_SOURCE,
        help=f"production config folder (default {DEFAULT_SOURCE})",
    )
    parser.add_argument("--force", action="store_true", help="copy even though the dev Home Assistant seems to run")
    args = parser.parse_args()
    src: Path = args.source / ".storage"
    if not (src / "core.uuid").exists():
        print(f"{src} has no core.uuid: is the production share mounted?", file=sys.stderr)
        return 1
    if dev_ha_running() and not args.force:
        print(
            f"The dev Home Assistant answers on port {DEV_PORT}. Stop it first (it would write its old state over the "
            "copy when it stops), or pass --force.",
            file=sys.stderr,
        )
        return 1

    names = [
        "core.uuid",
        *(f"neonplan3d.{store}" for store in NEONPLAN_STORES if (src / f"neonplan3d.{store}").exists()),
        *(name for name in REGISTRIES if (src / name).exists()),
    ]
    DEV_STORAGE.mkdir(parents=True, exist_ok=True)
    before, packs_before = plan_size(DEV_STORAGE), pack_count(DEV_STORAGE)
    if kept := backup([*names, "core.config_entries"]):
        print(f"Previous dev files kept in {kept}")
    print(f"Copying from {src} to {DEV_STORAGE}:")
    for name in names:
        copy(src, name)
    merge_config_entry(src)

    after = plan_size(DEV_STORAGE)
    if before and before != after:
        print(f"Plan: {before} -> {after}")
    elif after:
        print(f"Plan: {after}")
    if packs_before and packs_before != pack_count(DEV_STORAGE):
        print(f"Packs: {packs_before} -> {pack_count(DEV_STORAGE)}")

    # the packs only load when the copied instance id gives the fingerprint they are bound to
    fp = fingerprint(load(DEV_STORAGE / "core.uuid")["data"]["uuid"])
    packs_file = DEV_STORAGE / "neonplan3d.packs"
    packs = load(packs_file)["data"].get("packs", []) if packs_file.exists() else []
    foreign = [p["id"] for p in packs if p.get("instance") not in (None, fp)]
    print(f"Instance fingerprint {fp}: {len(packs) - len(foreign)} of {len(packs)} packs bound to it.")
    if foreign:
        print(f"Bound to another installation: {', '.join(foreign)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
