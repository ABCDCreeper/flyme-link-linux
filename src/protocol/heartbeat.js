"use strict";

const WebSocket = require("ws");

const DEFAULT_INTERVAL_MS = 10000;
const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Keep a Flyme WebSocket alive with `{action:"ping"}` every `interval` ms.
 * The official client closes the link after two consecutive pong timeouts.
 *
 * @param {import("ws").WebSocket} ws
 * @param {object} [options]
 * @param {string} [options.sender] envelope sender id
 * @param {string} [options.label] log label
 * @param {number} [options.interval]
 * @param {number} [options.timeout]
 * @param {(info: {failures: number}) => void} [options.onTimeout] called after the 2nd failure
 * @param {(msg: string) => void} [options.onLog]
 * @param {typeof WebSocket} [options.WebSocketImpl]
 * @returns {{reset: () => void, stop: () => void}}
 */
function attachHeartbeat(ws, options = {}) {
  const {
    sender = "client",
    label = "WS",
    interval = DEFAULT_INTERVAL_MS,
    timeout = DEFAULT_TIMEOUT_MS,
    onTimeout = () => {},
    onLog = () => {},
    WebSocketImpl = WebSocket,
  } = options;

  let failures = 0;
  let waitTimer = null;

  const timer = setInterval(() => {
    if (ws.readyState !== WebSocketImpl.OPEN) return;
    ws.send(
      JSON.stringify({
        sender,
        receiver: "",
        content: JSON.stringify({ action: "ping" }),
        type: 0,
      })
    );
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => {
      failures += 1;
      onLog(`[${label}] heartbeat timeout (${failures})`);
      if (failures >= 2) {
        onLog(`[${label}] heartbeat failed twice, closing`);
        stop();
        ws.terminate();
        onTimeout({ failures });
      }
    }, timeout);
  }, interval);

  function stop() {
    clearInterval(timer);
    clearTimeout(waitTimer);
  }

  ws.once("close", stop);

  return {
    /** Call after receiving any message to reset the failure counter. */
    reset() {
      clearTimeout(waitTimer);
      failures = 0;
    },
    stop,
  };
}

module.exports = { attachHeartbeat, DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS };
