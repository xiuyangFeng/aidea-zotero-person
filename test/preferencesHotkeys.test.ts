import { expect } from "chai";
import {
  formatHotkeyForDisplay,
  getAccelLabel,
  isSupportedHotkeyKey,
  isValidHotkeyString,
  normalizeHotkeyString,
  parseHotkeyString,
} from "../src/modules/preferences/hotkeys";

describe("settings hotkey strings", function () {
  it("parses the packaged defaults", function () {
    expect(parseHotkeyString("accel+shift+l")).to.deep.equal({
      modifiers: ["accel", "shift"],
      key: "l",
    });
    expect(parseHotkeyString("accel+shift+e")).to.deep.equal({
      modifiers: ["accel", "shift"],
      key: "e",
    });
    expect(parseHotkeyString("accel+shift+y")).to.deep.equal({
      modifiers: ["accel", "shift"],
      key: "y",
    });
  });

  it("accepts modifier aliases and normalizes their order", function () {
    expect(normalizeHotkeyString("Control+Option+f5")).to.equal("ctrl+alt+f5");
    expect(normalizeHotkeyString("shift+accel+l")).to.equal("accel+shift+l");
    expect(normalizeHotkeyString("ACCEL + Shift + Return")).to.equal(
      "accel+shift+enter",
    );
    expect(normalizeHotkeyString("accel+spacebar")).to.equal("accel+space");
  });

  it("rejects modifiers the hotkey matcher does not understand", function () {
    // src/utils/hotkeys.ts knows accel/ctrl/alt/shift only — never meta/cmd.
    expect(isValidHotkeyString("cmd+shift+k")).to.equal(false);
    expect(isValidHotkeyString("meta+k")).to.equal(false);
  });

  it("rejects strings without a modifier or without exactly one key", function () {
    expect(isValidHotkeyString("")).to.equal(false);
    expect(isValidHotkeyString("l")).to.equal(false);
    expect(isValidHotkeyString("accel")).to.equal(false);
    expect(isValidHotkeyString("accel+shift")).to.equal(false);
    expect(isValidHotkeyString("accel+l+k")).to.equal(false);
    expect(isValidHotkeyString("l+shift")).to.equal(false);
    expect(normalizeHotkeyString("accel+")).to.equal("");
  });

  it("rejects key names it does not know", function () {
    expect(isValidHotkeyString("accel+shift+notakey")).to.equal(false);
    expect(isValidHotkeyString("accel+f13")).to.equal(false);
    expect(isValidHotkeyString("accel+pageup")).to.equal(false);
    expect(isSupportedHotkeyKey("f12")).to.equal(true);
    expect(isSupportedHotkeyKey("7")).to.equal(true);
    expect(isSupportedHotkeyKey("space")).to.equal(true);
    expect(isSupportedHotkeyKey("")).to.equal(false);
  });

  it("resolves accel per platform", function () {
    expect(getAccelLabel("MacIntel")).to.equal("⌘");
    expect(getAccelLabel("darwin")).to.equal("⌘");
    expect(getAccelLabel("Win32")).to.equal("Ctrl");
    expect(getAccelLabel("Linux x86_64")).to.equal("Ctrl");
    expect(getAccelLabel("")).to.equal("Ctrl");
  });

  it("renders a readable label", function () {
    expect(formatHotkeyForDisplay("accel+shift+l", "⌘")).to.equal("⌘+Shift+L");
    expect(formatHotkeyForDisplay("accel+shift+l", "Ctrl")).to.equal(
      "Ctrl+Shift+L",
    );
    expect(formatHotkeyForDisplay("ctrl+alt+space", "Ctrl")).to.equal(
      "Ctrl+Alt+space",
    );
    expect(formatHotkeyForDisplay("nonsense", "Ctrl")).to.equal("");
  });
});
