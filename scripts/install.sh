#!/usr/bin/env bash
# Install flyme-link-linux for the current user (no root required).
#
#   ./scripts/install.sh
#
# Installs CLI launchers into ~/.local/bin, the tray/QR icon, a desktop entry,
# a systemd user service, and — on GNOME — the bundled Shell extension.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}"
UNIT_DIR="$CONFIG_DIR/systemd/user"
EXT_UUID="flyme-link@local"
EXT_DIR="$DATA_DIR/gnome-shell/extensions/$EXT_UUID"
ICON_DIR="$DATA_DIR/icons/hicolor/scalable/apps"
DESKTOP_DIR="$DATA_DIR/applications"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }

say "checking dependencies"
command -v node >/dev/null || { echo "node (>=18) is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required to install ws/qrcode/dbus-next" >&2; exit 1; }
if command -v wl-copy >/dev/null; then
    :
elif command -v xclip >/dev/null; then
    :
else
    echo "warning: install wl-clipboard (Wayland) or xclip (X11) to receive the phone clipboard" >&2
fi
if ! command -v notify-send >/dev/null; then
    echo "note: notify-send (libnotify) not found; tray/GUI still work but no desktop notifications" >&2
fi

if [ ! -d "$ROOT/node_modules" ]; then
    say "installing npm dependencies"
    (cd "$ROOT" && npm install --omit=dev --no-audit --no-fund)
fi

say "installing launchers into $BIN_DIR"
mkdir -p "$BIN_DIR"
ln -sf "$ROOT/bin/flyme-link.js" "$BIN_DIR/flyme-link"
ln -sf "$ROOT/scripts/flyme-link-gui" "$BIN_DIR/flyme-link-gui"
chmod +x "$ROOT/bin/flyme-link.js" "$ROOT/scripts/flyme-link-gui"

say "installing icon and desktop entry"
mkdir -p "$ICON_DIR" "$DESKTOP_DIR"
cp "$ROOT/assets/flyme-link-symbolic.svg" "$ICON_DIR/"
sed "s|^Exec=.*|Exec=$BIN_DIR/flyme-link-gui|" \
    "$ROOT/desktop/flyme-link-qr.desktop" > "$DESKTOP_DIR/flyme-link-qr.desktop"
gtk-update-icon-cache -f -t "$DATA_DIR/icons/hicolor/" >/dev/null 2>&1 || true
update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true

say "installing systemd user service"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/flyme-link.service" <<EOF
[Unit]
Description=Flyme 互联 (flyme-link-linux) clipboard sync
After=graphical-session.target
PartOf=graphical-session.target

[Service]
Type=simple
ExecStart=$BIN_DIR/flyme-link --daemon
Restart=on-failure
RestartSec=3
Environment=WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-wayland-0}

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now flyme-link.service

case "${XDG_CURRENT_DESKTOP:-}" in
*GNOME*)
    say "installing GNOME Shell extension"
    mkdir -p "$EXT_DIR"
    cp "$ROOT/gnome-extension/extension.js" "$ROOT/gnome-extension/metadata.json" "$EXT_DIR/"
    python3 - "$EXT_UUID" <<'PY'
import ast, subprocess, sys
uuid = sys.argv[1]
out = subprocess.check_output(
    ["gsettings", "get", "org.gnome.shell", "enabled-extensions"], text=True
).strip()
try:
    current = list(ast.literal_eval(out))
except Exception:
    current = []
if uuid not in current:
    current.append(uuid)
    value = "[" + ", ".join("'%s'" % item for item in current) + "]"
    subprocess.check_call(["gsettings", "set", "org.gnome.shell", "enabled-extensions", value])
PY
    if ! gnome-extensions list 2>/dev/null | grep -qx "$EXT_UUID"; then
        echo
        echo "  GNOME 需要注销并重新登录一次，扩展才会被 Shell 加载。"
        echo "  登录后扩展会自动启用（已写入 enabled-extensions）。"
    fi
    ;;
*)
    say "non-GNOME desktop: using the StatusNotifier tray + system clipboard tools"
    ;;
esac

echo
echo "完成。"
echo "  • 状态: systemctl --user status flyme-link.service"
echo "  • 日志: journalctl --user -u flyme-link -f"
echo "  • 二维码窗口: $BIN_DIR/flyme-link-gui（或应用菜单「Flyme 互联（二维码）」）"
