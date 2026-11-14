"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { startWaylandWatch } = require("../../src/clipboard/backends/wayland-watch.js");

const logger = { log() {}, info() {}, warn() {}, error() {}, vlog() {} };

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.exitCode = null;
    this.killed = false;
    this.pid = 1234;
  }
  kill() {
    this.killed = true;
  }
}

test("wayland watch parses NUL-framed clipboard updates", async () => {
  const child = new FakeChild();
  const received = [];
  const backend = startWaylandWatch({
    logger,
    onClipboard: (text) => received.push(text),
    spawnImpl: () => {
      setImmediate(() => child.emit("spawn"));
      return child;
    },
    which: () => "/usr/bin/wl-paste",
    probeMs: 20,
    suppressInitialMs: 0,
  });
  assert.equal(await backend.ready, true);

  child.stdout.emit("data", Buffer.from("first\nline\0second\0"));
  child.stdout.emit("data", Buffer.from("thi"));
  child.stdout.emit("data", Buffer.from("rd\0"));

  assert.deepEqual(received, ["first\nline", "second", "third"]);
  backend.stop();
  assert.equal(child.killed, true);
});

test("wayland watch fails fast when data-control is unsupported", async () => {
  const child = new FakeChild();
  const backend = startWaylandWatch({
    logger,
    onClipboard: () => {},
    spawnImpl: () => {
      setImmediate(() => {
        child.stderr.emit(
          "data",
          Buffer.from("Watch mode requires a compositor that supports the data-control protocol\n")
        );
        child.exitCode = 1;
        child.emit("exit", 1);
      });
      return child;
    },
    which: () => "/usr/bin/wl-paste",
    probeMs: 50,
  });
  assert.equal(await backend.ready, false);
});

test("wayland watch reports missing wl-paste as unsupported", async () => {
  const backend = startWaylandWatch({
    logger,
    onClipboard: () => {},
    which: () => null,
  });
  assert.equal(await backend.ready, false);
});
