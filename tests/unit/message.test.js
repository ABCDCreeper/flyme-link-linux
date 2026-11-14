"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { encodeMessage, decodeMessage } = require("../../src/protocol/message.js");
const { attachHeartbeat } = require("../../src/protocol/heartbeat.js");

test("encodeMessage double-encodes content like the official client", () => {
  const wire = encodeMessage("client", "server", { action: "clipboard_changed", value: "hi" });
  const outer = JSON.parse(wire);
  assert.equal(outer.sender, "client");
  assert.equal(outer.receiver, "server");
  assert.equal(outer.type, 0);
  assert.equal(typeof outer.content, "string");
  assert.deepEqual(JSON.parse(outer.content), {
    action: "clipboard_changed",
    value: "hi",
  });
});

test("decodeMessage round-trips and rejects garbage", () => {
  const wire = encodeMessage("client", "", { action: "ping" }, 1);
  assert.deepEqual(decodeMessage(wire), {
    sender: "client",
    receiver: "",
    content: { action: "ping" },
    type: 1,
  });
  assert.equal(decodeMessage("not json"), null);
  assert.equal(decodeMessage(JSON.stringify({ content: "[" })), null);
  assert.equal(decodeMessage(JSON.stringify({ content: JSON.stringify(null) })), null);
});

class FakeWs extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.sent = [];
    this.terminated = false;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  terminate() {
    this.terminated = true;
  }
}

test("heartbeat pings, resets and closes after two missed pongs", async () => {
  const ws = new FakeWs();
  const timeouts = [];
  const hb = attachHeartbeat(ws, {
    sender: "SIG_1_x",
    interval: 10,
    timeout: 2,
    onTimeout: (info) => timeouts.push(info),
  });

  await new Promise((r) => setTimeout(r, 45));
  assert.ok(ws.sent.length >= 2);
  assert.equal(ws.sent[0].sender, "SIG_1_x");
  assert.equal(JSON.parse(ws.sent[0].content).action, "ping");
  assert.ok(timeouts.length >= 1);
  assert.ok(ws.terminated);

  hb.stop();
  ws.emit("close");
});

test("reset() prevents a heartbeat timeout", async () => {
  const ws = new FakeWs();
  let timedOut = false;
  const hb = attachHeartbeat(ws, {
    interval: 10,
    timeout: 2,
    onTimeout: () => {
      timedOut = true;
    },
  });
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 5));
    hb.reset();
  }
  assert.equal(timedOut, false);
  hb.stop();
});
