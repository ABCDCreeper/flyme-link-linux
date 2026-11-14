"use strict";

const { findCommand } = require("../which.js");
const { startWaylandWatch } = require("./backends/wayland-watch.js");
const { startPolling } = require("./backends/poll.js");

/**
 * Pick the best clipboard watcher for the current desktop:
 *
 *   1. GNOME Shell extension, when connected (in-compositor, no flicker)
 *   2. wl-paste --watch (KWin, Sway, Hyprland, ...)
 *   3. polling: wl-paste on Wayland, xclip/xsel on X11
 *
 * @param {object} options
 * @param {object} options.logger
 * @param {(text: string) => void} options.onClipboard
 * @param {() => boolean} [options.hasExtension]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {(cmd: string) => string|null} [options.which]
 * @param {object} [options.factories] dependency injection for tests
 * @returns {Promise<{kind: string, ready: boolean, stop: () => void}>}
 */
async function detectClipboardBackend(options) {
  const {
    logger,
    onClipboard,
    hasExtension = () => false,
    env = process.env,
    which = findCommand,
    factories = {},
  } = options;

  const waylandWatch = factories.waylandWatch || startWaylandWatch;
  const polling = factories.polling || startPolling;

  if (hasExtension()) {
    return { kind: "extension", ready: true, stop() {} };
  }

  const wayland = Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === "wayland";

  if (wayland) {
    const watch = waylandWatch({
      logger,
      onClipboard,
      command: "wl-paste",
      which,
      spawnImpl: factories.spawnImpl,
    });
    if (await watch.ready) return { kind: watch.kind, ready: true, stop: watch.stop };

    watch.stop();
    if (!which("wl-paste")) {
      logger.warn("wl-clipboard is not installed; install wl-clipboard for clipboard sync");
      return { kind: "none", ready: false, stop() {} };
    }
    if ((env.XDG_CURRENT_DESKTOP || "").toUpperCase().includes("GNOME")) {
      logger.warn(
        "GNOME does not allow clipboard watching from external processes. " +
          "Install the bundled GNOME Shell extension for flicker-free sync; " +
          "falling back to polling."
      );
    }
    const poll = polling({
      logger,
      onClipboard,
      command: "wl-paste",
      which,
      execFileImpl: factories.execFileImpl,
    });
    return { kind: poll.kind, ready: await poll.ready, stop: poll.stop };
  }

  if (env.DISPLAY) {
    const command = which("xclip") ? "xclip" : which("xsel") ? "xsel" : null;
    if (!command) {
      logger.warn("install xclip or xsel for clipboard sync on X11");
      return { kind: "none", ready: false, stop() {} };
    }
    const poll = polling({
      logger,
      onClipboard,
      command,
      args: command === "xclip" ? ["-selection", "clipboard", "-o"] : ["--clipboard", "--output"],
      which,
      execFileImpl: factories.execFileImpl,
    });
    return { kind: poll.kind, ready: await poll.ready, stop: poll.stop };
  }

  logger.warn("no Wayland or X11 display detected; clipboard sync is unavailable");
  return { kind: "none", ready: false, stop() {} };
}

module.exports = { detectClipboardBackend };
