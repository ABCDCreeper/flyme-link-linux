"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { WebSocketServer } = require("ws");

const { createSignalSession } = require("../../src/flyme/signal-session.js");
const { encodeMessage } = require("../../src/protocol/message.js");

const logger = { log() {}, info() {}, warn() {}, error() {}, vlog() {} };

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, (...args) => resolve(args)));
}

test("signal session registers, receives welcome and tellMyId", async (t) => {
  const wss = new WebSocketServer({ port: 0 });
  t.after(() => wss.close());
  await once(wss, "listening");
  const port = wss.address().port;

  const serverSide = new Promise((resolve) => {
    wss.on("connection", (ws, req) => resolve({ ws, req }));
  });

  const events = [];
  const session = createSignalSession({
    logger,
    server: `ws://127.0.0.1:${port}`,
    sessionId: "SIG_test_1",
    token: "token-abc",
    onOpen: (info) => events.push(["open", info.sessionId]),
    onWelcome: () => events.push(["welcome"]),
    onDevice: (info) => events.push(["device", info.signal, info.appVersion]),
  });

  const { req } = await serverSide;
  assert.match(req.url, /userId=SIG_test_1/);
  assert.equal(req.headers["sec-websocket-protocol"], "token-abc");

  wss.clients.forEach((ws) => {
    ws.send(encodeMessage("server", "SIG_test_1", { action: "welcome", value: "" }));
    ws.send(
      encodeMessage("server", "SIG_test_1", {
        action: "tellMyId",
        signal: "ws://192.168.1.7:45593/starryshare",
        url: "http://192.168.1.7:45593",
        app_version: 1009003,
      })
    );
  });

  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(events, [
    ["open", "SIG_test_1"],
    ["welcome"],
    ["device", "ws://192.168.1.7:45593/starryshare", 1009003],
  ]);
  session.close();
});

test("signal session reports handshake rejection", async (t) => {
  const wss = new WebSocketServer({ port: 0, verifyClient: () => false });
  t.after(() => wss.close());
  await once(wss, "listening");

  const errors = [];
  createSignalSession({
    logger,
    server: `ws://127.0.0.1:${wss.address().port}`,
    onError: (err) => errors.push(err.message),
  });

  await new Promise((r) => setTimeout(r, 150));
  assert.ok(errors.some((message) => /HTTP 401/.test(message)));
});
