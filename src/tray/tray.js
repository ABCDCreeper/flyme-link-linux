"use strict";

const dbus = require("dbus-next");

const { Interface, ACCESS_READ } = dbus.interface;
const { DbusMenu, v } = require("./dbusmenu.js");

const WATCHER_NAME = "org.kde.StatusNotifierWatcher";
const WATCHER_PATH = "/StatusNotifierWatcher";
const ITEM_PATH = "/StatusNotifierItem";
const MENU_PATH = "/Menu";

const MENU_ID = Object.freeze({
  ROOT: 0,
  STATUS: 1,
  SHOW_QR: 2,
  RESCAN: 3,
  SEPARATOR: 4,
  QUIT: 5,
});

const STATE_LABEL = {
  waiting: "等待手机扫码",
  linking: "正在连接…",
  connected: "已连接手机",
  offline: "等待守护进程",
};

class StatusNotifierItem extends Interface {
  constructor(tray) {
    super("org.kde.StatusNotifierItem");
    this._tray = tray;
  }

  get Category() {
    return "ApplicationStatus";
  }

  get Id() {
    return "flyme-link";
  }

  get Title() {
    return "Flyme 互联";
  }

  get Status() {
    return "Active";
  }

  get WindowId() {
    return 0;
  }

  get IconName() {
    return this._tray.iconName;
  }

  get IconPixmap() {
    return [];
  }

  get OverlayIconName() {
    return "";
  }

  get OverlayIconPixmap() {
    return [];
  }

  get AttentionIconName() {
    return "";
  }

  get AttentionIconPixmap() {
    return [];
  }

  get AttentionMovieName() {
    return "";
  }

  get ToolTip() {
    return [this._tray.iconName, [], "Flyme 互联", this._tray.stateLabel];
  }

  get ItemIsMenu() {
    return false;
  }

  get Menu() {
    return MENU_PATH;
  }

  Activate(_x, _y) {
    this._tray.handlers.onShowQr?.();
    return undefined;
  }

  SecondaryActivate(_x, _y) {
    this._tray.handlers.onShowQr?.();
    return undefined;
  }

  ContextMenu(_x, _y) {
    return undefined;
  }

  Scroll(_delta, _orientation) {
    return undefined;
  }

  NewTitle() {
    return undefined;
  }

  NewIcon() {
    return undefined;
  }

  NewAttentionIcon() {
    return undefined;
  }

  NewOverlayIcon() {
    return undefined;
  }

  NewToolTip() {
    return undefined;
  }

  NewStatus(status) {
    return status;
  }
}

StatusNotifierItem.configureMembers({
  properties: {
    Category: { signature: "s", access: ACCESS_READ },
    Id: { signature: "s", access: ACCESS_READ },
    Title: { signature: "s", access: ACCESS_READ },
    Status: { signature: "s", access: ACCESS_READ },
    WindowId: { signature: "i", access: ACCESS_READ },
    IconName: { signature: "s", access: ACCESS_READ },
    IconPixmap: { signature: "a(iiay)", access: ACCESS_READ },
    OverlayIconName: { signature: "s", access: ACCESS_READ },
    OverlayIconPixmap: { signature: "a(iiay)", access: ACCESS_READ },
    AttentionIconName: { signature: "s", access: ACCESS_READ },
    AttentionIconPixmap: { signature: "a(iiay)", access: ACCESS_READ },
    AttentionMovieName: { signature: "s", access: ACCESS_READ },
    ToolTip: { signature: "(sa(iiay)ss)", access: ACCESS_READ },
    ItemIsMenu: { signature: "b", access: ACCESS_READ },
    Menu: { signature: "o", access: ACCESS_READ },
  },
  methods: {
    Activate: { inSignature: "ii", outSignature: "" },
    SecondaryActivate: { inSignature: "ii", outSignature: "" },
    ContextMenu: { inSignature: "ii", outSignature: "" },
    Scroll: { inSignature: "is", outSignature: "" },
  },
  signals: {
    NewTitle: { signature: "" },
    NewIcon: { signature: "" },
    NewAttentionIcon: { signature: "" },
    NewOverlayIcon: { signature: "" },
    NewToolTip: { signature: "" },
    NewStatus: { signature: "s" },
  },
});

