"use strict";

const WebSocket = require("ws");

const { encodeMessage, decodeMessage } = require("../protocol/message.js");
const { attachHeartbeat } = require("../protocol/heartbeat.js");
const { generateToken, createSessionId } = require("../protocol/token.js");
const {
  SIGNAL_SERVER,
  HEARTBEAT_MS,
  HEARTBEAT_TIMEOUT_MS,
} = require("../constants.js");

/**
 * Register a pairing session with the Flyme cloud signal server.
 *
 *   wss://socket.flyme.com/socket?userId=SIG_<ts>_<rand>
 *   Sec-WebSocket-Protocol: <AES token>
 *
 * The server replies with {"action":"welcome"} and, after the phone scans the
 * QR code, {"action":"tellMyId","signal":"ws://phone:port/starryshare",...}.
 *
 * @param {object} options
 * @param {object} options.logger
 * @param {string} [options.server]
 * @param {string} [options.sessionId]
 * @param {string} [options.token]
 * @param {typeof WebSocket} [options.WebSocketImpl]
 * @param {(info: {sessionId: string, url: string}) => void} [options.onOpen]
 * @param {(content: object) => void} [options.onWelcome]
 * @param {(info: {signal: string, url: string, appVersion: any, content: object}) => void} [options.onDevice]
 * @param {(content: object) => void} [options.onMessage]
 * @param {(err: Error) => void} [options.onError]
 * @param {(info: {code: number, reason: string}) => void} [options.onClose]
 */
function createSignalSession(options) {
  const {
    logger,
    server = SIGNAL_SERVER,
    sessionId = createSessionId(),
    token = generateToken(),
    WebSocketImpl = WebSocket,
    onOpen = () => {},
    onWelcome = () => {},
    onDevice = () => {},
    onMessage = () => {},
    onError = () => {},
    onClose = () => {},
  } = options;

  const url = `${server}?userId=${encodeURIComponent(sessionId)}`;
  const ws = new WebSocketImpl(url, [token]);
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

  if (typeof ws.on === "function") {
    ws.on("unexpected-response", (_req, res) => {
      onError(new Error(`signal handshake rejected with HTTP ${res.statusCode}`));
    });

    ws.on("open", () => {
      logger.log(`SIGNAL connected (${sessionId})`);
      heartbeat = attachHeartbeat(ws, {
        sender: sessionId,
        label: "SIGNAL",
        interval: HEARTBEAT_MS,
        timeout: HEARTBEAT_TIMEOUT_MS,
        onLog: (line) => logger.warn(line),
      });
      onOpen({ sessionId, url });
    });

    ws.on("message", (raw) => {
      const message = decodeMessage(raw);
      if (!message) {
        logger.vlog("SIGNAL: ignoring malformed frame");
        return;
      }
      heartbeat?.reset();
      const content = message.content;
      switch (content.action) {
        case "welcome":
          onWelcome(content);
          break;
        case "tellMyId":
          onDevice({
            signal: content.signal,
            url: content.url,
            appVersion: content.app_version,
            content,
          });
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
  }

  return {
    ws,
    sessionId,
    url,
    close,
    get isOpen() {
      return ws.readyState === WebSocketImpl.OPEN;
    },
  };
}

module.exports = { createSignalSession };
