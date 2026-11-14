"use strict";

/**
 * Flyme PC Link carries every payload in the same envelope:
 *
 *   { sender, receiver, content: "<JSON string>", type: 0 }
 *
 * `content` is double-encoded JSON; `type` is 0 for ordinary messages.
 *
 * @param {string} sender
 * @param {string} receiver
 * @param {object} content
 * @param {number} [type]
 * @returns {string}
 */
function encodeMessage(sender, receiver, content, type = 0) {
  return JSON.stringify({
    sender,
    receiver,
    content: JSON.stringify(content ?? {}),
    type,
  });
}

/**
 * Decode a wire message. Returns null for malformed input instead of throwing,
 * because unknown/broken frames must not kill the connection.
 *
 * @param {string|Buffer} raw
 * @returns {{sender: any, receiver: any, content: any, type: any} | null}
 */
function decodeMessage(raw) {
  try {
    const outer = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
    if (!outer || typeof outer !== "object") return null;
    const content =
      typeof outer.content === "string" ? JSON.parse(outer.content) : outer.content;
    if (!content || typeof content !== "object") return null;
    return {
      sender: outer.sender,
      receiver: outer.receiver,
      content,
      type: outer.type,
    };
  } catch {
    return null;
  }
}

module.exports = { encodeMessage, decodeMessage };
