#!/usr/bin/env bash
# Drops the GridCraft web build (storytold/gridcraft, MIT OR Apache-2.0) into
# public/gridcraft/, where the GridCraft tab embeds it in an iframe.
#
# Fetched, not committed: the wasm alone is ~18 Mo, and only dev-channel builds
# ship the tab — CI runs this on every branch but main, so production neither
# downloads nor serves it. Pinned to a release and checked against its
# SHA256SUMS, so a re-tagged upstream asset fails the build instead of shipping.
#
# To bump: change VERSION and SHA256 (the gridcraft-web-<v>.zip line of the
# release's SHA256SUMS.txt).
set -euo pipefail

VERSION=0.7.0
SHA256=ad10af2baf9c7ed4ccbd81e32b37698f5075cdf4f26b726fee7fc7938a3a8d27

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST="$ROOT/public/gridcraft"
STAMP="$DEST/.version"

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$VERSION" ]; then
  echo "gridcraft $VERSION already in public/gridcraft"
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

URL="https://github.com/storytold/gridcraft/releases/download/v$VERSION/gridcraft-web-$VERSION.zip"
curl -fsSL --retry 3 -o "$TMP/web.zip" "$URL"
echo "$SHA256  $TMP/web.zip" | sha256sum -c --quiet -

mkdir -p "$TMP/x"
if command -v unzip >/dev/null; then
  unzip -q "$TMP/web.zip" -d "$TMP/x"
elif command -v bsdtar >/dev/null; then
  bsdtar -xf "$TMP/web.zip" -C "$TMP/x"
else
  (cd "$TMP/x" && jar xf "$TMP/web.zip")
fi

rm -rf "$DEST"
mkdir -p "$DEST"
SRC="$TMP/x/gridcraft-web-$VERSION"
# The app and its licences; the sample server configs and docs stay behind.
cp "$SRC"/index.html "$SRC"/*.js "$SRC"/*.wasm "$SRC"/*.ico "$SRC"/LICENSE-* "$DEST"/
echo "$VERSION" > "$STAMP"
echo "gridcraft $VERSION → public/gridcraft ($(du -sh "$DEST" | cut -f1))"
