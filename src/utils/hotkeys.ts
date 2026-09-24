/**
 * Hotkeys — parsing and matching for the plugin's global keyboard shortcuts.
 *
 * A binding is written the way Firefox writes one: modifiers joined to a key
 * by `+`, e.g. `accel+shift+l`. `accel` is the platform's primary modifier —
 * ⌘ on macOS, Ctrl everywhere else — so a single stored string means the same
 * gesture on every platform.
 *
 * Everything here is pure: no Zotero, no DOM. The caller supplies the platform
 * flag and a plain object shaped like a KeyboardEvent, which keeps the whole
 * module unit-testable and lets settings changes take effect on the next
 * keypress without any re-registration.
 */

export type HotkeyBinding = {
  /** ⌘ on macOS, Ctrl elsewhere. */
  accel: boolean;
  /** Literal Ctrl, independent of `accel`. */
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** Normalized key name: `a`-`z`, `0`-`9`, `space`, `enter`, `f1`-`f12`. */
  key: string;
};

/** The subset of `KeyboardEvent` a match needs. */
export type HotkeyEventLike = {
  key?: string | null;
  code?: string | null;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

export type HotkeyPlatformOptions = {
  /** Whether `accel` should mean ⌘ rather than Ctrl. */
  isMac?: boolean;
};

type HotkeyModifierName = "accel" | "ctrl" | "shift" | "alt";

const MODIFIER_ALIASES: Record<string, HotkeyModifierName> = {
  accel: "accel",
  ctrl: "ctrl",
  control: "ctrl",
  shift: "shift",
  alt: "alt",
  option: "alt",
};

const KEY_ALIASES: Record<string, string> = {
  " ": "space",
  space: "space",
  spacebar: "space",
  enter: "enter",
  return: "enter",
};

const FUNCTION_KEY_PATTERN = /^f([1-9]|1[0-2])$/;

function isSupportedKeyName(value: string): boolean {
  if (value.length === 1) {
    return /^[a-z0-9]$/.test(value);
  }
  if (value === "space" || value === "enter") return true;
  return FUNCTION_KEY_PATTERN.test(value);
}

/**
 * Canonical name for a key, from either a binding string or `KeyboardEvent.key`.
 *
 * Returns an empty string for anything outside the supported set, so an
 * unusable key never silently becomes a binding that can't be pressed.
 */
export function normalizeHotkeyKey(value: string | null | undefined): string {
  const raw = String(value ?? "");
  const lowered =
    raw.length === 1 ? raw.toLowerCase() : raw.trim().toLowerCase();
  const aliased = KEY_ALIASES[lowered] ?? lowered;
  return isSupportedKeyName(aliased) ? aliased : "";
}

/**
 * Canonical key name for a physical `KeyboardEvent.code`.
 *
 * macOS rewrites `event.key` when Alt is held (Alt+L yields `¬`), and a
 * non-Latin layout rewrites it always, so the physical code is the only
 * reliable identity for a letter or digit binding.
 */
export function normalizeHotkeyCode(value: string | null | undefined): string {
  const code = String(value ?? "").trim();
  if (!code) return "";
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return digit[1];
  if (code === "Space") return "space";
  if (code === "Enter" || code === "NumpadEnter") return "enter";
  if (FUNCTION_KEY_PATTERN.test(code.toLowerCase())) return code.toLowerCase();
  return "";
}

/**
 * Parse a binding string such as `accel+shift+l`.
 *
 * Returns `null` for anything malformed — an unknown token, no key, or more
 * than one key — so a typo in the settings field disables that one hotkey
 * instead of binding something unexpected.
 */
export function parseHotkey(
  raw: string | null | undefined,
): HotkeyBinding | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const binding: HotkeyBinding = {
    accel: false,
    ctrl: false,
    shift: false,
    alt: false,
    key: "",
  };
  const tokens = text
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return null;
  for (const token of tokens) {
    const lowered = token.toLowerCase();
    const modifier = MODIFIER_ALIASES[lowered];
    if (modifier) {
      binding[modifier] = true;
      continue;
    }
    const key = normalizeHotkeyKey(token);
    if (!key) return null;
    // Two keys in one binding is a typo, not a chord this plugin supports.
    if (binding.key) return null;
    binding.key = key;
  }
  if (!binding.key) return null;
  return binding;
}

/** Modifier state a binding requires on this platform. */
function resolveRequiredModifiers(
  binding: HotkeyBinding,
  options?: HotkeyPlatformOptions,
): { ctrl: boolean; meta: boolean; shift: boolean; alt: boolean } {
  const isMac = options?.isMac === true;
  return {
    ctrl: binding.ctrl || (binding.accel && !isMac),
    meta: binding.accel && isMac,
    shift: binding.shift,
    alt: binding.alt,
  };
}

/**
 * Whether an event is exactly this binding.
 *
 * The modifier comparison is exact in both directions: Ctrl+⌘+Shift+L must not
 * fire a ⌘+Shift+L binding, or a shortcut would go off while the user is
 * reaching for a different one.
 */
export function matchesHotkey(
  binding: HotkeyBinding | null | undefined,
  event: HotkeyEventLike | null | undefined,
  options?: HotkeyPlatformOptions,
): boolean {
  if (!binding || !event) return false;
  const required = resolveRequiredModifiers(binding, options);
  if (Boolean(event.ctrlKey) !== required.ctrl) return false;
  if (Boolean(event.metaKey) !== required.meta) return false;
  if (Boolean(event.shiftKey) !== required.shift) return false;
  if (Boolean(event.altKey) !== required.alt) return false;
  const fromKey = normalizeHotkeyKey(event.key);
  if (fromKey && fromKey === binding.key) return true;
  const fromCode = normalizeHotkeyCode(event.code);
  return Boolean(fromCode) && fromCode === binding.key;
}

/** Parse and match in one step, for callers that read the pref every keypress. */
export function eventMatchesHotkey(
  raw: string | null | undefined,
  event: HotkeyEventLike | null | undefined,
  options?: HotkeyPlatformOptions,
): boolean {
  return matchesHotkey(parseHotkey(raw), event, options);
}

/** Canonical `accel+shift+l` form, for storing a normalized binding back. */
export function formatHotkey(
  binding: HotkeyBinding | null | undefined,
): string {
  if (!binding?.key) return "";
  const parts: string[] = [];
  if (binding.accel) parts.push("accel");
  if (binding.ctrl) parts.push("ctrl");
  if (binding.alt) parts.push("alt");
  if (binding.shift) parts.push("shift");
  parts.push(binding.key);
  return parts.join("+");
}

/** Human-readable form for tooltips and status lines. */
export function describeHotkey(
  binding: HotkeyBinding | null | undefined,
  options?: HotkeyPlatformOptions,
): string {
  if (!binding?.key) return "";
  const isMac = options?.isMac === true;
  const parts: string[] = [];
  if (binding.accel) parts.push(isMac ? "⌘" : "Ctrl");
  if (binding.ctrl) parts.push(isMac ? "⌃" : "Ctrl");
  if (binding.alt) parts.push(isMac ? "⌥" : "Alt");
  if (binding.shift) parts.push(isMac ? "⇧" : "Shift");
  const key =
    binding.key === "space"
      ? "Space"
      : binding.key === "enter"
        ? "Enter"
        : binding.key.toUpperCase();
  parts.push(key);
  return isMac ? parts.join("") : parts.join("+");
}
