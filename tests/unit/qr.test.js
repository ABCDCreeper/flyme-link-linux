"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pairingPayload, payloadString, renderPng, renderTerminal } = require("../../src/qr.js");

test("pairing payload matches the official JSON keys", () => {
  const payload = pairingPayload("SIG_1_abcd");
  assert.deepEqual(Object.keys(payload).sort(), ["source", "starryKey", "tips"]);
  assert.equal(payload.starryKey, "SIG_1_abcd");
  assert.equal(payload.source, "pc");
  assert.match(payloadString("SIG_1_abcd"), /"starryKey":"SIG_1_abcd"/);
});

test("renderPng returns a base64 PNG", async () => {
  const { payload, pngBase64 } = await renderPng("SIG_2_efgh", { width: 128 });
  assert.equal(payload.starryKey, "SIG_2_efgh");
  const buffer = Buffer.from(pngBase64, "base64");
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test("renderTerminal draws a block QR code", async () => {
  const text = await renderTerminal("SIG_3_ijkl");
  assert.ok(text.length > 100);
  assert.match(text, /[▀▄█]/);
});
