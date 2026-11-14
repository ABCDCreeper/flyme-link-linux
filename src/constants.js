"use strict";

const path = require("path");
const os = require("os");
const pkg = require("../package.json");

const VERSION = pkg.version;

/** Official client encodes "1.0.10" as 1*1e6 + 0*1e3 + 10 = 1000010. */
function toAppVersion(version = VERSION) {
  const [major, minor, patch] = version.split("-")[0].split(".").map(Number);
  return major * 1e6 + minor * 1e3 + (patch || 0);
}

const SIGNAL_SERVER =
  process.env.FLYME_SIGNAL_SERVER || "wss://socket.flyme.com/socket";

const HEARTBEAT_MS = 10000;
const HEARTBEAT_TIMEOUT_MS = 3000;
const SESSION_RESTART_MS = 30000;

const SOCKET_NAME = "flyme-link.sock";

/** $XDG_RUNTIME_DIR/flyme-link.sock, overridable for tests and dev installs. */
function getSocketPath() {
  if (process.env.FLYME_SOCK) return process.env.FLYME_SOCK;
  const runtimeDir =
    process.env.XDG_RUNTIME_DIR || path.join(os.tmpdir(), `flyme-link-${process.getuid()}`);
  return path.join(runtimeDir, SOCKET_NAME);
}

const QR_TIPS =
  "请使用Flyme系统扫一扫或者Flyme系统“设置-更多连接-PC 互联”进行扫码连接";

module.exports = {
  VERSION,
  APP_VERSION: toAppVersion(),
  toAppVersion,
  SIGNAL_SERVER,
  HEARTBEAT_MS,
  HEARTBEAT_TIMEOUT_MS,
  SESSION_RESTART_MS,
  SOCKET_NAME,
  getSocketPath,
  QR_TIPS,
};
