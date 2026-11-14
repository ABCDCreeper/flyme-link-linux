"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { WebSocketServer } = require("ws");

const { createDeviceLink } = require("../../src/flyme/device-link.js");
const { encodeMessage, decodeMessage } = require("../../src/protocol/message.js");

const logger = { log() {}, info() {}, warn() {}, error() {}, vlog() {} };

test("device link answers peerInfo, receives clipboard and sends clipboard", async (t) => {
  const wss = new WebSocketServer({ port: 0 });
  t.after(() => wss.close());
  await new Promise((r) => wss.once("listening", r));

  const serverMessages = [];
  const received = [];
  const peerInfos = [];

  const serverConn = new Promise((resolve) => {
    wss.on("connection", (ws, req) => {
      resolve(req);
      ws.on("message", (raw) => {
        const message = decodeMessage(raw);
        if (message) serverMessages.push(message.content);
      });
    });
  });

  const link = createDeviceLink({
    url: `ws://127.0.0.1:${wss.address().port}/starryshare`,
    logger,
    onClipboard: (text) => received.push(text),
    onPeerInfo: (content) => peerInfos.push(content),
  });

  const req = await serverConn;
  assert.match(req.url, /userId=client/);

  const phone = [...wss.clients][0];
  phone.send(
    encodeMessage("phone", "client", {
      action: "peerInfo",
      value: JSON.stringify({ peerName: "phone", peerVersion: 1009003 }),
    })
  );
  phone.send(encodeMessage("phone", "client", { action: "clipboard_changed", value: "手机文本" }));
  phone.send(encodeMessage("phone", "client", { action: "ping" }));

  await new Promise((r) => setTimeout(r, 120));

  const reply = serverMessages.find((m) => m.action === "peerInfo");
  assert.ok(reply, "peerInfo reply sent");
  assert.deepEqual(JSON.parse(reply.value), { peerName: "pc", peerVersion: 1000010 });
  assert.deepEqual(received, ["手机文本"]);
  assert.equal(peerInfos.length, 1);
  assert.ok(serverMessages.some((m) => m.action === "pong"));

  assert.equal(link.sendClipboard("电脑文本"), true);
  await new Promise((r) => setTimeout(r, 80));
  const clip = serverMessages.find((m) => m.action === "clipboard_changed");
  assert.deepEqual(clip, { action: "clipboard_changed", value: "电脑文本" });

  link.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(link.isOpen, false);
});
