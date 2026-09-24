/**
 * Selection-popup translate handle.
 *
 * The reader's selection popup is rebuilt from scratch on every selection, and
 * its translate routine only exists inside that one render's closure. A hotkey
 * pressed while the popup is on screen should still stream into the popup
 * rather than opening a second answer in the panel, so each render publishes a
 * handle here and the hotkey asks for whatever is currently live.
 *
 * The handle carries the popup node it belongs to; a stale render is detected
 * by that node no longer being in a document, which is also how the popup's own
 * sentinel watch decides the popup is gone.
 */

export type SelectionPopupTranslateHandle = {
  /** The popup subtree this handle belongs to. */
  node: HTMLElement;
  /** Reveals the translation panel when it is waiting to be asked. */
  reveal?: () => void;
  /** Starts (or restarts) the popup's own streaming translation. */
  run: () => Promise<void> | void;
};

let activeHandle: SelectionPopupTranslateHandle | null = null;

function isHandleLive(
  handle: SelectionPopupTranslateHandle | null,
): handle is SelectionPopupTranslateHandle {
  if (!handle) return false;
  try {
    return handle.node.isConnected === true;
  } catch {
    return false;
  }
}

/** Publish the translate routine of the popup that is rendering right now. */
export function setActiveSelectionPopupTranslate(
  handle: SelectionPopupTranslateHandle | null,
): void {
  activeHandle = handle;
}

/** Drop a handle, if it is still the published one. */
export function clearActiveSelectionPopupTranslate(node?: HTMLElement): void {
  if (!node || activeHandle?.node === node) activeHandle = null;
}

/** Whether a live popup is currently able to translate. */
export function hasActiveSelectionPopupTranslate(): boolean {
  if (!isHandleLive(activeHandle)) {
    activeHandle = null;
    return false;
  }
  return true;
}

/**
 * Run the live popup's translation.
 *
 * Returns false when no popup is on screen, which is the caller's signal to
 * fall back to a panel request.
 */
export function runActiveSelectionPopupTranslate(): boolean {
  if (!hasActiveSelectionPopupTranslate() || !activeHandle) return false;
  const handle = activeHandle;
  try {
    handle.reveal?.();
    void handle.run();
    return true;
  } catch (err) {
    ztoolkit.log("LLM: popup translate handle failed", err);
    return false;
  }
}
