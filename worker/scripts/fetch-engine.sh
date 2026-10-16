#!/usr/bin/env bash
# Downloads GridCraft's engine for the MCP Worker (Shweepsi/gridcraft,
# apps/gridcraft-worker) into src/mcp/engine/, checked against its SHA-256.
# Built by that repo's "Worker engine" workflow, never on this machine.
set -euo pipefail

TAG=v0.7.0-shared.6
ASSET=gridcraft-worker-0.7.0-shared.6.zip
SHA256=d82bd6a3b626b4fe07773e1f153cda4e3385f4db5858b2e9aefd516533933f6b

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$HERE/src/mcp/engine"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL -o "$TMP/$ASSET" "https://github.com/Shweepsi/gridcraft/releases/download/$TAG/$ASSET"
echo "$SHA256  $TMP/$ASSET" | sha256sum -c -
rm -rf "$DEST"
mkdir -p "$DEST"
unzip -q -j "$TMP/$ASSET" '*/gridcraft_worker*' -d "$DEST"
ls -l "$DEST"
