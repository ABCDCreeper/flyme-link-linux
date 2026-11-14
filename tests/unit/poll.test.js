"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { startPolling } = require("../../src/clipboard/backends/poll.js");

const logger = { log() {}, info() {}, warn() {}, error() {}, vlog() {} };

function scriptedExecFile(values) {
  let index = 0;
  return (cmd, args, opts, cb) => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    setImmediate(() => cb(value === null ? new Error("empty") : null, value ?? ""));
  };
}

test("polling seeds with the current clipboard and emits changes only", async () => {
  const received = [];
  const backend = startPolling({
    logger,
    onClipboard: (text) => received.push(text),
    command: "wl-paste",
    which: () => "/usr/bin/wl-paste",
    intervalMs: 10,
    execFileImpl: scriptedExecFile(["start", "start", "changed", "changed", "again"]),
  });
  assert.equal(await backend.ready, true);
  await new Promise((r) => setTimeout(r, 80));
  backend.stop();
  assert.deepEqual(received, ["changed", "again"]);
});

test("polling ignores read errors and missing tools", async () => {
  const received = [];
  const backend = startPolling({
    logger,
    onClipboard: (text) => received.push(text),
    command: "xclip",
    which: () => "/usr/bin/xclip",
    args: ["-selection", "clipboard", "-o"],
    intervalMs: 10,
    execFileImpl: scriptedExecFile([null, null]),
  });
  await new Promise((r) => setTimeout(r, 40));
  backend.stop();
  assert.deepEqual(received, []);

  const missing = startPolling({ logger, onClipboard: () => {}, which: () => null });
  assert.equal(await missing.ready, false);
});
