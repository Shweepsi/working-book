#!/usr/bin/env bash
# Drops the GridCraft web build into public/gridcraft/, where the GridCraft tab
# embeds it in an iframe.
#
# The build comes from Shweepsi/gridcraft, a fork of storytold/gridcraft
# (MIT OR Apache-2.0) whose `shared-cells` branch adds cell-by-cell sharing to
# the `?host=parent` bridge (gridcraft:changes / gridcraft:apply). To follow an
# upstream release: rebase shared-cells onto its tag, build, publish
# v<version>-shared on the fork, then bump TAG and SHA256 here.
#
# Fetched, not committed: the wasm alone is ~18 Mo, and only dev-channel builds
# ship the tab — CI runs this on every branch but main, so production neither
# downloads nor serves it. Pinned to a release and checked against its SHA256,
# so a re-uploaded asset fails the build instead of shipping.
set -euo pipefail

TAG=v0.7.0-shared.2
ASSET=gridcraft-web-0.7.0-shared.2.zip
SHA256=ceebd95121d76a76333462f4762e8153eba00d52c0e885b3dba58fda6097e26d
REPO=Shweepsi/gridcraft

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST="$ROOT/public/gridcraft"
STAMP="$DEST/.version"

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$TAG" ]; then
  echo "gridcraft $TAG already in public/gridcraft"
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsSL --retry 3 -o "$TMP/web.zip" "https://github.com/$REPO/releases/download/$TAG/$ASSET"
echo "$SHA256  $TMP/web.zip" | sha256sum -c --quiet -

mkdir -p "$TMP/x"
if command -v unzip >/dev/null; then
  unzip -q "$TMP/web.zip" -d "$TMP/x"
elif command -v bsdtar >/dev/null; then
  bsdtar -xf "$TMP/web.zip" -C "$TMP/x"
else
  (cd "$TMP/x" && jar xf "$TMP/web.zip")
fi

# The site sits at the zip's root or one folder down, depending on how it was zipped.
SRC=$(dirname "$(find "$TMP/x" -name index.html | head -n 1)")

rm -rf "$DEST"
mkdir -p "$DEST"
cp "$SRC"/index.html "$SRC"/*.js "$SRC"/*.wasm "$SRC"/*.ico "$DEST"/
for lic in LICENSE-MIT LICENSE-APACHE; do
  curl -fsSL --retry 3 -o "$DEST/$lic" "https://raw.githubusercontent.com/$REPO/$TAG/$lic"
done
echo "$TAG" > "$STAMP"
echo "gridcraft $TAG → public/gridcraft ($(du -sh "$DEST" | cut -f1))"
