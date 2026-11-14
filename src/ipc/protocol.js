"use strict";

const PROTOCOL_VERSION = 2;

const TYPE = Object.freeze({
  HELLO: "hello",
  STATE: "state",
  QR: "qr",
  NOTIFY: "notify",
  SETCLIP: "setclip",
  CLIP: "clip",
  ACTION: "action",
  STATUS: "status",
});

const ROLE = Object.freeze({
  EXTENSION: "extension",
  GUI: "gui",
  TRAY: "tray",
});

const ACTION = Object.freeze({
  RESCAN: "rescan",
  SHOW_QR: "show-qr",
  QUIT: "quit",
});

/** daemon -> client greeting */
const hello = () => ({ type: TYPE.HELLO, version: PROTOCOL_VERSION });

/** daemon -> client connection state */
const state = (value, detail = "") => ({ type: TYPE.STATE, state: value, detail });

/** daemon -> client pairing QR (PNG base64 + raw payload) */
const qr = (pngBase64, payload) => ({
  type: TYPE.QR,
  png_base64: pngBase64,
  payload,
});

/** daemon -> client desktop notification request */
const notify = (title, body) => ({ type: TYPE.NOTIFY, title, body });

/** daemon -> GNOME extension: write this text to the local clipboard */
const setclip = (text) => ({ type: TYPE.SETCLIP, text });

/** client (extension) -> daemon: local clipboard changed */
const clip = (text) => ({ type: TYPE.CLIP, text });

/** client -> daemon control action */
const action = (name) => ({ type: TYPE.ACTION, action: name });

/** JSON-lines framing */
const serialize = (obj) => `${JSON.stringify(obj)}\n`;

function parse(line) {
  try {
    const msg = JSON.parse(line);
    return msg && typeof msg === "object" ? msg : null;
  } catch {
    return null;
  }
}

module.exports = {
  PROTOCOL_VERSION,
  TYPE,
  ROLE,
  ACTION,
  hello,
  state,
  qr,
  notify,
  setclip,
  clip,
  action,
  serialize,
  parse,
};
