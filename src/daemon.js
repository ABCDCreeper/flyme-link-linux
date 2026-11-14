"use strict";

const path = require("path");
const { spawn } = require("child_process");

const { getSocketPath, SESSION_RESTART_MS } = require("./constants.js");
const { createLogger } = require("./logger.js");
const ipc = require("./ipc/protocol.js");
const { createIpcServer } = require("./ipc/server.js");
const { createNotifier } = require("./notify.js");
const { createClipboardWriter } = require("./clipboard/writer.js");
const { detectClipboardBackend } = require("./clipboard/backend.js");
const { createSignalSession } = require("./flyme/signal-session.js");
const { createDeviceLink } = require("./flyme/device-link.js");
const { renderPng, renderTerminal } = require("./qr.js");
const { createTray } = require("./tray/tray.js");
const { findCommand } = require("./which.js");

// Give the GNOME extension time to reconnect before falling back to external
// clipboard watchers / the SNI tray (the extension retries every 3s).
const EXTENSION_GRACE_MS = 4000;

/**
 * The daemon ties everything together:
 *
 *   signal session -> QR -> phone DEVICE link -> clipboard both ways
 *   IPC socket     -> GNOME extension / GUI / tray
 *   local watcher  -> only when the GNOME extension is not connected
 *
 * @param {object} [options]
 */
