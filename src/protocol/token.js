"use strict";

const crypto = require("crypto");

// AES-256-ECB key embedded in the official pc-link-app 1.0.10 client.
// The token proves "client freshness" only; it is not tied to a Flyme account.
const TOKEN_KEY = "starryshare000000000000000000000";
const TOKEN_PREFIX = "starryshare*";

/**
 * Build the WebSocket subprotocol token expected by socket.flyme.com:
 *
 *   urlsafe_base64( AES-256-ECB-PKCS7("starryshare*" + Date.now(), TOKEN_KEY) )
 *
 * The official client implements this with CryptoJS:
 *   CryptoJS.AES.encrypt(src, CryptoJS.enc.Utf8.parse(key),
 *     { mode: ECB, padding: Pkcs7 }).toString()
 * then replaces "/" -> "_", "+" -> "-" and strips "=".
 *
 * @param {number} [now] milliseconds since epoch, injectable for tests
 * @returns {string}
 */
function generateToken(now = Date.now()) {
  const cipher = crypto.createCipheriv(
    "aes-256-ecb",
    Buffer.from(TOKEN_KEY, "utf8"),
    null
  );
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(TOKEN_PREFIX + now, "utf8")),
    cipher.final(),
  ]);
  return encrypted
    .toString("base64")
    .replace(/\//g, "_")
    .replace(/\+/g, "-")
    .replace(/=/g, "");
}

/**
 * Session id used as starryKey / SIGNAL userId. The official client formats it
 * as `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`.
 *
 * @param {number} [now]
 * @param {() => number} [random] injectable for tests
 * @returns {string}
 */
function createSessionId(now = Date.now(), random = Math.random) {
  const suffix = random().toString(36).slice(2, 6);
  return `SIG_${now}_${suffix}`;
}

module.exports = { TOKEN_KEY, TOKEN_PREFIX, generateToken, createSessionId };
