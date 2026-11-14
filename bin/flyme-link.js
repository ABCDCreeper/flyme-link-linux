#!/usr/bin/env node
"use strict";

const { VERSION } = require("../src/constants.js");
const { createLogger } = require("../src/logger.js");
const { createDaemon } = require("../src/daemon.js");

const HELP = `flyme-link-linux ${VERSION}

Linux client for Meizu Flyme PC Link (Flyme 互联) clipboard sync.

Usage:
  flyme-link [options]

Options:
  -v, --verbose        verbose logging
      --daemon         run without the interactive terminal QR code
      --no-tray        do not create the StatusNotifier tray icon
      --socket <path>  control socket path (default: $XDG_RUNTIME_DIR/flyme-link.sock)
      --signal <url>   override the signal server (default: wss://socket.flyme.com/socket)
  -h, --help           show this help
      --version        show the version

Environment:
  FLYME_SIGNAL_SERVER  same as --signal
  FLYME_SOCK           same as --socket
  FLYME_PEER_VERSION   version advertised to the phone (default: 1000010)
`;

function parseArgs(argv) {
  const options = {
    verbose: false,
    daemon: false,
    tray: true,
    socket: undefined,
    signal: undefined,
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "-v":
      case "--verbose":
        options.verbose = true;
        break;
      case "--daemon":
        options.daemon = true;
        break;
      case "--no-tray":
        options.tray = false;
        break;
      case "--socket":
        options.socket = argv[++i];
        if (!options.socket) throw new Error("--socket requires a path");
        break;
      case "--signal":
        options.signal = argv[++i];
        if (!options.signal) throw new Error("--signal requires a URL");
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--version":
        options.version = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`flyme-link: ${err.message}\n\n${HELP}`);
    process.exit(2);
  }

  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const logger = createLogger({ verbose: options.verbose });
  process.on("uncaughtException", (err) => {
    logger.error(`uncaught exception: ${err.stack || err.message}`);
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    logger.error(`unhandled rejection: ${err?.stack || err}`);
  });

  const daemon = await createDaemon({
    logger,
    socketPath: options.socket,
    signalServer: options.signal,
    trayEnabled: options.tray,
    terminalQr: !options.daemon,
  });

  let stopping = false;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    try {
      await daemon.shutdown();
    } finally {
      process.exit(code);
    }
  };

  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));

  logger.log(`flyme-link ${VERSION} started${options.daemon ? " (daemon mode)" : ""}`);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, HELP };
