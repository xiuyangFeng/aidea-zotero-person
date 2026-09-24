/**
 * Global hotkeys.
 *
 * Three configurable shortcuts plus Escape-to-cancel, live in the library pane
 * and inside a reader tab alike.
 *
 * Bindings are read from preferences on every keypress rather than compiled at
 * registration time, so editing a shortcut in Settings takes effect on the next
 * key without re-registering anything. Parsing and matching live in
 * `src/utils/hotkeys.ts`, which is pure and unit-tested; this module only wires
 * the result to the panel.
 *
 * Registration goes through the toolkit's KeyboardManager because it is the
 * only thing that reaches inside the reader's content browser: the reader runs
 * in a non-remote `<browser type="content">` whose keydown events never bubble
 * into the chrome document, so a plain window listener would leave every one of
 * these shortcuts dead while reading.
 */

import { eventMatchesHotkey } from "../../utils/hotkeys";
import {
  getActiveContextAttachmentFromTabs,
  getActiveReaderDocumentAttachmentFromTabs,
  getActiveReaderSelectionText,
} from "./contextResolution";
import { getPanelI18n } from "./i18n";
import {
  getHotkeyBindingText,
  isMacPlatform,
  type HotkeyAction,
} from "./hotkeyPrefs";
import {
  dispatchReadingAction,
  focusReadingPanelComposer,
  resolveReadingPanel,
  revealReadingPanel,
} from "./readingActions";
import { runActiveSelectionPopupTranslate } from "./selectionPopupTranslate";
import { isPanelGenerating } from "./state";
import { setStatus } from "./textUtils";

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export {
  HOTKEY_DEFAULTS,
  HOTKEY_PREF_KEYS,
  getHotkeyBindingText,
  type HotkeyAction,
} from "./hotkeyPrefs";

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

function resolveEventDocument(event: KeyboardEvent): Document | null {
  try {
    const target = event.target as
      (Node & { ownerDocument?: Document | null }) | null;
    const fromTarget = target?.ownerDocument || null;
    if (fromTarget) return fromTarget;
    const view = (event as unknown as { view?: Window | null }).view || null;
    if (view?.document) return view.document;
  } catch (_err) {
    void _err;
  }
  try {
    return Zotero.getMainWindow()?.document || null;
  } catch {
    return null;
  }
}

/** The reader attachment the shortcut should act on, if a reader tab is open. */
function resolveActiveReaderItem(): Zotero.Item | null {
  try {
    return (
      getActiveReaderDocumentAttachmentFromTabs() ||
      getActiveContextAttachmentFromTabs()
    );
  } catch (err) {
    ztoolkit.log("LLM: hotkey reader item resolution failed", err);
    return null;
  }
}

function resolveSelection(doc: Document | null, item: Zotero.Item | null) {
  try {
    const panelDoc =
      doc || (Zotero.getMainWindow()?.document as Document | undefined) || null;
    if (!panelDoc) return "";
    return getActiveReaderSelectionText(panelDoc, item);
  } catch (err) {
    ztoolkit.log("LLM: hotkey selection lookup failed", err);
    return "";
  }
}

