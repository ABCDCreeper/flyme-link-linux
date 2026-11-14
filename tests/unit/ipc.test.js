"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const { createIpcServer } = require("../../src/ipc/server.js");
const ipc = require("../../src/ipc/protocol.js");

const logger = { log() {}, info() {}, warn() {}, error() {}, vlog() {} };

function tmpSocket() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flyme-ipc-"));
  return { dir, socketPath: path.join(dir, "test.sock") };
}

function connect(socketPath) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(socketPath);
    let buffer = "";
    const messages = [];
    const waiters = [];
    conn.on("data", (chunk) => {
      buffer += chunk.toString();
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const msg = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        messages.push(msg);
        const waiter = waiters.shift();
        if (waiter) waiter(msg);
      }
    });
    conn.once("error", reject);
    let consumed = 0;
    conn.once("connect", () => {
      resolve({
        conn,
        messages,
        next(timeout = 1000) {
          if (consumed < messages.length) return Promise.resolve(messages[consumed++]);
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error("timeout waiting for ipc message")), timeout);
            waiters.push((msg) => {
              clearTimeout(timer);
              consumed += 1;
              res(msg);
            });
          });
        },
        send(obj) {
          conn.write(ipc.serialize(obj));
        },
      });
    });
  });
}

test("ipc server greets clients and dispatches roles and messages", async (t) => {
  const { dir, socketPath } = tmpSocket();
  const roles = [];
  const received = [];
  const server = await createIpcServer({
    socketPath,
    logger,
    onRoleChange: (role) => roles.push(role),
    onClientMessage: (_client, msg) => received.push(msg),
  });
  t.after(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const extension = await connect(socketPath);
  assert.deepEqual(await extension.next(), { type: "hello", version: 2 });
  extension.send({ type: "hello", role: "extension" });
  extension.send(ipc.clip("from extension"));

  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(roles, ["extension"]);
  assert.equal(server.extensionCount(), 1);
  assert.equal(received.at(-1).text, "from extension");

  const gui = await connect(socketPath);
  await gui.next();
  server.broadcast(ipc.state("connected", "phone"));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(extension.messages.at(-1), {
    type: "state",
    state: "connected",
    detail: "phone",
  });
  assert.deepEqual(gui.messages.at(-1), {
    type: "state",
    state: "connected",
    detail: "phone",
  });

  extension.conn.end();
  gui.conn.end();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(server.extensionCount(), 0);
});

test("ipc server calls onClientConnected for snapshots", async (t) => {
  const { dir, socketPath } = tmpSocket();
  const server = await createIpcServer({
    socketPath,
    logger,
    onClientConnected: (client) => client.send(ipc.state("waiting")),
  });
  t.after(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const client = await connect(socketPath);
  assert.equal((await client.next()).type, "hello");
  assert.equal((await client.next()).state, "waiting");
  client.conn.end();
});

test("a second daemon on the same socket is rejected, stale sockets are replaced", async (t) => {
  const { dir, socketPath } = tmpSocket();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(socketPath, "");
  const first = await createIpcServer({ socketPath, logger });
  await assert.rejects(createIpcServer({ socketPath, logger }), /already listening/);
  await first.close();
  assert.equal(fs.existsSync(socketPath), false);
});
