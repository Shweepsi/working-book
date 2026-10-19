#!/usr/bin/env bash
# Downloads GridCraft's engine for the MCP Worker (Shweepsi/gridcraft,
# apps/gridcraft-worker) into src/mcp/engine/, checked against its SHA-256.
# Built by that repo's "Worker engine" workflow, never on this machine.
set -euo pipefail

TAG=v0.7.0-shared.9
ASSET=gridcraft-worker-0.7.0-shared.9.zip
SHA256=5c0ae9a6fe20611928ec137c82d28fa84cf1e4850775378cd1aaf1c6a9d4a4e9

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
