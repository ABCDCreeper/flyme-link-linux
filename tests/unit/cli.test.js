"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { parseArgs } = require("../../bin/flyme-link.js");

test("parseArgs handles defaults and flags", () => {
  assert.deepEqual(parseArgs([]), {
    verbose: false,
    daemon: false,
    tray: true,
    socket: undefined,
    signal: undefined,
    help: false,
    version: false,
  });
  const options = parseArgs([
    "-v",
    "--daemon",
    "--no-tray",
    "--socket",
    "/tmp/x.sock",
    "--signal",
    "ws://127.0.0.1:1",
  ]);
  assert.equal(options.verbose, true);
  assert.equal(options.daemon, true);
  assert.equal(options.tray, false);
  assert.equal(options.socket, "/tmp/x.sock");
  assert.equal(options.signal, "ws://127.0.0.1:1");
});

test("parseArgs rejects unknown and incomplete options", () => {
  assert.throws(() => parseArgs(["--nope"]), /unknown option/);
  assert.throws(() => parseArgs(["--socket"]), /requires a path/);
  assert.throws(() => parseArgs(["--signal"]), /requires a URL/);
});
