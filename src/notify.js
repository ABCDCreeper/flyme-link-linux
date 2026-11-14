"use strict";

const { spawn } = require("child_process");
const { findCommand } = require("./which.js");

/**
 * Desktop notifications. On GNOME the Shell extension shows Main.notify()
 * banners itself; everywhere else (KDE, XFCE, Sway, ...) we fall back to
 * libnotify's notify-send so the daemon stays desktop-agnostic.
 *
 * @param {object} [options]
 * @param {object} [options.logger]
 * @param {string} [options.command]
 * @param {typeof spawn} [options.spawnImpl]
 * @param {string} [options.icon]
 */
function createNotifier(options = {}) {
  const {
    logger = console,
    command = "notify-send",
    spawnImpl = spawn,
    icon = "flyme-link-symbolic",
    appName = "Flyme 互联",
  } = options;

  const executable = findCommand(command);

  const send = (title, body = "") => {
    if (!executable) {
      logger.vlog?.("notify-send not found, skipping notification");
      return false;
    }
    try {
      const child = spawnImpl(
        executable,
        ["--app-name", appName, "--icon", icon, String(title), String(body)],
        { detached: true, stdio: "ignore" }
      );
      child.on?.("error", (err) => logger.warn?.(`notification failed: ${err.message}`));
      child.unref?.();
      return true;
    } catch (err) {
      logger.warn?.(`notification failed: ${err.message}`);
      return false;
    }
  };

  return { available: Boolean(executable), send, command: executable };
}

module.exports = { createNotifier, findCommand };
