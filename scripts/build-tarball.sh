#!/usr/bin/env bash
# Build a portable .tar.gz that only needs Node.js (>=18) on the target and can
# be installed with scripts/install.sh. Use the AppImage if you want Node
# bundled as well.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

VERSION=$(node -p "require('./package.json').version")
ARCH=${ARCH:-x86_64}
NAME="flyme-link-linux-$VERSION-linux-$ARCH"
STAGE="$ROOT/build/portable/$NAME"
DIST="$ROOT/dist"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }

say "building daemon bundle"
node scripts/build-bundle.js

rm -rf "$STAGE"
mkdir -p "$STAGE/dist" "$STAGE/gui" "$STAGE/gnome-extension" "$STAGE/assets" \
    "$STAGE/desktop" "$STAGE/systemd" "$STAGE/scripts"

install -m 0644 dist/flyme-link.cjs "$STAGE/dist/flyme-link.cjs"
install -m 0755 gui/flyme-qr-gui.py "$STAGE/gui/flyme-qr-gui.py"
install -m 0644 gnome-extension/extension.js gnome-extension/metadata.json "$STAGE/gnome-extension/"
install -m 0644 assets/flyme-link-symbolic.svg "$STAGE/assets/"
install -m 0644 desktop/flyme-link-qr.desktop "$STAGE/desktop/"
install -m 0644 systemd/flyme-link.service "$STAGE/systemd/"
install -m 0755 scripts/install.sh scripts/uninstall.sh scripts/flyme-link-gui "$STAGE/scripts/"
install -m 0644 README.md LICENSE "$STAGE/"
if [ -f THIRD_PARTY_NOTICES.md ]; then
    install -m 0644 THIRD_PARTY_NOTICES.md "$STAGE/"
fi

mkdir -p "$DIST"
say "creating $NAME.tar.gz"
tar czf "$DIST/$NAME.tar.gz" -C "$ROOT/build/portable" "$NAME"
ls -lh "$DIST/$NAME.tar.gz"
