"use strict";

const QRCode = require("qrcode");
const { QR_TIPS } = require("./constants.js");

/**
 * The phone scans a tiny JSON document, not a URL:
 *   {"starryKey":"SIG_...","source":"pc","tips":"..."}
 * The phone then registers itself with the cloud signal server under that key.
 */
function pairingPayload(sessionId) {
  return {
    starryKey: sessionId,
    source: "pc",
    tips: QR_TIPS,
  };
}

function payloadString(sessionId) {
  return JSON.stringify(pairingPayload(sessionId));
}

/**
 * @param {string} sessionId
 * @param {{width?: number, margin?: number}} [options]
 * @returns {Promise<{payload: object, pngBase64: string}>}
 */
async function renderPng(sessionId, options = {}) {
  const { width = 512, margin = 2 } = options;
  const buffer = await QRCode.toBuffer(payloadString(sessionId), {
    type: "png",
    width,
    margin,
    errorCorrectionLevel: "M",
  });
  return {
    payload: pairingPayload(sessionId),
    pngBase64: buffer.toString("base64"),
  };
}

/**
 * Unicode/ANSI QR code for terminals.
 * @param {string} sessionId
 * @returns {Promise<string>}
 */
async function renderTerminal(sessionId) {
  return QRCode.toString(payloadString(sessionId), { type: "terminal", small: true });
}

module.exports = { pairingPayload, payloadString, renderPng, renderTerminal };
