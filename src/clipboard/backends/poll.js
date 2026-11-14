"use strict";

const { execFile } = require("child_process");
const { findCommand } = require("../../which.js");

/**
 * Polling clipboard backend.
 *
 * Used on X11 (xclip) and as a last resort on Wayland compositors without the
 * data-control protocol. On GNOME the Shell extension is strongly preferred:
 * external polling processes can make the panel jitter and are wasteful.
 *
 * @param {object} options
 * @param {object} options.logger
 * @param {(text: string) => void} options.onClipboard
 * @param {string} [options.command]
 * @param {string[]} [options.args]
 * @param {number} [options.intervalMs]
 * @param {Function} [options.execFileImpl]
 * @param {(cmd: string) => string|null} [options.which]
 * @returns {{kind: string, ready: Promise<boolean>, stop: () => void}}
 */
function startPolling(options) {
  const {
    logger,
    onClipboard,
    command = "wl-paste",
    args = [],
    intervalMs = 1200,
    execFileImpl = execFile,
    which = findCommand,
  } = options;

  const executable = which(command);
  if (!executable) {
    return { kind: "poll", ready: Promise.resolve(false), stop() {} };
  }

  let stopped = false;
  let lastText = null;
  let initialized = false;
  let timer = null;

  const read = () => {
    execFileImpl(
      executable,
      args,
      { timeout: 1500, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (stopped) return;
        if (!err && typeof stdout === "string") {
          if (!initialized) {
            // Seed with the current clipboard so we do not replay it to the phone.
            initialized = true;
            lastText = stdout;
          } else if (stdout !== lastText) {
            lastText = stdout;
            if (stdout) onClipboard(stdout);
          }
        }
        timer = setTimeout(read, intervalMs);
      }
    );
  };

  timer = setTimeout(read, 0);

  return {
    kind: "poll",
    ready: Promise.resolve(true),
    stop() {
      stopped = true;
      clearTimeout(timer);
      logger.vlog(`polling clipboard backend stopped (${command})`);
    },
  };
}

module.exports = { startPolling };
