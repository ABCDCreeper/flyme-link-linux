"use strict";

const WebSocket = require("ws");

const { encodeMessage, decodeMessage } = require("../protocol/message.js");
const { attachHeartbeat } = require("../protocol/heartbeat.js");
const {
  APP_VERSION,
  HEARTBEAT_MS,
  HEARTBEAT_TIMEOUT_MS,
} = require("../constants.js");

/**
 * Direct link to the phone's WebSocket server, learned from `tellMyId`.
 *
 * The phone is the server: `<signal>?userId=client`. After connecting, both
 * sides exchange peerInfo; clipboard text travels as
 * `{action:"clipboard_changed", value:"<text>"}`.
 *
 * @param {object} options
 * @param {string} options.url phone WebSocket URL from tellMyId
 * @param {object} options.logger
 * @param {number} [options.appVersion]
 * @param {typeof WebSocket} [options.WebSocketImpl]
 */
function createDeviceLink(options) {
  const {
    url,
    logger,
    appVersion = APP_VERSION,
    WebSocketImpl = WebSocket,
    onOpen = () => {},
    onClose = () => {},
    onError = () => {},
    onClipboard = () => {},
    onPeerInfo = () => {},
    onMessage = () => {},
  } = options;

  const separator = url.includes("?") ? "&" : "?";
  const fullUrl = `${url}${separator}userId=client`;
  logger.log(`DEVICE connecting to ${fullUrl}`);

  const ws = new WebSocketImpl(fullUrl);
  let heartbeat = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    heartbeat?.stop();
    try {
      ws.close();
    } catch {
      // already closed
    }
  };

  ws.on("open", () => {
    logger.log("DEVICE connected");
    heartbeat = attachHeartbeat(ws, {
      sender: "client",
      label: "DEVICE",
      interval: HEARTBEAT_MS,
      timeout: HEARTBEAT_TIMEOUT_MS,
      onLog: (line) => logger.warn(line),
    });
    onOpen();
  });

  ws.on("message", (raw) => {
    const message = decodeMessage(raw);
    if (!message) {
      logger.vlog("DEVICE: ignoring malformed frame");
      return;
    }
    heartbeat?.reset();
    const content = message.content;

    switch (content.action) {
      case "peerInfo": {
        logger.log(`DEVICE peerInfo from phone: ${content.value}`);
        ws.send(
          encodeMessage(
            "client",
            "",
            {
              action: "peerInfo",
              value: JSON.stringify({ peerName: "pc", peerVersion: appVersion }),
              contentType: "",
            },
            0
          )
        );
        onPeerInfo(content);
        break;
      }
      case "clipboard_changed": {
        const text = typeof content.value === "string" ? content.value : "";
        if (text) onClipboard(text);
        break;
      }
      case "ping":
        ws.send(encodeMessage("client", "", { action: "pong" }, 0));
        break;
      case "pong":
        break;
      default:
        onMessage(content);
    }
  });

  ws.on("error", (err) => onError(err));
  ws.on("close", (code, reason) => {
    closed = true;
    heartbeat?.stop();
    onClose({ code, reason: reason ? reason.toString() : "" });
  });

  return {
    ws,
    url: fullUrl,
    get isOpen() {
      return ws.readyState === WebSocketImpl.OPEN;
    },
    /** Send local clipboard text to the phone. */
    sendClipboard(text) {
      if (ws.readyState !== WebSocketImpl.OPEN) return false;
      ws.send(encodeMessage("client", "server", { action: "clipboard_changed", value: text }));
      return true;
    },
    close,
  };
}

module.exports = { createDeviceLink };