/** Put a message on the panel's status line, when a panel can be found. */
async function reportOnPanel(
  doc: Document | null,
  item: Zotero.Item | null,
  message: string,
): Promise<void> {
  try {
    const panel = await resolveReadingPanel({ doc, item });
    if (!panel?.status) return;
    setStatus(panel.status, message, "warning");
    revealReadingPanel(panel.panelBody);
  } catch (err) {
    ztoolkit.log("LLM: hotkey status report failed", err);
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function runFocusComposer(
  doc: Document | null,
  item: Zotero.Item | null,
): Promise<void> {
  const focused = await focusReadingPanelComposer({ doc, item });
  if (!focused) {
    ztoolkit.log("LLM: focus composer hotkey found no AIdea panel");
  }
}

async function runAskSelection(
  doc: Document | null,
  item: Zotero.Item | null,
): Promise<void> {
  const selection = resolveSelection(doc, item);
  // Nothing selected is not a failure: the shortcut then means "take me to the
  // composer", which is what the user would have reached for next anyway.
  if (!selection) {
    await runFocusComposer(doc, item);
    return;
  }
  const result = await dispatchReadingAction({
    kind: "explain",
    selectedText: selection,
    readerItem: item,
    doc,
  });
  if (result.outcome === "no-panel") {
    ztoolkit.log("LLM: ask-selection hotkey found no AIdea panel");
  }
}

async function runTranslateSelection(
  doc: Document | null,
  item: Zotero.Item | null,
): Promise<void> {
  // A popup on screen already owns the translation UI; streaming into it keeps
  // the answer beside the passage instead of pushing it into the conversation.
  if (runActiveSelectionPopupTranslate()) return;
  const selection = resolveSelection(doc, item);
  if (!selection) {
    await reportOnPanel(doc, item, getPanelI18n().readingActionNoSelection);
    return;
  }
  const result = await dispatchReadingAction({
    kind: "translate",
    selectedText: selection,
    readerItem: item,
    doc,
  });
  if (result.outcome === "no-panel") {
    ztoolkit.log("LLM: translate-selection hotkey found no AIdea panel");
  }
}

/**
 * Escape cancels a reply, but only the one the user is looking at.
 *
 * Scoped to focus inside the panel and to a request actually in flight, so
 * Escape keeps its usual meaning everywhere else — including inside the panel
 * whenever nothing is streaming.
 */
function handleEscapeCancel(event: KeyboardEvent): boolean {
  const doc = resolveEventDocument(event);
  const active = doc?.activeElement as HTMLElement | null;
  const panelRoot = active?.closest?.("#llm-main") as HTMLElement | null;
  if (!panelRoot) return false;
  const panelBody = (panelRoot.parentElement || panelRoot) as HTMLElement;
  if (!isPanelGenerating(panelBody)) return false;
  const cancelBtn = panelBody.querySelector(
    "#llm-cancel",
  ) as HTMLButtonElement | null;
  if (!cancelBtn || cancelBtn.disabled) return false;
  cancelBtn.click();
  return true;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function consume(event: KeyboardEvent): void {
  try {
    event.preventDefault();
    event.stopPropagation();
  } catch (_err) {
    void _err;
  }
}

function handleHotkeyKeydown(event: KeyboardEvent): void {
  if (
    event.key === "Escape" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    if (handleEscapeCancel(event)) consume(event);
    return;
  }

  const platform = { isMac: isMacPlatform() };
  const actions: HotkeyAction[] = [
    "askSelection",
    "translateSelection",
    "focusComposer",
  ];
  const matched = actions.find((action) =>
    eventMatchesHotkey(getHotkeyBindingText(action), event, platform),
  );
  if (!matched) return;

  consume(event);
  const doc = resolveEventDocument(event);
  const item = resolveActiveReaderItem();
  const run =
    matched === "askSelection"
      ? runAskSelection
      : matched === "translateSelection"
        ? runTranslateSelection
        : runFocusComposer;
  void run(doc, item).catch((err) => {
    ztoolkit.log(`LLM: hotkey "${matched}" failed`, err);
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

type KeyboardManagerCallback = (
  event: KeyboardEvent,
  options: { type: "keydown" | "keyup" },
) => void;

type HotkeyRegistration = {
  toolkit: ZToolkit;
  callback: KeyboardManagerCallback;
};

const registrations = new Map<Window, HotkeyRegistration>();
/**
 * Every window's toolkit listens on every window and every reader, so with two
 * main windows open one keypress reaches this module twice. The event object is
 * the same one both times, which makes it the cheapest possible latch.
 */
const handledEvents = new WeakSet<Event>();

export function registerGlobalHotkeys(win: Window, toolkit: ZToolkit): void {
  unregisterGlobalHotkeys(win);
  const callback: KeyboardManagerCallback = (event, options) => {
    if (options?.type !== "keydown") return;
    if (handledEvents.has(event)) return;
    handledEvents.add(event);
    try {
      handleHotkeyKeydown(event);
    } catch (err) {
      ztoolkit.log("LLM: hotkey dispatch failed", err);
    }
  };
  try {
    toolkit.Keyboard.register(callback);
    registrations.set(win, { toolkit, callback });
  } catch (err) {
    ztoolkit.log("LLM: failed to register global hotkeys", err);
  }
}

export function unregisterGlobalHotkeys(win: Window): void {
  const registration = registrations.get(win);
  if (!registration) return;
  registrations.delete(win);
  try {
    registration.toolkit.Keyboard.unregister(registration.callback);
  } catch (err) {
    ztoolkit.log("LLM: failed to unregister global hotkeys", err);
  }
}

export function shutdownGlobalHotkeys(): void {
  for (const win of Array.from(registrations.keys())) {
    unregisterGlobalHotkeys(win);
  }
  registrations.clear();
}
