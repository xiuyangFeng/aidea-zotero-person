import { expect } from "chai";

import {
  describeHotkey,
  eventMatchesHotkey,
  formatHotkey,
  matchesHotkey,
  normalizeHotkeyCode,
  normalizeHotkeyKey,
  parseHotkey,
  type HotkeyEventLike,
} from "../src/utils/hotkeys";

const MAC = { isMac: true };
const PC = { isMac: false };

function keyEvent(overrides: Partial<HotkeyEventLike>): HotkeyEventLike {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("hotkeys", function () {
  describe("parsing", function () {
    it("parses modifiers and a key", function () {
      expect(parseHotkey("accel+shift+l")).to.deep.equal({
        accel: true,
        ctrl: false,
        shift: true,
        alt: false,
        key: "l",
      });
    });

    it("is case- and whitespace-insensitive", function () {
      expect(parseHotkey("  Accel + Shift + M ")).to.deep.equal({
        accel: true,
        ctrl: false,
        shift: true,
        alt: false,
        key: "m",
      });
    });

    it("accepts ctrl, alt and their aliases", function () {
      expect(parseHotkey("control+option+9")).to.deep.equal({
        accel: false,
        ctrl: true,
        shift: false,
        alt: true,
        key: "9",
      });
    });

    it("accepts space, enter and function keys", function () {
      expect(parseHotkey("accel+space")?.key).to.equal("space");
      expect(parseHotkey("accel+Return")?.key).to.equal("enter");
      expect(parseHotkey("f12")?.key).to.equal("f12");
    });

    it("rejects empty, keyless, unknown and multi-key bindings", function () {
      expect(parseHotkey("")).to.equal(null);
      expect(parseHotkey(null)).to.equal(null);
      expect(parseHotkey("accel+shift")).to.equal(null);
      expect(parseHotkey("accel+shift+tab")).to.equal(null);
      expect(parseHotkey("accel+f13")).to.equal(null);
      expect(parseHotkey("accel+a+b")).to.equal(null);
    });

    it("round-trips through formatHotkey in a canonical order", function () {
      expect(formatHotkey(parseHotkey("shift+accel+l"))).to.equal(
        "accel+shift+l",
      );
      expect(formatHotkey(null)).to.equal("");
    });
  });

  describe("key normalization", function () {
    it("normalizes key names", function () {
      expect(normalizeHotkeyKey("L")).to.equal("l");
      expect(normalizeHotkeyKey(" ")).to.equal("space");
      expect(normalizeHotkeyKey("Enter")).to.equal("enter");
      expect(normalizeHotkeyKey("F5")).to.equal("f5");
      expect(normalizeHotkeyKey("Tab")).to.equal("");
    });

    it("normalizes physical codes", function () {
      expect(normalizeHotkeyCode("KeyE")).to.equal("e");
      expect(normalizeHotkeyCode("Digit4")).to.equal("4");
      expect(normalizeHotkeyCode("Numpad4")).to.equal("4");
      expect(normalizeHotkeyCode("Space")).to.equal("space");
      expect(normalizeHotkeyCode("NumpadEnter")).to.equal("enter");
      expect(normalizeHotkeyCode("F7")).to.equal("f7");
      expect(normalizeHotkeyCode("BracketLeft")).to.equal("");
    });
  });

  describe("matching", function () {
    it("maps accel to Cmd on macOS and Ctrl elsewhere", function () {
      const binding = parseHotkey("accel+shift+m");
      const macPress = keyEvent({ key: "M", metaKey: true, shiftKey: true });
      const pcPress = keyEvent({ key: "M", ctrlKey: true, shiftKey: true });

      expect(matchesHotkey(binding, macPress, MAC)).to.equal(true);
      expect(matchesHotkey(binding, macPress, PC)).to.equal(false);
      expect(matchesHotkey(binding, pcPress, PC)).to.equal(true);
      expect(matchesHotkey(binding, pcPress, MAC)).to.equal(false);
    });

    it("requires an exact modifier set", function () {
      const binding = parseHotkey("accel+shift+e");
      expect(
        matchesHotkey(
          binding,
          keyEvent({ key: "e", metaKey: true, shiftKey: true }),
          MAC,
        ),
      ).to.equal(true);
      // An extra modifier belongs to a different shortcut.
      expect(
        matchesHotkey(
          binding,
          keyEvent({ key: "e", metaKey: true, shiftKey: true, altKey: true }),
          MAC,
        ),
      ).to.equal(false);
      expect(
        matchesHotkey(
          binding,
          keyEvent({ key: "e", metaKey: true, shiftKey: true, ctrlKey: true }),
          MAC,
        ),
      ).to.equal(false);
      // A missing modifier does too.
      expect(
        matchesHotkey(binding, keyEvent({ key: "e", metaKey: true }), MAC),
      ).to.equal(false);
    });

    it("falls back to the physical code when the layout rewrote the key", function () {
      const binding = parseHotkey("accel+alt+d");
      // macOS turns Option+D into a dead key; only the code still says "KeyD".
      const press = keyEvent({
        key: "∂",
        code: "KeyD",
        metaKey: true,
        altKey: true,
      });
      expect(matchesHotkey(binding, press, MAC)).to.equal(true);
    });

    it("does not match an unrelated key", function () {
      const binding = parseHotkey("accel+shift+d");
      expect(
        matchesHotkey(
          binding,
          keyEvent({ key: "g", code: "KeyG", metaKey: true, shiftKey: true }),
          MAC,
        ),
      ).to.equal(false);
    });

    it("treats a missing binding or event as no match", function () {
      expect(matchesHotkey(null, keyEvent({ key: "a" }), MAC)).to.equal(false);
      expect(matchesHotkey(parseHotkey("accel+a"), null, MAC)).to.equal(false);
    });

    it("parses and matches in one step, ignoring malformed bindings", function () {
      const press = keyEvent({ key: "m", ctrlKey: true, shiftKey: true });
      expect(eventMatchesHotkey("accel+shift+m", press, PC)).to.equal(true);
      expect(eventMatchesHotkey("accel+shift+", press, PC)).to.equal(false);
      expect(eventMatchesHotkey("", press, PC)).to.equal(false);
    });
  });

  describe("description", function () {
    it("uses platform symbols", function () {
      expect(describeHotkey(parseHotkey("accel+shift+m"), MAC)).to.equal("⌘⇧M");
      expect(describeHotkey(parseHotkey("accel+shift+m"), PC)).to.equal(
        "Ctrl+Shift+M",
      );
      expect(describeHotkey(parseHotkey("accel+space"), PC)).to.equal(
        "Ctrl+Space",
      );
      expect(describeHotkey(null, PC)).to.equal("");
    });
  });
});
