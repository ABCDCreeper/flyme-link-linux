"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Look up an executable in PATH without spawning a shell.
 *
 * @param {string} command
 * @param {string} [envPath]
 * @returns {string|null} absolute path or null
 */
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

module.exports = { findCommand };
