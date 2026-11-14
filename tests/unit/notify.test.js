"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createNotifier, findCommand } = require("../../src/notify.js");

test("findCommand locates executables and misses unknown ones", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flyme-bin-"));
  const file = path.join(dir, "fake-notify");
  fs.writeFileSync(file, "#!/bin/sh\n");
  fs.chmodSync(file, 0o755);
  try {
    assert.equal(findCommand("fake-notify", dir), file);
    assert.equal(findCommand("definitely-not-here", dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("notifier sends notify-send with title and body", () => {
  const calls = [];
  const fakeSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { on() {}, unref() {} };
  };
  const notifier = createNotifier({
    command: process.execPath,
    spawnImpl: fakeSpawn,
    logger: { vlog() {}, warn() {} },
  });
  assert.equal(notifier.available, true);
  assert.equal(notifier.send("Flyme 互联", "已同步手机剪贴板"), true);
  assert.equal(calls[0].cmd, process.execPath);
  assert.ok(calls[0].args.includes("已同步手机剪贴板"));
  assert.equal(calls[0].opts.detached, true);
});

test("notifier degrades gracefully when notify-send is missing", () => {
  const notifier = createNotifier({
    command: "/nonexistent/notify-send",
    logger: { vlog() {}, warn() {} },
  });
  assert.equal(notifier.available, false);
  assert.equal(notifier.send("x", "y"), false);
});