async function createDaemon(options = {}) {
  const {
    logger = createLogger(),
    socketPath = getSocketPath(),
    signalServer,
    trayEnabled = true,
    terminalQr = true,
    guiCommand = "flyme-link-gui",
    notifier,
    ipcServerFactory = createIpcServer,
    trayFactory = createTray,
    spawnImpl = spawn,
    which = findCommand,
  } = options;

  const state = {
    value: "offline",
    detail: "",
    lastQr: null,
  };

  let ipcServer = null;
  let signalSession = null;
  let device = null;
  let backend = null;
  let backendKind = "none";
  let tray = null;
  let restartTimer = null;
  let fallbackTimer = null;
  let stopping = false;
  let lastLocalText = null;
  let lastRemoteText = null;

  const desktopNotifier = notifier || createNotifier({ logger });

  const writer = createClipboardWriter({
    logger,
    isExtensionConnected: () => Boolean(ipcServer && ipcServer.extensionCount() > 0),
    sendToExtension: (text) => {
      if (!ipcServer || ipcServer.extensionCount() === 0) return false;
      ipcServer.broadcast(ipc.setclip(text));
      return true;
    },
    spawnImpl,
  });

  // ───────────────────────── notifications ─────────────────────────
  const notifyRemote = (title, body) => {
    if (ipcServer && ipcServer.extensionCount() > 0) {
      // GNOME Shell extension renders the banner itself.
      ipcServer.broadcast(ipc.notify(title, body));
      return;
    }
    desktopNotifier.send(title, body);
  };

  // ───────────────────────── state ─────────────────────────
  const setState = (value, detail = "") => {
    const previous = state.value;
    state.value = value;
    state.detail = detail;
    logger.log(`state: ${value}${detail ? ` (${detail})` : ""}`);
    ipcServer?.broadcast(ipc.state(value, detail));
    tray?.update(value, detail);
    if (previous !== value && previous !== "offline") {
      if (value === "connected") notifyRemote("Flyme 互联", "已连接手机，剪贴板同步已开启");
      else if (previous === "connected") {
        notifyRemote("Flyme 互联", "手机连接已断开，请重新扫码配对");
      }
    }
  };

  // ───────────────────────── clipboard ─────────────────────────
  const onLocalClipboard = (text) => {
    if (!text || text === lastLocalText || text === lastRemoteText) return;
    if (!device || !device.isOpen) {
      logger.vlog("phone not connected, ignoring local clipboard change");
      return;
    }
    lastLocalText = text;
    device.sendClipboard(text);
    logger.log(`clipboard -> phone (${text.length} chars)`);
  };

  const onPhoneClipboard = (text) => {
    if (!text || text === lastLocalText || text === lastRemoteText) return;
    lastRemoteText = text;
    const result = writer.write(text);
    logger.log(`clipboard <- phone (${text.length} chars, via ${result.via})`);
    const preview = text.replace(/\s+/g, " ").slice(0, 48);
    notifyRemote("Flyme 互联", `已同步手机剪贴板: ${preview}${text.length > 48 ? "…" : ""}`);
  };

  // ───────────────────────── local watcher & tray ─────────────────────────
  const startLocalBackend = async () => {
    if (stopping || backend) return;
    if (ipcServer && ipcServer.extensionCount() > 0) return;
    const detected = await detectClipboardBackend({
      logger,
      onClipboard: onLocalClipboard,
      hasExtension: () => Boolean(ipcServer && ipcServer.extensionCount() > 0),
    });
    if (stopping) {
      detected.stop();
      return;
    }
    if (!detected.ready) {
      backendKind = "none";
      return;
    }
    backend = detected;
    backendKind = detected.kind;
    logger.log(`clipboard backend: ${backendKind}`);
  };

  const stopLocalBackend = () => {
    backend?.stop();
    backend = null;
    backendKind = "none";
  };

  const startTray = async () => {
    if (stopping || tray || !trayEnabled) return;
    if (ipcServer && ipcServer.extensionCount() > 0) return;
    tray = await trayFactory({
      logger,
      handlers: {
        onShowQr: openGui,
        onRescan: rescan,
        onQuit: () => shutdown().then(() => process.exit(0)),
      },
    });
    tray?.update(state.value, state.detail);
  };

  const stopTray = () => {
    tray?.stop();
    tray = null;
  };

  const scheduleFallback = () => {
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      if (stopping) return;
      if (ipcServer && ipcServer.extensionCount() > 0) return;
      startLocalBackend();
      startTray();
    }, EXTENSION_GRACE_MS);
  };

  // ───────────────────────── GUI ─────────────────────────
  const openGui = () => {
    const resolved = which(guiCommand);
    const localScript = path.join(__dirname, "..", "gui", "flyme-qr-gui.py");
    let command;
    let args;
    if (resolved) {
      command = resolved;
      args = [];
    } else if (findCommand("python3")) {
      command = findCommand("python3");
      args = [localScript];
    } else {
      logger.warn("cannot open QR window: flyme-link-gui and python3 are missing");
      desktopNotifier.send("Flyme 互联", "无法打开二维码窗口：缺少 flyme-link-gui/python3");
      return;
    }
    try {
      const child = spawnImpl(command, args, { detached: true, stdio: "ignore" });
      child.on?.("error", (err) => logger.warn(`cannot open QR window: ${err.message}`));
      child.unref?.();
    } catch (err) {
      logger.warn(`cannot open QR window: ${err.message}`);
    }
  };

  // ───────────────────────── pairing ─────────────────────────
  const closeSession = () => {
    device?.close();
    device = null;
    signalSession?.close();
    signalSession = null;
  };

  const scheduleRestart = (delay = SESSION_RESTART_MS) => {
    if (stopping) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (!stopping) startSession();
    }, delay);
  };

  const connectDevice = (url) => {
    device?.close();
    device = createDeviceLink({
      url,
      logger,
      onOpen: () => setState("connected", "已连接手机"),
      onClipboard: onPhoneClipboard,
      onError: (err) => logger.warn(`DEVICE error: ${err.message}`),
      onClose: () => {
        device = null;
        if (stopping) return;
        setState("waiting", "连接断开，等待重新扫码");
        scheduleRestart();
      },
    });
  };

  const startSession = () => {
    if (stopping) return;
    clearTimeout(restartTimer);
    closeSession();
    setState("waiting", "等待手机扫码");

    signalSession = createSignalSession({
      logger,
      ...(signalServer ? { server: signalServer } : {}),
      onOpen: async ({ sessionId }) => {
        const rendered = await renderPng(sessionId);
        state.lastQr = rendered;
        ipcServer?.broadcast(ipc.qr(rendered.pngBase64, rendered.payload));
        if (terminalQr && process.stderr.isTTY) {
          try {
            const terminal = await renderTerminal(sessionId);
            process.stderr.write(`\n${terminal}\n`);
            process.stderr.write("→ 请用魅族手机 [设置-更多连接-PC 互联] 或 Flyme 扫一扫 扫码\n");
          } catch {
            // terminal QR is a convenience only
          }
        }
      },
      onDevice: ({ signal, url }) => {
        logger.log(`phone scanned the QR code (signal=${signal})`);
        setState("linking", "手机已扫码，正在建立连接…");
        signalSession?.close();
        signalSession = null;
        connectDevice(signal);
        if (url) logger.vlog(`phone http endpoint: ${url}`);
      },
      onMessage: (content) => logger.vlog(`SIGNAL message: ${JSON.stringify(content)}`),
      onError: (err) => logger.warn(`SIGNAL error: ${err.message}`),
      onClose: ({ code }) => {
        if (stopping || device) return;
        logger.log(`SIGNAL closed (${code}), regenerating QR in ${SESSION_RESTART_MS / 1000}s`);
        scheduleRestart();
      },
    });
  };

  const rescan = () => {
    logger.log("rescan requested");
    startSession();
  };

  // ───────────────────────── shutdown ─────────────────────────
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    clearTimeout(restartTimer);
    clearTimeout(fallbackTimer);
    closeSession();
    stopLocalBackend();
    stopTray();
    if (ipcServer) {
      await ipcServer.close();
      ipcServer = null;
    }
    logger.log("daemon stopped");
  }

  // ───────────────────────── IPC ─────────────────────────
  ipcServer = await ipcServerFactory({
    socketPath,
    logger,
    onClientConnected: (client) => {
      if (state.value) client.send(ipc.state(state.value, state.detail));
      if (state.lastQr) client.send(ipc.qr(state.lastQr.pngBase64, state.lastQr.payload));
    },
    onRoleChange: (role) => {
      if (!role) {
        if (ipcServer && ipcServer.extensionCount() === 0) {
          logger.log("GNOME extension disconnected; enabling local clipboard backend");
          startLocalBackend();
          startTray();
        }
        return;
      }
      if (role === ipc.ROLE.EXTENSION) {
        logger.log("GNOME extension connected; using in-compositor clipboard");
        stopLocalBackend();
        stopTray();
      }
    },
    onClientMessage: (client, msg) => {
      if (msg.type === ipc.TYPE.CLIP && typeof msg.text === "string") {
        onLocalClipboard(msg.text);
      } else if (msg.type === ipc.TYPE.ACTION) {
        if (msg.action === ipc.ACTION.RESCAN) rescan();
        else if (msg.action === ipc.ACTION.SHOW_QR) openGui();
        else if (msg.action === ipc.ACTION.QUIT) shutdown().then(() => process.exit(0));
      }
    },
  });

  logger.log(`control socket: ${socketPath}`);
  startSession();
  scheduleFallback();

  return {
    get state() {
      return state.value;
    },
    get lastQr() {
      return state.lastQr;
    },
    get backendKind() {
      return backendKind;
    },
    get socketPath() {
      return socketPath;
    },
    get extensionCount() {
      return ipcServer ? ipcServer.extensionCount() : 0;
    },
    get hasTray() {
      return Boolean(tray);
    },
    openGui,
    rescan,
    shutdown,
    stop: shutdown,
  };
}

module.exports = { createDaemon };
