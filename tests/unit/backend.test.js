"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { detectClipboardBackend } = require("../../src/clipboard/backend.js");

const logger = { log() {}, info() {}, warn() {}, error() {}, vlog() {} };

function fakeWatch(supported) {
  return () => ({
    kind: "wayland-watch",
    ready: Promise.resolve(supported),
    stop() {},
  });
}

function fakePoll(kind = "poll") {
  return () => ({
    kind,
    ready: Promise.resolve(true),
    stop() {},
  });
}

test("prefers the GNOME extension when it is connected", async () => {
  const backend = await detectClipboardBackend({
    logger,
    onClipboard: () => {},
    hasExtension: () => true,
    factories: { waylandWatch: fakeWatch(false) },
  });
  assert.equal(backend.kind, "extension");
});

test("uses wl-paste watch when the compositor supports it", async () => {
  const backend = await detectClipboardBackend({
    logger,
    onClipboard: () => {},
    env: { WAYLAND_DISPLAY: "wayland-1" },
    which: () => "/usr/bin/wl-paste",
    factories: { waylandWatch: fakeWatch(true) },
  });
  assert.equal(backend.kind, "wayland-watch");
});

test("falls back to polling when watch mode is unsupported", async () => {
  const backend = await detectClipboardBackend({
    logger,
    onClipboard: () => {},
    env: { WAYLAND_DISPLAY: "wayland-1", XDG_CURRENT_DESKTOP: "GNOME" },
    which: () => "/usr/bin/wl-paste",
    factories: { waylandWatch: fakeWatch(false), polling: fakePoll() },
  });
  assert.equal(backend.kind, "poll");
});

test("selects xclip on X11 and reports none without tools", async () => {
  const x11 = await detectClipboardBackend({
    logger,
    onClipboard: () => {},
    env: { DISPLAY: ":0" },
    which: (cmd) => (cmd === "xclip" ? "/usr/bin/xclip" : null),
    factories: { polling: fakePoll() },
  });
  assert.equal(x11.kind, "poll");

  const none = await detectClipboardBackend({
    logger,
    onClipboard: () => {},
    env: {},
    which: () => null,
  });
  assert.equal(none.kind, "none");
});
