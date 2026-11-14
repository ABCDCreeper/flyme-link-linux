"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createClipboardWriter } = require("../../src/clipboard/writer.js");

const logger = { log() {}, info() {}, warn() {}, error() {}, vlog() {} };

function fakeSpawn() {
  const calls = [];
  const spawnImpl = (cmd, args) => {
    const call = { cmd, args, stdin: "" };
    calls.push(call);
    return {
      stdin: { end: (text) => (call.stdin = text) },
      on() {},
      unref() {},
    };
  };
  return { calls, spawnImpl };
}

test("prefers the GNOME extension when connected", () => {
  const { calls, spawnImpl } = fakeSpawn();
  let sent = null;
  const writer = createClipboardWriter({
    logger,
    env: { WAYLAND_DISPLAY: "wayland-0" },
    which: (cmd) => (cmd === "wl-copy" ? "/usr/bin/wl-copy" : null),
    spawnImpl,
    isExtensionConnected: () => true,
    sendToExtension: (text) => {
      sent = text;
      return true;
    },
  });
  assert.deepEqual(writer.write("hello"), { ok: true, via: "extension" });
  assert.equal(sent, "hello");
  assert.equal(calls.length, 0);
});

test("falls back to wl-copy on Wayland", () => {
  const { calls, spawnImpl } = fakeSpawn();
  const writer = createClipboardWriter({
    logger,
    env: { WAYLAND_DISPLAY: "wayland-0" },
    which: (cmd) => ({ "wl-copy": "/usr/bin/wl-copy" })[cmd] || null,
    spawnImpl,
  });
  assert.deepEqual(writer.write("wayland text"), { ok: true, via: "wl-copy" });
  assert.equal(calls[0].cmd, "/usr/bin/wl-copy");
  assert.equal(calls[0].stdin, "wayland text");
});

test("uses xclip on X11 and xsel as the last resort", () => {
  const withXclip = fakeSpawn();
  const writer = createClipboardWriter({
    logger,
    env: { DISPLAY: ":0" },
    which: (cmd) => ({ xclip: "/usr/bin/xclip", xsel: "/usr/bin/xsel" })[cmd] || null,
    spawnImpl: withXclip.spawnImpl,
  });
  assert.deepEqual(writer.write("x11"), { ok: true, via: "xclip" });
  assert.deepEqual(withXclip.calls[0].args, ["-selection", "clipboard", "-in"]);

  const withXsel = fakeSpawn();
  const xselWriter = createClipboardWriter({
    logger,
    env: { DISPLAY: ":0" },
    which: (cmd) => (cmd === "xsel" ? "/usr/bin/xsel" : null),
    spawnImpl: withXsel.spawnImpl,
  });
  assert.deepEqual(xselWriter.write("xsel"), { ok: true, via: "xsel" });
  assert.deepEqual(withXsel.calls[0].args, ["--clipboard", "--input"]);
});

test("reports failure when no clipboard tool exists", () => {
  const writer = createClipboardWriter({
    logger,
    env: {},
    which: () => null,
    spawnImpl: fakeSpawn().spawnImpl,
  });
  assert.deepEqual(writer.write("nowhere"), { ok: false, via: "none" });
});
