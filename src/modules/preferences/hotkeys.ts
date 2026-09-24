/**
 * Hotkey preference helpers for the settings page.
 *
 * The `hotkeys.*` prefs store Firefox-style accelerator strings such as
 * `accel+shift+l`: one or more modifiers joined by `+`, followed by a single
 * key name. `accel` resolves to ⌘ on macOS and Ctrl everywhere else.
 *
 * Parsing is delegated to the matcher in `src/utils/hotkeys.ts`, so the field
 * never accepts a binding that could not actually fire. The settings field is
 * only stricter in shape — it wants at least one modifier and the key last —
 * because a bare key or `l+shift` is far more likely a typo than an intent.
 * Everything here is pure, so the settings page and the unit tests share the
 * same rules.
 */

import {
  normalizeHotkeyKey as normalizeMatcherKey,
  parseHotkey,
} from "../../utils/hotkeys";

export type HotkeyModifier = "accel" | "ctrl" | "alt" | "shift";

export interface ParsedHotkey {
  modifiers: HotkeyModifier[];
  key: string;
}

/** Canonical output order, so `shift+accel+l` and `accel+shift+l` compare equal. */
const MODIFIER_ORDER: HotkeyModifier[] = ["accel", "ctrl", "alt", "shift"];

/** Canonical key name, or `""` when the key cannot be bound. */
export function normalizeHotkeyKey(key: string): string {
  return normalizeMatcherKey(key);
}

/** True when `key` is a key name this plugin is willing to bind. */
export function isSupportedHotkeyKey(key: string): boolean {
  return normalizeHotkeyKey(key) !== "";
}

/**
 * Parse an accelerator string. Returns `null` when the string is empty or does
 * not carry at least one modifier plus exactly one bindable key, written last.
 */
export function parseHotkeyString(value: string): ParsedHotkey | null {
  const parts = String(value ?? "")
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  // A modifier after the key ("l+shift") is a typo, not a binding: the key
  // must be the last token, and every earlier token a modifier.
  const binding = parseHotkey(parts.join("+"));
  if (!binding) return null;
  const lastKey = normalizeHotkeyKey(parts[parts.length - 1]);
  if (!lastKey || lastKey !== binding.key) return null;
  const modifiers = MODIFIER_ORDER.filter((modifier) => binding[modifier]);
  if (!modifiers.length) return null;
  return { modifiers, key: binding.key };
}

/** Light validation used by the settings field: modifier(s) + one key. */
export function isValidHotkeyString(value: string): boolean {
  return parseHotkeyString(value) !== null;
}

/** Canonical spelling of an accelerator, or `""` when it cannot be parsed. */
export function normalizeHotkeyString(value: string): string {
  const parsed = parseHotkeyString(value);
  if (!parsed) return "";
  return [...parsed.modifiers, parsed.key].join("+");
}

/** What `accel` means on the running platform. */
export function getAccelLabel(platform: string): string {
  return /mac|darwin|iphone|ipad/i.test(String(platform ?? "")) ? "⌘" : "Ctrl";
}

const MODIFIER_LABELS: Record<Exclude<HotkeyModifier, "accel">, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
};

/** Human-readable rendering, e.g. `accel+shift+l` → `⌘+Shift+L`. */
export function formatHotkeyForDisplay(
  value: string,
  accelLabel: string,
): string {
  const parsed = parseHotkeyString(value);
  if (!parsed) return "";
  const parts = parsed.modifiers.map((modifier) =>
    modifier === "accel" ? accelLabel : MODIFIER_LABELS[modifier],
  );
  parts.push(parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
  return parts.join("+");
}
