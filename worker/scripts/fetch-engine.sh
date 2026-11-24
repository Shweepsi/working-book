#!/usr/bin/env bash
# Downloads GridCraft's engine for the MCP Worker (Shweepsi/gridcraft,
# apps/gridcraft-worker) into src/mcp/engine/, checked against its SHA-256.
# Built by that repo's "Worker engine" workflow, never on this machine.
set -euo pipefail

TAG=v0.19.1-shared.1
ASSET=gridcraft-worker-0.19.1-shared.1.zip
SHA256=84f4582150decfbf088e675e586cf0255f6b7949c6a998b3395ba2566eee0aa4

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
