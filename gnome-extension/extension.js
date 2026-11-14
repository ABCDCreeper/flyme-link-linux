// flyme-link@local — Flyme 互联 GNOME Shell 扩展
//
// GNOME 上最顺滑的剪贴板路径: 在本进程 (组合器) 内监听 Meta.Selection 的
// owner-changed 事件并用 St.Clipboard 就地读写, 不派生外部轮询进程, 因此不会
// 造成顶栏/任务栏抽搐。守护进程检测到扩展接入后会自动停用本地 watcher 与
// StatusNotifier 托盘, 避免重复图标和重复通知。
//
// 与守护进程通过 $XDG_RUNTIME_DIR/flyme-link.sock 通信 (JSON lines).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const SOCK_NAME = 'flyme-link.sock';
const RECONNECT_SECONDS = 3;
const CLIP_DEBOUNCE_MS = 150;
const GUI_SCRIPT = 'flyme-qr-gui.py';

const TEXT_MIMETYPES = [
    'text/plain;charset=utf-8',
    'UTF8_STRING',
    'text/plain',
    'STRING',
];

const STATE_LABEL = {
    waiting: '等待手机扫码',
    linking: '正在连接…',
    connected: '已连接手机',
};

export default class FlymeLinkExtension extends Extension {
    enable() {
        this._stopped = false;
        this._sockPath = GLib.build_filenamev([
            GLib.get_user_runtime_dir(),
            SOCK_NAME,
        ]);

        this._stream = null;
        this._input = null;
        this._connection = null;
        this._daemonConnected = false;
        this._lastState = null;
        this._lastRemoteText = null;
        this._lastRemoteAt = 0;
        this._transferring = false;
        this._reconnectId = 0;
        this._clipTimeoutId = 0;
        this._readyNotified = false;

        // Clipboard: selection change notifications + in-process St.Clipboard.
        this._clipboard = St.Clipboard.get_default();
        this._selection = global.display.get_selection();
        this._ownerChangedId = this._selection.connect(
            'owner-changed',
            this._onOwnerChanged.bind(this)
        );

        this._buildIndicator();
        this._connectDaemon();
    }

