"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  waitFor,
  startSignalServer,
  startDeviceServer,
  spawnDaemon,
  connectIpc,
  makeFakeBin,
} = require("../helpers/mocks.js");
const { encodeMessage } = require("../../src/protocol/message.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "flyme-e2e-"));
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)),
  ]);
}

test("full pairing flow with the GNOME extension", { timeout: 25000 }, async (t) => {
  const dir = tempDir();
  const socketPath = path.join(dir, "flyme.sock");
  const device = await startDeviceServer();
  const signal = await startSignalServer({ deviceUrl: device.url });
  const daemon = spawnDaemon({
    env: {
      FLYME_SIGNAL_SERVER: `ws://127.0.0.1:${signal.port}`,
      FLYME_SOCK: socketPath,
    },
  });

  t.after(async () => {
    daemon.child.kill("SIGTERM");
    await signal.close();
    await device.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await waitFor(() => fs.existsSync(socketPath), 8000);
  const extension = await connectIpc(socketPath);
  t.after(() => extension.close());

  await extension.waitFor("hello");
  extension.send({ type: "hello", role: "extension" });

  const waiting = await extension.waitFor("state");
  assert.equal(waiting.state, "waiting");
  const qr = await extension.waitFor("qr");
  assert.match(qr.payload.starryKey, /^SIG_\d+_[a-z0-9]+$/);
  assert.equal(qr.payload.source, "pc");
  assert.ok(Buffer.from(qr.png_base64, "base64").subarray(1, 4).toString() === "PNG");

  const { ws: phone, req } = await withTimeout(device.connection, 5000, "device connection");
  assert.match(req.url, /userId=client/);

  const connected = await waitFor(
    () => extension.messages.find((m) => m.type === "state" && m.state === "connected"),
    5000
  );
  assert.ok(connected);

  phone.send(
    encodeMessage("phone", "client", {
      action: "peerInfo",
      value: JSON.stringify({ peerName: "phone", peerVersion: 1009003 }),
    })
  );
  const reply = await waitFor(
    () => device.messages.find((m) => m.content.action === "peerInfo"),
    5000
  );
  assert.deepEqual(JSON.parse(reply.content.value), { peerName: "pc", peerVersion: 1000010 });

  extension.send({ type: "clip", text: "PC-to-PHONE-文本" });
  const toPhone = await waitFor(
    () => device.messages.find((m) => m.content.action === "clipboard_changed"),
    5000
  );
  assert.equal(toPhone.content.value, "PC-to-PHONE-文本");

  phone.send(encodeMessage("phone", "client", { action: "clipboard_changed", value: "PHONE-to-PC-文本" }));
  const setclip = await extension.waitFor("setclip");
  const notify = await waitFor(
    () => extension.messages.find((m) => m.type === "notify" && /已同步手机剪贴板/.test(m.body || "")),
    5000
  );
  assert.equal(setclip.text, "PHONE-to-PC-文本");
  assert.match(notify.body, /已同步手机剪贴板/);

  // Echo suppression: the extension re-sends the same text, nothing goes back.
  const before = device.messages.filter((m) => m.content.action === "clipboard_changed").length;
  extension.send({ type: "clip", text: "PHONE-to-PC-文本" });
  await new Promise((r) => setTimeout(r, 400));
  const after = device.messages.filter((m) => m.content.action === "clipboard_changed").length;
  assert.equal(after, before);
});

test("non-GNOME desktops write with wl-copy and notify via notify-send", { timeout: 25000 }, async (t) => {
  const dir = tempDir();
  const socketPath = path.join(dir, "flyme.sock");
  const capture = path.join(dir, "capture");
  fs.mkdirSync(capture, { recursive: true });
  const fakeBin = makeFakeBin(path.join(dir, "bin"));

  const device = await startDeviceServer();
  const signal = await startSignalServer({ deviceUrl: device.url });
  const daemon = spawnDaemon({
    env: {
      FLYME_SIGNAL_SERVER: `ws://127.0.0.1:${signal.port}`,
      FLYME_SOCK: socketPath,
      FLYME_CAPTURE: capture,
      PATH: `${fakeBin}:${process.env.PATH}`,
      WAYLAND_DISPLAY: "wayland-0",
      XDG_CURRENT_DESKTOP: "KDE",
    },
  });

  t.after(async () => {
    daemon.child.kill("SIGTERM");
    await signal.close();
    await device.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await waitFor(() => fs.existsSync(socketPath), 8000);
  const { ws: phone } = await withTimeout(device.connection, 5000, "device connection");

  phone.send(encodeMessage("phone", "client", { action: "clipboard_changed", value: "KDE-手机文本" }));

  await waitFor(() => fs.existsSync(path.join(capture, "wl-copy.txt")), 5000);
  assert.equal(fs.readFileSync(path.join(capture, "wl-copy.txt"), "utf8"), "KDE-手机文本");

  await waitFor(() => fs.existsSync(path.join(capture, "notify.txt")), 5000);
  const notifyArgs = fs.readFileSync(path.join(capture, "notify.txt"), "utf8");
  assert.match(notifyArgs, /Flyme 互联/);
  assert.match(notifyArgs, /已同步手机剪贴板/);
});
