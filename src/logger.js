"use strict";

/**
 * Minimal leveled logger. Everything goes to stderr so that stdout can stay
 * free for the interactive terminal QR code / machine-readable output.
 *
 * @param {{verbose?: boolean, stream?: NodeJS.WritableStream, clock?: () => Date}} [options]
 */
function createLogger(options = {}) {
  const {
    verbose = false,
    stream = process.stderr,
    clock = () => new Date(),
  } = options;

  const write = (level, args) => {
    const line = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    stream.write(`[${clock().toISOString()}] ${level}${line}\n`);
  };

  return {
    log: (...args) => write("", args),
    info: (...args) => write("", args),
    warn: (...args) => write("WARN ", args),
    error: (...args) => write("ERROR ", args),
    vlog: (...args) => {
      if (verbose) write("DEBUG ", args);
    },
    get verbose() {
      return verbose;
    },
  };
}

module.exports = { createLogger };