    disable() {
        this._stopped = true;
        if (this._clipTimeoutId) {
            GLib.source_remove(this._clipTimeoutId);
            this._clipTimeoutId = 0;
        }
        if (this._ownerChangedId) {
            this._selection.disconnect(this._ownerChangedId);
            this._ownerChangedId = 0;
        }
        this._selection = null;
        this._clipboard = null;
        this._teardownDaemon();
        if (this._reconnectId) {
            GLib.source_remove(this._reconnectId);
            this._reconnectId = 0;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    // ───────────────────── panel icon ─────────────────────
    _buildIndicator() {
        this._indicator = new PanelMenu.Button(0.0, 'Flyme 互联', false);

        this._icon = new St.Icon({
            icon_name: 'flyme-link-symbolic',
            fallback_icon_name: 'flyme-link-symbolic',
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(this._icon);

        this._statusItem = new PopupMenu.PopupMenuItem('守护进程未运行', {
            reactive: false,
        });
        this._indicator.menu.addMenuItem(this._statusItem);

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._qrItem = new PopupMenu.PopupMenuItem('显示二维码 / 状态');
        this._qrItem.connect('activate', () => this._openGui());
        this._indicator.menu.addMenuItem(this._qrItem);

        this._rescanItem = new PopupMenu.PopupMenuItem('重新生成二维码');
        this._rescanItem.connect('activate', () => {
            this._openGui();
            this._sendToDaemon({ type: 'action', action: 'rescan' });
        });
        this._indicator.menu.addMenuItem(this._rescanItem);

        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._setState('offline');
    }

    _setState(state, detail) {
        this._lastState = state;
        const label =
            state === 'offline'
                ? '守护进程未运行'
                : STATE_LABEL[state] || detail || state;
        if (this._statusItem)
            this._statusItem.label.text = label;
        if (this._icon)
            this._icon.opacity = state === 'connected' ? 255 : state === 'offline' ? 128 : 190;
    }

    // ───────────────────── daemon socket ─────────────────────
    _connectDaemon() {
        this._teardownDaemon();

        const address = Gio.UnixSocketAddress.new(this._sockPath);
        this._connection = new Gio.SocketClient();
        this._connection.connect_async(address, null, (source, res) => {
            if (this._stopped)
                return;
            try {
                this._stream = source.connect_finish(res);
            } catch (e) {
                this._connection = null;
                this._scheduleReconnect();
                return;
            }
            this._daemonConnected = true;
            this._input = new Gio.DataInputStream({
                base_stream: this._stream.get_input_stream(),
            });
            this._sendToDaemon({ type: 'hello', role: 'extension' });
            this._readNextLine();
        });
    }

    _readNextLine() {
        if (!this._input)
            return;
        this._input.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
            let line = null;
            try {
                [line] = stream.read_line_finish_utf8(res);
            } catch (e) {
                this._onDaemonGone();
                return;
            }
            if (line === null) {
                this._onDaemonGone();
                return;
            }
            try {
                this._handleDaemonMessage(JSON.parse(line));
            } catch (e) {
                console.log(`[flyme-link] failed to parse daemon message: ${e}`);
            }
            this._readNextLine();
        });
    }

    _handleDaemonMessage(msg) {
        switch (msg.type) {
        case 'hello':
            console.log('[flyme-link] connected to daemon');
            break;
        case 'state':
            this._setState(msg.state, msg.detail);
            break;
        case 'qr':
            if (!this._readyNotified) {
                this._readyNotified = true;
                Main.notify(
                    'Flyme 互联已就绪',
                    '点击顶栏图标 → “显示二维码 / 状态” 进行扫码配对'
                );
            }
            break;
        case 'setclip':
            this._setClipboardText(msg.text);
            break;
        case 'notify':
            Main.notify(msg.title || 'Flyme 互联', msg.body || '');
            break;
        default:
            break;
        }
    }

    _onDaemonGone() {
        this._teardownDaemon();
        this._setState('offline');
        this._scheduleReconnect();
    }

    _teardownDaemon() {
        if (this._input) {
            try { this._input.close(null); } catch (e) { /* ignore */ }
            this._input = null;
        }
        if (this._stream) {
            try { this._stream.close(null); } catch (e) { /* ignore */ }
            this._stream = null;
        }
        this._connection = null;
        this._daemonConnected = false;
    }

    _scheduleReconnect() {
        if (this._reconnectId)
            return;
        this._reconnectId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            RECONNECT_SECONDS,
            () => {
                this._reconnectId = 0;
                this._connectDaemon();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _sendToDaemon(obj) {
        if (!this._stream || !this._daemonConnected)
            return;
        try {
            this._stream.get_output_stream().write_all(
                new TextEncoder().encode(JSON.stringify(obj) + '\n'),
                null
            );
        } catch (e) {
            this._onDaemonGone();
        }
    }

    // ───────────────────── clipboard ─────────────────────
    _onOwnerChanged(selection, type) {
        if (type !== Meta.SelectionType.SELECTION_CLIPBOARD)
            return;

        // Wayland uses an intermediate GMemoryOutputStream which emits a
        // second owner-changed while the transfer is resolving.
        if (this._transferring)
            return;
        this._transferring = true;

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._transferring = false;
            this._scheduleClipboardSend();
            return GLib.SOURCE_REMOVE;
        });
    }

    _scheduleClipboardSend() {
        if (this._clipTimeoutId)
            GLib.source_remove(this._clipTimeoutId);
        this._clipTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            CLIP_DEBOUNCE_MS,
            () => {
                this._clipTimeoutId = 0;
                this._readClipboard();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _readClipboard() {
        if (!this._daemonConnected || this._lastState !== 'connected')
            return;
        if (GLib.get_monotonic_time() - this._lastRemoteAt < 1_500_000)
            return;

        const tryMimetype = (i) => {
            if (i >= TEXT_MIMETYPES.length)
                return;
            this._clipboard.get_content(
                St.ClipboardType.CLIPBOARD,
                TEXT_MIMETYPES[i],
                (_clipboard, bytes) => {
                    if (!bytes || bytes.get_size() === 0) {
                        tryMimetype(i + 1);
                        return;
                    }
                    const text = new TextDecoder().decode(bytes.get_data());
                    if (!text || text === this._lastRemoteText)
                        return;
                    this._sendToDaemon({ type: 'clip', text });
                }
            );
        };
        tryMimetype(0);
    }

    _setClipboardText(text) {
        if (typeof text !== 'string' || !text)
            return;
        try {
            this._lastRemoteText = text;
            this._lastRemoteAt = GLib.get_monotonic_time();
            this._clipboard.set_content(
                St.ClipboardType.CLIPBOARD,
                'text/plain;charset=utf-8',
                GLib.Bytes.new(text)
            );
        } catch (e) {
            console.log(`[flyme-link] failed to write clipboard: ${e}`);
        }
    }

    // ───────────────────── QR window ─────────────────────
    _openGui() {
        const program = GLib.find_program_in_path('flyme-link-gui');
        try {
            if (program) {
                Gio.Subprocess.new([program], Gio.SubprocessFlags.NONE);
            } else {
                const script = GLib.build_filenamev([this.path, GUI_SCRIPT]);
                Gio.Subprocess.new(['python3', script], Gio.SubprocessFlags.NONE);
            }
        } catch (e) {
            Main.notifyError?.('Flyme 互联', `无法打开二维码窗口: ${e.message}`);
        }
    }
}
