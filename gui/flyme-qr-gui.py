#!/usr/bin/env python3
"""Flyme 互联 — 二维码 / 状态窗口 (GTK4)

连接守护进程的 UNIX socket ($XDG_RUNTIME_DIR/flyme-link.sock，可用 FLYME_SOCK
覆盖)，显示扫码配对二维码与连接状态。关闭窗口不会停止守护进程。

依赖: python3-gobject + GTK4 (Debian: python3-gi gir1.2-gtk-4.0,
       Fedora: python3-gobject gtk4, Arch: python-gobject gtk4)
"""
import base64
import json
import os
import socket
import sys
import threading
import time

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
from gi.repository import GLib, Gdk, Gtk  # noqa: E402


def socket_path():
    override = os.environ.get("FLYME_SOCK")
    if override:
        return override
    runtime = os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    return os.path.join(runtime, "flyme-link.sock")


SOCK_PATH = socket_path()

STATE_TEXT = {
    "waiting": "等待手机扫码…",
    "linking": "手机已扫码，正在建立连接…",
    "connected": "✓ 已连接手机，剪贴板同步中",
    "offline": "守护进程未运行",
}


class FlymeWindow(Gtk.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title="Flyme 互联")
        self.set_default_size(380, 470)

        header = Gtk.HeaderBar()
        self._rescan_btn = Gtk.Button(label="重新生成二维码")
        self._rescan_btn.connect("clicked", self._on_rescan)
        header.pack_start(self._rescan_btn)
        self.set_titlebar(header)

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        box.set_margin_top(16)
        box.set_margin_bottom(16)
        box.set_margin_start(16)
        box.set_margin_end(16)

        self._status_label = Gtk.Label(label="正在连接守护进程…")
        self._status_label.set_wrap(True)
        self._status_label.add_css_class("title-2")
        box.append(self._status_label)

        self._qr_picture = Gtk.Picture()
        self._qr_picture.set_vexpand(True)
        self._qr_picture.set_hexpand(True)
        box.append(self._qr_picture)

        self._hint = Gtk.Label()
        self._hint.set_markup(
            "<small>在魅族手机上打开 设置 → 更多连接 → PC 互联\n"
            "(或 Flyme 扫一扫) 扫描二维码</small>"
        )
        self._hint.set_justify(Gtk.Justification.CENTER)
        self._hint.set_opacity(0.75)
        box.append(self._hint)

        self.set_child(box)

        threading.Thread(target=self._socket_loop, daemon=True).start()

    # ── daemon socket ──
    def _socket_loop(self):
        while True:
            try:
                sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                sock.connect(SOCK_PATH)
                GLib.idle_add(self._set_connected_hint)
                stream = sock.makefile("rb")
                while True:
                    line = stream.readline()
                    if not line:
                        break
                    try:
                        message = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    GLib.idle_add(self._handle_message, message)
            except OSError:
                GLib.idle_add(self._set_offline)
            finally:
                try:
                    sock.close()
                except Exception:
                    pass
            time.sleep(2)

    def _handle_message(self, message):
        if message.get("type") == "state":
            state = message.get("state")
            if state == "connected":
                self._status_label.set_text(STATE_TEXT["connected"])
                self._qr_picture.set_visible(False)
                self._hint.set_visible(False)
                self._rescan_btn.set_sensitive(True)
            else:
                self._qr_picture.set_visible(True)
                self._hint.set_visible(True)
                self._status_label.set_text(
                    STATE_TEXT.get(state, message.get("detail") or state or "")
                )
        elif message.get("type") == "qr":
            try:
                png = base64.b64decode(message["png_base64"])
            except Exception:
                return
            texture = Gdk.Texture.new_from_bytes(GLib.Bytes.new(png))
            self._qr_picture.set_paintable(texture)
            self._qr_picture.set_visible(True)
        return False

    def _set_connected_hint(self):
        self._status_label.set_text("已连接守护进程")
        return False

    def _set_offline(self):
        self._status_label.set_text("守护进程未运行 — 请启动 flyme-link 服务")
        self._qr_picture.set_visible(False)
        self._hint.set_visible(False)
        return False

    def _on_rescan(self, _button):
        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.connect(SOCK_PATH)
            sock.sendall((json.dumps({"type": "action", "action": "rescan"}) + "\n").encode())
            sock.close()
            self._status_label.set_text("正在重新生成二维码…")
        except OSError:
            self._set_offline()


class FlymeApp(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="com.flyme.pclink.linux.qr")

    def do_activate(self):
        window = FlymeWindow(self)
        window.present()


if __name__ == "__main__":
    FlymeApp().run(sys.argv)
