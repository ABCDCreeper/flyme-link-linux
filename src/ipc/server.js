"use strict";

const fs = require("fs");
const net = require("net");

const { serialize, parse, hello } = require("./protocol.js");

/**
 * Newline-delimited JSON server on a UNIX socket. Used by the daemon to talk
 * to the GNOME Shell extension, the GTK QR window and the tray icon.
 *
 * @param {object} options
 * @param {string} options.socketPath
 * @param {object} options.logger
 * @param {(client: object, msg: object) => void} [options.onClientMessage]
 * @param {(role: string|null, client: object) => void} [options.onRoleChange]
 * @param {(client: object) => void} [options.onClientConnected]
 * @param {(err: Error) => void} [options.onError]
 * @returns {Promise<object>} server handle
 */
async function createIpcServer(options) {
  const {
    socketPath,
    logger,
    onClientMessage = () => {},
    onRoleChange = () => {},
    onClientConnected = () => {},
    onError = () => {},
  } = options;

  if (await isSocketAlive(socketPath)) {
    throw new Error(`another flyme-link daemon is already listening on ${socketPath}`);
  }
  try {
    fs.unlinkSync(socketPath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  /** @type {Map<net.Socket, {role: string|null, buffer: string}>} */
  const clients = new Map();

  const server = net.createServer((conn) => {
    const entry = { role: null, buffer: "" };
    clients.set(conn, entry);

    const client = {
      get role() {
        return entry.role;
      },
      send(obj) {
        if (!conn.destroyed) conn.write(serialize(obj));
      },
      close() {
        conn.end();
      },
      conn,
    };

    conn.write(serialize(hello()));
    onClientConnected(client);

    conn.on("data", (chunk) => {
      entry.buffer += chunk.toString("utf8");
      let index;
      while ((index = entry.buffer.indexOf("\n")) >= 0) {
        const line = entry.buffer.slice(0, index);
        entry.buffer = entry.buffer.slice(index + 1);
        if (!line.trim()) continue;
        const msg = parse(line);
        if (!msg) {
          logger.vlog("ipc: ignoring malformed line");
          continue;
        }
        if (msg.type === "hello" && typeof msg.role === "string") {
          entry.role = msg.role;
          logger.vlog(`ipc: client role=${msg.role}`);
          onRoleChange(msg.role, client);
        }
        onClientMessage(client, msg);
      }
    });

    const cleanup = () => {
      if (!clients.has(conn)) return;
      const previousRole = entry.role;
      clients.delete(conn);
      if (previousRole) onRoleChange(null, client);
    };
    conn.on("close", cleanup);
    conn.on("error", cleanup);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  try {
    fs.chmodSync(socketPath, 0o600);
  } catch {
    // best effort; some filesystems do not support chmod
  }

  server.on("error", (err) => {
    logger.error(`ipc server error: ${err.message}`);
    onError(err);
  });

  const byRole = (role) => {
    let count = 0;
    for (const entry of clients.values()) if (entry.role === role) count += 1;
    return count;
  };

  return {
    server,
    socketPath,
    broadcast(obj) {
      for (const [conn] of clients) {
        if (!conn.destroyed) conn.write(serialize(obj));
      }
    },
    roleCount: byRole,
    extensionCount: () => byRole("extension"),
    clientCount: () => clients.size,
    close() {
      for (const [conn] of clients) conn.destroy();
      clients.clear();
      return new Promise((resolve) => {
        server.close(() => {
          try {
            fs.unlinkSync(socketPath);
          } catch {
            // already gone
          }
          resolve();
        });
      });
    },
  };
}

/**
 * Check whether a live daemon already owns the socket path. A leftover socket
 * file from a crashed process is not alive and may be replaced.
 */
function isSocketAlive(socketPath) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (alive) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(alive);
    };
    const socket = net.connect(socketPath);
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

module.exports = { createIpcServer, isSocketAlive };
