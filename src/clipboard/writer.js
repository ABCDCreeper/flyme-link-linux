"use strict";

const { spawn } = require("child_process");
const { findCommand } = require("../which.js");

/**
 * Cross-desktop clipboard writer.
 *
 * Priority:
 *   1. GNOME Shell extension (in-compositor St.Clipboard, zero flicker)
 *   2. Wayland: wl-copy (KWin, Sway, Hyprland, ...)
 *   3. X11: xclip / xsel
 *
 * Text is fed through stdin so large clipboards never hit ARG_MAX.
 *
 * @param {object} options
 * @param {object} options.logger
 * @param {() => boolean} [options.isExtensionConnected]
 * @param {(text: string) => boolean} [options.sendToExtension]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof spawn} [options.spawnImpl]
 * @param {(cmd: string) => string|null} [options.which]
 */
function createClipboardWriter(options) {
  const {
    logger,
    isExtensionConnected = () => false,
    sendToExtension = () => false,
    env = process.env,
    spawnImpl = spawn,
    which = findCommand,
  } = options;

  const wayland = Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === "wayland";
  const wlCopy = wayland ? which("wl-copy") : null;
  const xclip = !wayland ? which("xclip") : null;
  const xsel = !wayland ? which("xsel") : null;

  if (wayland && !wlCopy) {
    logger.warn("wl-copy not found: install wl-clipboard to receive phone clipboard");
  }
  if (!wayland && !xclip && !xsel) {
    logger.warn("xclip/xsel not found: install one to receive phone clipboard on X11");
  }

  const feed = (command, args, text) => {
    try {
      const child = spawnImpl(command, args, {
        detached: true,
        stdio: ["pipe", "ignore", "ignore"],
      });
      child.on?.("error", (err) => logger.warn(`clipboard write failed (${command}): ${err.message}`));
      child.stdin?.end?.(text);
      child.unref?.();
      return true;
    } catch (err) {
      logger.warn(`clipboard write failed (${command}): ${err.message}`);
      return false;
    }
  };

  return {
    /** @param {string} text @returns {{ok: boolean, via: string}} */
    write(text) {
      if (isExtensionConnected() && sendToExtension(text)) {
        return { ok: true, via: "extension" };
      }
      if (wlCopy && feed(wlCopy, [], text)) return { ok: true, via: "wl-copy" };
      if (xclip && feed(xclip, ["-selection", "clipboard", "-in"], text)) {
        return { ok: true, via: "xclip" };
      }
      if (xsel && feed(xsel, ["--clipboard", "--input"], text)) {
        return { ok: true, via: "xsel" };
      }
      return { ok: false, via: "none" };
    },
    /** Backend that would be used for a local write, for diagnostics. */
    get kind() {
      if (wlCopy) return "wl-copy";
      if (xclip) return "xclip";
      if (xsel) return "xsel";
      return "none";
    },
  };
}

module.exports = { createClipboardWriter };
