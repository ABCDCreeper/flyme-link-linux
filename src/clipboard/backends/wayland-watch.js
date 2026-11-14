"use strict";

const { spawn } = require("child_process");
const { findCommand } = require("../../which.js");

/**
 * Clipboard watcher for compositors implementing the data-control protocol
 * (KWin, Sway, Hyprland, river, ...). Mutter does not implement it, so on
 * GNOME this backend fails fast and the daemon falls back to polling or,
 * preferably, the GNOME Shell extension.
 *
 * `wl-paste --watch` pipes the clipboard into the child command on every
 * change; we run `cat; printf '\0'` and split the stream on NUL to frame
 * clipboard values that may themselves contain newlines.
 *
 * @param {object} options
 * @param {object} options.logger
 * @param {(text: string) => void} options.onClipboard
 * @param {string} [options.command]
 * @param {typeof spawn} [options.spawnImpl]
 * @param {(cmd: string) => string|null} [options.which]
 * @param {number} [options.probeMs]
 * @param {number} [options.suppressInitialMs] ignore the initial replay of the current clipboard
 * @returns {{kind: string, ready: Promise<boolean>, stop: () => void}}
 */
function startWaylandWatch(options) {
  const {
    logger,
    onClipboard,
    command = "wl-paste",
    spawnImpl = spawn,
    which = findCommand,
    probeMs = 800,
    suppressInitialMs = 1500,
  } = options;

  const executable = which(command);
  if (!executable) {
    return { kind: "wayland-watch", ready: Promise.resolve(false), stop() {} };
  }

  let child = null;
  let stopped = false;
  let supported = false;
  let stderr = "";
  let pending = Buffer.alloc(0);
  const suppressUntil = Date.now() + suppressInitialMs;

  const ready = new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      supported = value;
      resolve(value);
    };

    try {
      child = spawnImpl(executable, ["--no-newline", "--watch", "sh", "-c", "cat; printf '\\0'"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      logger.warn(`wayland clipboard watch unavailable: ${err.message}`);
      settle(false);
      return;
    }

    child.once?.("error", (err) => {
      logger.warn(`wayland clipboard watch unavailable: ${err.message}`);
      settle(false);
    });

    child.once?.("spawn", () => {
      logger.vlog("wayland clipboard watch started");
    });

    child.stderr?.on?.("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.stdout?.on?.("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      let index;
      while ((index = pending.indexOf(0)) >= 0) {
        const frame = pending.subarray(0, index).toString("utf8");
        pending = pending.subarray(index + 1);
        if (!frame) continue;
        if (Date.now() < suppressUntil) continue;
        onClipboard(frame);
      }
    });

    child.once?.("exit", (code) => {
      if (!supported) {
        const detail = stderr.trim().split("\n")[0] || `exit code ${code}`;
        logger.warn(`wayland clipboard watch unsupported: ${detail}`);
        settle(false);
      } else if (!stopped) {
        logger.warn(`wayland clipboard watch exited (${code})`);
      }
    });

    // A compositor without data-control exits within a few hundred ms.
    setTimeout(() => {
      if (stopped) return;
      if (child && child.exitCode === null && child.killed !== true) settle(true);
      else settle(false);
    }, probeMs);
  });

  return {
    kind: "wayland-watch",
    ready,
    stop() {
      stopped = true;
      if (!child) return;
      try {
        child.kill();
      } catch {
        // already gone
      }
    },
  };
}

module.exports = { startWaylandWatch };
