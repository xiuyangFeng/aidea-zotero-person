/**
 * Hotkey preferences — which binding each global shortcut is set to.
 *
 * Split out of `globalHotkeys.ts` so the panel can show the configured
 * shortcuts (the empty-conversation guide does) without importing the
 * keyboard wiring and everything it reaches. Parsing and display live in
 * `src/utils/hotkeys.ts`.
 */

import { describeHotkey, parseHotkey } from "../../utils/hotkeys";
import { getStringPref } from "./prefHelpers";

export type HotkeyAction =
  "focusComposer" | "askSelection" | "translateSelection";

export const HOTKEY_PREF_KEYS: Record<HotkeyAction, string> = {
  focusComposer: "hotkeys.focusComposer",
  askSelection: "hotkeys.askSelection",
  translateSelection: "hotkeys.translateSelection",
};

/**
 * Defaults, chosen against Zotero 7's own bindings.
 *
 * Zotero reserves accel+shift with L (Libraries), K (Quick Search), N, O, A, C,
 * S, Y (Sync), R, I (Import), F (Advanced Search), G (Find Previous) and T
 * (Undo Close Tab); the reader additionally swallows accel+shift+G and +Z.
 * M, E and D are free in the library pane, in a reader tab and at the OS level
 * on all three platforms.
 */
export const HOTKEY_DEFAULTS: Record<HotkeyAction, string> = {
  focusComposer: "accel+shift+m",
  askSelection: "accel+shift+e",
  translateSelection: "accel+shift+d",
};

/** The binding string in force right now, falling back to the default. */
export function getHotkeyBindingText(action: HotkeyAction): string {
  try {
    const stored = getStringPref(HOTKEY_PREF_KEYS[action]).trim();
    return stored || HOTKEY_DEFAULTS[action];
  } catch {
    return HOTKEY_DEFAULTS[action];
  }
}

export function isMacPlatform(): boolean {
  try {
    return Boolean((Zotero as unknown as { isMac?: boolean }).isMac);
  } catch {
    return false;
  }
}

/** The configured binding, formatted for the running platform (`⌘⇧M`). */
export function describeConfiguredHotkey(action: HotkeyAction): string {
  return describeHotkey(parseHotkey(getHotkeyBindingText(action)), {
    isMac: isMacPlatform(),
  });
}
