#!/usr/bin/env bash
# Build dist/ packages: bundled daemon, .deb, .rpm, Arch .pkg.tar.zst and a
# portable tarball. Run from anywhere; requires node/npm and curl/tar.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

VERSION=$(node -p "require('./package.json').version")
ARCH=${ARCH:-amd64}
NFPM_VERSION=2.49.0
TOOLS="$ROOT/build/tools"
PKGROOT="$ROOT/build/pkgroot"
DIST="$ROOT/dist"

case "$ARCH" in
amd64) NFPM_ASSET="nfpm_${NFPM_VERSION}_Linux_x86_64.tar.gz" ;;
arm64) NFPM_ASSET="nfpm_${NFPM_VERSION}_Linux_arm64.tar.gz" ;;
*) echo "unsupported ARCH: $ARCH (use amd64 or arm64)" >&2; exit 1 ;;
esac

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }

ensure_nfpm() {
    local nfpm="$TOOLS/nfpm-$NFPM_VERSION/nfpm"
    if [ -x "$nfpm" ]; then
        printf '%s\n' "$nfpm"
        return
    fi
    mkdir -p "$TOOLS/nfpm-$NFPM_VERSION"
    say "downloading nfpm $NFPM_VERSION" >&2
    curl -fsSL -o "$TOOLS/$NFPM_ASSET" \
        "https://github.com/goreleaser/nfpm/releases/download/v$NFPM_VERSION/$NFPM_ASSET"
    curl -fsSL -o "$TOOLS/checksums-$NFPM_VERSION.txt" \
        "https://github.com/goreleaser/nfpm/releases/download/v$NFPM_VERSION/checksums.txt"
    local expected actual
    expected=$(grep -E "  $NFPM_ASSET\$" "$TOOLS/checksums-$NFPM_VERSION.txt" | awk '{print $1}')
    actual=$(sha256sum "$TOOLS/$NFPM_ASSET" | awk '{print $1}')
    if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
        echo "nfpm checksum verification failed" >&2
        exit 1
    fi
    tar xzf "$TOOLS/$NFPM_ASSET" -C "$TOOLS/nfpm-$NFPM_VERSION" nfpm
    printf '%s\n' "$nfpm"
}

say "building daemon bundle"
node scripts/build-bundle.js

say "staging package root"
rm -rf "$PKGROOT"
mkdir -p \
    "$PKGROOT/usr/bin" \
    "$PKGROOT/usr/lib/flyme-link/dist" \
    "$PKGROOT/usr/lib/flyme-link/gui" \
    "$PKGROOT/usr/lib/flyme-link/gnome-extension" \
    "$PKGROOT/usr/lib/systemd/user" \
    "$PKGROOT/usr/share/applications" \
    "$PKGROOT/usr/share/icons/hicolor/scalable/apps" \
    "$PKGROOT/usr/share/gnome-shell/extensions/flyme-link@local" \
    "$PKGROOT/usr/share/doc/flyme-link-linux"

install -m 0644 dist/flyme-link.cjs "$PKGROOT/usr/lib/flyme-link/dist/flyme-link.cjs"
install -m 0755 gui/flyme-qr-gui.py "$PKGROOT/usr/lib/flyme-link/gui/flyme-qr-gui.py"
install -m 0644 gnome-extension/extension.js gnome-extension/metadata.json \
    "$PKGROOT/usr/lib/flyme-link/gnome-extension/"
cp gnome-extension/extension.js gnome-extension/metadata.json \
    "$PKGROOT/usr/share/gnome-shell/extensions/flyme-link@local/"
install -m 0644 systemd/flyme-link.service "$PKGROOT/usr/lib/systemd/user/flyme-link.service"
install -m 0644 desktop/flyme-link-qr.desktop "$PKGROOT/usr/share/applications/flyme-link-qr.desktop"
install -m 0644 assets/flyme-link-symbolic.svg \
    "$PKGROOT/usr/share/icons/hicolor/scalable/apps/flyme-link-symbolic.svg"
install -m 0644 README.md LICENSE "$PKGROOT/usr/share/doc/flyme-link-linux/"
if [ -f THIRD_PARTY_NOTICES.md ]; then
    install -m 0644 THIRD_PARTY_NOTICES.md "$PKGROOT/usr/share/doc/flyme-link-linux/"
fi

cat > "$PKGROOT/usr/bin/flyme-link" <<'EOF'
#!/bin/sh
exec node /usr/lib/flyme-link/dist/flyme-link.cjs "$@"
EOF
chmod 0755 "$PKGROOT/usr/bin/flyme-link"
install -m 0755 scripts/flyme-link-gui "$PKGROOT/usr/bin/flyme-link-gui"

NFPM=$(ensure_nfpm)
mkdir -p "$DIST"
export VERSION ARCH
say "building deb, rpm and Arch packages with nfpm"
for format in deb rpm archlinux; do
    "$NFPM" package -f packaging/nfpm.yaml -p "$format" -t "$DIST/"
done

say "done"
ls -lh "$DIST" | sed 's/^/    /'
