#!/usr/bin/env bash
# Remove the per-user installation created by scripts/install.sh.
set -euo pipefail

BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}"
EXT_UUID="flyme-link@local"
EXT_DIR="$DATA_DIR/gnome-shell/extensions/$EXT_UUID"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }

say "stopping and disabling the user service"
systemctl --user disable --now flyme-link.service 2>/dev/null || true
rm -f "$CONFIG_DIR/systemd/user/flyme-link.service"
systemctl --user daemon-reload 2>/dev/null || true

say "removing launchers, desktop entry and icon"
rm -f "$BIN_DIR/flyme-link" "$BIN_DIR/flyme-link-gui"
rm -f "$DATA_DIR/applications/flyme-link-qr.desktop"
rm -f "$DATA_DIR/icons/hicolor/scalable/apps/flyme-link-symbolic.svg"
gtk-update-icon-cache -f -t "$DATA_DIR/icons/hicolor/" >/dev/null 2>&1 || true
update-desktop-database "$DATA_DIR/applications" >/dev/null 2>&1 || true

say "removing GNOME Shell extension"
rm -rf "$EXT_DIR"
python3 - "$EXT_UUID" <<'PY' 2>/dev/null || true
import ast, subprocess, sys
uuid = sys.argv[1]
out = subprocess.check_output(
    ["gsettings", "get", "org.gnome.shell", "enabled-extensions"], text=True
).strip()
try:
    current = list(ast.literal_eval(out))
except Exception:
    current = []
if uuid in current:
    current.remove(uuid)
    value = "[" + ", ".join("'%s'" % item for item in current) + "]"
    subprocess.check_call(["gsettings", "set", "org.gnome.shell", "enabled-extensions", value])
PY

echo "已卸载（源码目录与 npm 依赖保留）。"
