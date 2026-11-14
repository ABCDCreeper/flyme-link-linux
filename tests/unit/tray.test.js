"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const dbus = require("dbus-next");

const { DbusMenu } = require("../../src/tray/dbusmenu.js");

test("dbusmenu GetLayout wraps children in variants", () => {
  const menu = new DbusMenu({
    getRootLayout: () => [
      0,
      { "children-display": new dbus.Variant("s", "submenu") },
      [[1, { label: new dbus.Variant("s", "状态") }, []]],
    ],
    onEvent: () => {},
  });
  const [revision, layout] = menu.GetLayout(0, -1, []);
  assert.equal(revision, 1);
  const [id, props, children] = layout;
  assert.equal(id, 0);
  assert.ok(props["children-display"] instanceof dbus.Variant);
  assert.equal(children.length, 1);
  assert.ok(children[0] instanceof dbus.Variant);
  assert.equal(children[0].value[0], 1);
});

test("dbusmenu dispatches clicked events and bumps revision", () => {
  const events = [];
  const menu = new DbusMenu({
    getRootLayout: () => [0, {}, []],
    onEvent: (id, eventId) => events.push([id, eventId]),
  });
  menu.Event(3, "clicked", new dbus.Variant("s", ""), 0);
  assert.deepEqual(events, [[3, "clicked"]]);
  menu.touch();
  assert.equal(menu.GetLayout(0, -1, [])[0], 2);
});
