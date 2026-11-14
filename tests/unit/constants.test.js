"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { toAppVersion, getSocketPath, SOCKET_NAME } = require("../../src/constants.js");
const { createLogger } = require("../../src/logger.js");

test("toAppVersion mirrors Electron's version encoding", () => {
  assert.equal(toAppVersion("1.0.10"), 1000010);
  assert.equal(toAppVersion("1.8.8"), 1008008);
  assert.equal(toAppVersion("2.1.0"), 2001000);
});

test("getSocketPath honours FLYME_SOCK", () => {
  const previous = process.env.FLYME_SOCK;
  process.env.FLYME_SOCK = "/tmp/custom-flyme.sock";
  try {
    assert.equal(getSocketPath(), "/tmp/custom-flyme.sock");
  } finally {
    if (previous === undefined) delete process.env.FLYME_SOCK;
    else process.env.FLYME_SOCK = previous;
  }
  assert.ok(getSocketPath().endsWith(SOCKET_NAME));
});

test("logger writes timestamped lines and respects verbose", () => {
  const chunks = [];
  const stream = { write: (chunk) => chunks.push(chunk) };
  const logger = createLogger({
    verbose: false,
    stream,
    clock: () => new Date("2026-01-02T03:04:05.000Z"),
  });
  logger.log("hello");
  logger.vlog("hidden");
  logger.error("boom");
  assert.equal(chunks.length, 2);
  assert.match(chunks[0], /^\[2026-01-02T03:04:05\.000Z\] hello\n$/);
  assert.match(chunks[1], /ERROR boom/);
});
