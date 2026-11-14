"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

/** Look up an executable in PATH without spawning a shell. */
function findCommand(command, envPath = process.env.PATH || "") {
  if (!command) return null;
  if (command.includes(path.sep)) return fs.existsSync(command) ? command : null;
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

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