/**
 * Cross-desktop tray icon via StatusNotifierItem (KDE Plasma native, GNOME
 * with the AppIndicator extension, XFCE/Sway with a SNI host).
 *
 * @param {object} options
 * @param {object} options.logger
 * @param {{onShowQr?: Function, onRescan?: Function, onQuit?: Function}} options.handlers
 * @param {string} [options.iconName]
 * @param {typeof dbus.sessionBus} [options.sessionBus]
 */
async function createTray(options) {
  const {
    logger,
    handlers = {},
    iconName = "flyme-link-symbolic",
    sessionBus = dbus.sessionBus,
  } = options;

  const bus = sessionBus();
  let watcher = null;
  try {
    const proxy = await bus.getProxyObject(WATCHER_NAME, WATCHER_PATH);
    watcher = proxy.getInterface(WATCHER_NAME);
  } catch {
    logger.vlog("tray: no StatusNotifierWatcher on the session bus");
    bus.disconnect();
    return null;
  }

  const tray = {
    iconName,
    state: "offline",
    detail: "",
    handlers,
    get stateLabel() {
      return STATE_LABEL[this.state] || this.detail || this.state;
    },
  };

  const menuLayout = () => [
    MENU_ID.ROOT,
    { "children-display": v("s", "submenu") },
    [
      [
        MENU_ID.STATUS,
        {
          label: v("s", tray.stateLabel),
          enabled: v("b", false),
          visible: v("b", true),
        },
        [],
      ],
      [
        MENU_ID.SHOW_QR,
        {
          label: v("s", "显示二维码 / 状态"),
          enabled: v("b", true),
          visible: v("b", true),
        },
        [],
      ],
      [
        MENU_ID.RESCAN,
        {
          label: v("s", "重新生成二维码"),
          enabled: v("b", true),
          visible: v("b", true),
        },
        [],
      ],
      [MENU_ID.SEPARATOR, { type: v("s", "separator"), visible: v("b", true) }, []],
      [
        MENU_ID.QUIT,
        {
          label: v("s", "退出"),
          enabled: v("b", true),
          visible: v("b", true),
        },
        [],
      ],
    ],
  ];

  const menu = new DbusMenu({
    getRootLayout: menuLayout,
    onEvent: (id, eventId) => {
      if (eventId !== "clicked") return;
      if (id === MENU_ID.SHOW_QR) handlers.onShowQr?.();
      else if (id === MENU_ID.RESCAN) handlers.onRescan?.();
      else if (id === MENU_ID.QUIT) handlers.onQuit?.();
    },
  });

  const item = new StatusNotifierItem(tray);

  try {
    bus.export(ITEM_PATH, item);
    bus.export(MENU_PATH, menu);
    await watcher.RegisterStatusNotifierItem(ITEM_PATH);
  } catch (err) {
    logger.warn(`tray: registration failed: ${err.message}`);
    try {
      bus.unexport(ITEM_PATH);
      bus.unexport(MENU_PATH);
    } catch {
      // ignore
    }
    bus.disconnect();
    return null;
  }

  logger.log("tray icon registered via StatusNotifierItem");

  return {
    update(state, detail = "") {
      const changed = tray.state !== state;
      tray.state = state;
      tray.detail = detail;
      menu.touch();
      if (changed) item.NewStatus("Active");
      item.NewToolTip();
    },
    stop() {
      try {
        bus.unexport(ITEM_PATH);
        bus.unexport(MENU_PATH);
      } catch {
        // ignore
      }
      bus.disconnect();
    },
  };
}

module.exports = { createTray, MENU_ID, STATE_LABEL };
