"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { generateToken, createSessionId } = require("../../src/protocol/token.js");

test("generateToken matches the official CryptoJS output", () => {
  // Golden vector produced by the official client's crypto-js implementation
  // for "starryshare*1794640290745", then made URL-safe.
  assert.equal(
    generateToken(1794640290745),
    "mnJzhqhjmBLvKSz1Y1--9GS5Ko7ZUzNVM1mmMNSV6LQ"
  );
});

test("generateToken changes with the timestamp", () => {
  assert.notEqual(generateToken(1000), generateToken(2000));
});

test("createSessionId uses the official SIG_<ms>_<rand> shape", () => {
  assert.equal(createSessionId(123, () => 0.5), "SIG_123_i");
  assert.match(createSessionId(), /^SIG_\d+_[a-z0-9]{1,4}$/);
});
