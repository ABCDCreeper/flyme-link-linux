"use strict";

const dbus = require("dbus-next");

const { Interface, ACCESS_READ } = dbus.interface;
const { Variant } = dbus;

const v = (signature, value) => new Variant(signature, value);

/**
 * Minimal com.canonical.dbusmenu implementation used by the tray icon.
 * The menu is static in structure; only labels/enabled states and the
 * revision counter change at runtime.
 */
class DbusMenu extends Interface {
  /**
   * @param {object} options
   * @param {() => any[]} options.getRootLayout returns [id, props, children]
   * @param {(id: number, eventId: string, data: any) => void} options.onEvent
   */
  constructor({ getRootLayout, onEvent }) {
    super("com.canonical.dbusmenu");
    this._getRootLayout = getRootLayout;
    this._onEvent = onEvent;
    this._revision = 1;
  }

  get Version() {
    return 3;
  }

  get Status() {
    return "normal";
  }

  get TextDirection() {
    return "ltr";
  }

  get IconThemePath() {
    return [];
  }

  GetLayout(_parentId, _recursionDepth, _propertyNames) {
    const [id, props, children] = this._getRootLayout();
    // The 'av' children member carries each child layout as a Variant.
    return [this._revision, [id, props, children.map((child) => v("(ia{sv}av)", child))]];
  }

  GetGroupProperties(ids) {
    const wanted = new Set(ids);
    const result = [];
    const walk = ([id, props, children]) => {
      if (wanted.size === 0 || wanted.has(id)) result.push([id, props]);
      for (const child of children) walk(child);
    };
    walk(this._getRootLayout());
    return result;
  }

  GetProperty(id, name) {
    let found = null;
    const walk = ([itemId, props, children]) => {
      if (itemId === id) found = props[name] || v("s", "");
      for (const child of children) walk(child);
    };
    walk(this._getRootLayout());
    return found || v("s", "");
  }

  Event(id, eventId, data, _timestamp) {
    this._onEvent(id, eventId, data);
    return undefined;
  }

  AboutToShow(_id) {
    return false;
  }

  AboutToShowGroup(_ids) {
    return [[], []];
  }

  LayoutUpdated(revision, parent) {
    return [revision, parent];
  }

  /** Bump the revision so hosts re-read labels. */
  touch() {
    this._revision += 1;
    this.LayoutUpdated(this._revision, 0);
  }
}

DbusMenu.configureMembers({
  properties: {
    Version: { signature: "u", access: ACCESS_READ },
    Status: { signature: "s", access: ACCESS_READ },
    TextDirection: { signature: "s", access: ACCESS_READ },
    IconThemePath: { signature: "as", access: ACCESS_READ },
  },
  methods: {
    GetLayout: { inSignature: "iias", outSignature: "u(ia{sv}av)" },
    GetGroupProperties: { inSignature: "aias", outSignature: "a(ia{sv})" },
    GetProperty: { inSignature: "is", outSignature: "v" },
    Event: { inSignature: "isvu", outSignature: "" },
    AboutToShow: { inSignature: "i", outSignature: "b" },
    AboutToShowGroup: { inSignature: "ai", outSignature: "aiai" },
  },
  signals: {
    ItemsPropertiesUpdated: { signature: "a(ia{sv})a(ias)" },
    LayoutUpdated: { signature: "ui" },
  },
});

module.exports = { DbusMenu, v };
