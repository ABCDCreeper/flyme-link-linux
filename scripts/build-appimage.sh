#!/usr/bin/env bash
# Build a portable AppImage that bundles Node.js, the daemon, the QR window and
# the GNOME extension. The GTK4 QR window still uses the host's python3+GTK4;
# the daemon/tray/CLI work without any Python at all.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

VERSION=$(node -p "require('./package.json').version")
ARCH=${ARCH:-x86_64}
NODE_VERSION=${NODE_VERSION:-v24.22.3}
APPIMAGETOOL_VERSION=1.9.1
TOOLS="$ROOT/build/tools"
APPDIR="$ROOT/build/AppDir"
DIST="$ROOT/dist"

case "$ARCH" in
x86_64)
    NODE_ARCH=x64
    APPIMAGETOOL_SHA=ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0
    ;;
aarch64|arm64)
    ARCH=aarch64
    NODE_ARCH=arm64
    APPIMAGETOOL_SHA=f0837e7448a0c1e4e650a93bb3e85802546e60654ef287576f46c71c126a9158
    ;;
*)
    echo "unsupported ARCH: $ARCH (use x86_64 or aarch64)" >&2
    exit 1
    ;;
esac

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }

say "building daemon bundle"
node scripts/build-bundle.js

mkdir -p "$TOOLS" "$APPDIR/usr/bin" "$APPDIR/usr/lib/flyme-link/dist" \
    "$APPDIR/usr/lib/flyme-link/gui" "$APPDIR/usr/share/applications" \
    "$APPDIR/usr/share/icons/hicolor/scalable/apps" \
    "$APPDIR/usr/share/gnome-shell/extensions/flyme-link@local" \
    "$APPDIR/usr/share/doc/flyme-link-linux"

if [ ! -x "$TOOLS/node-$NODE_VERSION-$NODE_ARCH/bin/node" ]; then
    say "downloading Node $NODE_VERSION ($NODE_ARCH)"
    NODE_TARBALL="node-$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
    curl -fsSL -o "$TOOLS/$NODE_TARBALL" "https://nodejs.org/dist/$NODE_VERSION/$NODE_TARBALL"
    curl -fsSL -o "$TOOLS/SHASUMS256-$NODE_VERSION.txt" \
        "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
    expected=$(grep -E "  $NODE_TARBALL\$" "$TOOLS/SHASUMS256-$NODE_VERSION.txt" | awk '{print $1}')
    actual=$(sha256sum "$TOOLS/$NODE_TARBALL" | awk '{print $1}')
    if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
        echo "node checksum verification failed" >&2
        exit 1
    fi
    mkdir -p "$TOOLS/node-$NODE_VERSION-$NODE_ARCH"
    tar -xJf "$TOOLS/$NODE_TARBALL" -C "$TOOLS/node-$NODE_VERSION-$NODE_ARCH" \
        "node-$NODE_VERSION-linux-$NODE_ARCH/bin/node"
fi

install -m 0755 "$TOOLS/node-$NODE_VERSION-$NODE_ARCH/node-$NODE_VERSION-linux-$NODE_ARCH/bin/node" "$APPDIR/usr/bin/node"
install -m 0644 dist/flyme-link.cjs "$APPDIR/usr/lib/flyme-link/dist/flyme-link.cjs"
install -m 0755 gui/flyme-qr-gui.py "$APPDIR/usr/lib/flyme-link/gui/flyme-qr-gui.py"
install -m 0755 scripts/flyme-link-gui "$APPDIR/usr/bin/flyme-link-gui"
cp gnome-extension/extension.js gnome-extension/metadata.json \
    "$APPDIR/usr/share/gnome-shell/extensions/flyme-link@local/"
install -m 0644 desktop/flyme-link-qr.desktop "$APPDIR/usr/share/applications/"
install -m 0644 assets/flyme-link-symbolic.svg \
    "$APPDIR/usr/share/icons/hicolor/scalable/apps/"
install -m 0644 README.md LICENSE "$APPDIR/usr/share/doc/flyme-link-linux/"
if [ -f THIRD_PARTY_NOTICES.md ]; then
    install -m 0644 THIRD_PARTY_NOTICES.md "$APPDIR/usr/share/doc/flyme-link-linux/"
fi

cat > "$APPDIR/usr/bin/flyme-link" <<'EOF'
#!/bin/sh
SELF=$(readlink -f "$0" 2>/dev/null || printf '%s' "$0")
DIR=$(dirname "$SELF")
exec "$DIR/node" "$DIR/../lib/flyme-link/dist/flyme-link.cjs" "$@"
EOF
chmod 0755 "$APPDIR/usr/bin/flyme-link"

install -m 0755 packaging/AppRun "$APPDIR/AppRun"
cat > "$APPDIR/flyme-link.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Flyme Link
Exec=flyme-link
Icon=flyme-link
Categories=Utility;Network;
Terminal=true
EOF
install -m 0644 assets/flyme-link-symbolic.svg "$APPDIR/flyme-link.svg"
ln -sf flyme-link.svg "$APPDIR/.DirIcon"

APPIMAGETOOL="$TOOLS/appimagetool-$ARCH.AppImage"
if [ ! -x "$APPIMAGETOOL" ]; then
    say "downloading appimagetool $APPIMAGETOOL_VERSION"
    curl -fsSL -o "$APPIMAGETOOL" \
        "https://github.com/AppImage/appimagetool/releases/download/$APPIMAGETOOL_VERSION/appimagetool-$ARCH.AppImage"
    echo "$APPIMAGETOOL_SHA  $APPIMAGETOOL" | sha256sum -c -
    chmod +x "$APPIMAGETOOL"
fi

mkdir -p "$DIST"
say "packing AppImage"
ARCH="$ARCH" APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGETOOL" --no-appstream \
    "$APPDIR" "$DIST/flyme-link-linux-$VERSION-$ARCH.AppImage"
chmod +x "$DIST/flyme-link-linux-$VERSION-$ARCH.AppImage"
ls -lh "$DIST/flyme-link-linux-$VERSION-$ARCH.AppImage"
