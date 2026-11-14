"use strict";

const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const { WebSocketServer } = require("ws");

const ipc = require("../../src/ipc/protocol.js");

const ROOT = path.join(__dirname, "..", "..");

function waitFor(predicate, timeoutMs = 5000, intervalMs = 50) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let value;
      try {
        value = predicate();
      } catch {
        value = false;
      }
      if (value) return resolve(value);
      if (Date.now() - started > timeoutMs) return reject(new Error("waitFor timeout"));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/**
 * Mock cloud signal server: greets with welcome, then sends tellMyId with the
 * mock phone's DEVICE url as soon as instructed (or right away).
 */
async function startSignalServer({ deviceUrl, delayMs = 300 }) {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => wss.once("listening", resolve));
  const connections = [];
  wss.on("connection", (ws, req) => {
    connections.push({ ws, req });
    ws.send(ipc.serialize({ sender: "server", receiver: "", type: 0, content: JSON.stringify({ action: "welcome", value: "" }) }));
    setTimeout(() => {
      ws.send(
        ipc.serialize({
          sender: "server",
          receiver: "",
          type: 0,
          content: JSON.stringify({
            action: "tellMyId",
            signal: deviceUrl,
            url: "http://127.0.0.1:1",
            app_version: 1009003,
          }),
        })
      );
    }, delayMs);
  });
  return {
    port: wss.address().port,
    connections,
    close: () => new Promise((resolve) => wss.close(resolve)),
  };
}

/** Mock phone side: records envelopes sent by the daemon and can push frames. */
async function startDeviceServer() {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => wss.once("listening", resolve));
  const messages = [];
  const connection = new Promise((resolve) => {
    wss.on("connection", (ws, req) => {
      ws.on("message", (raw) => {
        try {
          const outer = JSON.parse(raw.toString());
          messages.push({ ...outer, content: JSON.parse(outer.content) });
        } catch {
          // ignore
        }
      });
      resolve({ ws, req });
    });
  });
  return {
    port: wss.address().port,
    url: `ws://127.0.0.1:${wss.address().port}/starryshare`,
    messages,
    connection,
    close: () => new Promise((resolve) => wss.close(resolve)),
  };
}

function spawnDaemon({ env = {}, args = ["--daemon", "--no-tray"] } = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, "bin", "flyme-link.js"), ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  child.stderr.on("data", (chunk) => (log += chunk.toString()));
  return { child, getLog: () => log };
}

/** IPC client used to impersonate the GNOME extension / GUI / tray. */
function connectIpc(socketPath) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(socketPath);
    const messages = [];
    const waiters = [];
    let buffer = "";
    conn.on("data", (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        messages.push(message);
        const remaining = [];
        for (const waiter of waiters) {
          if (!waiter(message)) remaining.push(waiter);
        }
        waiters.length = 0;
        waiters.push(...remaining);
      }
    });
    conn.once("error", reject);
    conn.once("connect", () => {
      resolve({
        conn,
        messages,
        send(obj) {
          conn.write(ipc.serialize(obj));
        },
        waitFor(type, timeoutMs = 5000) {
          const existing = messages.find((m) => m.type === type);
          if (existing) return Promise.resolve(existing);
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), timeoutMs);
            waiters.push((message) => {
              if (message.type !== type) return false;
              clearTimeout(timer);
              res(message);
              return true;
            });
          });
        },
        close() {
          conn.end();
        },
      });
    });
  });
}

function makeFakeBin(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, body) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, body);
    fs.chmodSync(file, 0o755);
  };
  // wl-paste: watch mode unsupported (like Mutter); plain reads return empty.
  write(
    "wl-paste",
    '#!/bin/sh\ncase "$1 $2" in\n  "--no-newline --watch") echo "data-control unsupported" >&2; exit 1;;\nesac\ncat /dev/null\n'
  );
  write("wl-copy", '#!/bin/sh\ncat > "$FLYME_CAPTURE/wl-copy.txt"\n');
  write("notify-send", '#!/bin/sh\nprintf "%s\\n" "$@" > "$FLYME_CAPTURE/notify.txt"\n');
  return dir;
}

module.exports = {
  ROOT,
  waitFor,
  startSignalServer,
  startDeviceServer,
  spawnDaemon,
  connectIpc,
  makeFakeBin,
  ipc,
};
