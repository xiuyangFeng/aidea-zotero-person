/**
 * Inline notice — the one-line banner that floats just above the composer.
 *
 * The status line under the composer is 11px of muted text: fine for "Ready"
 * or "Copied", easy to miss for "No text selected" or a failed request. The
 * notice is where anything the user must act on goes instead: an icon, the
 * message, optional action buttons and a close ×.
 *
 * There is a single slot per panel, so the newest notice replaces the older
 * one. Information and success notices get out of the way on their own after
 * a few seconds; warnings and errors stay until they are closed or replaced,
 * because a problem that vanishes before it is read has not been reported.
 *
 * Status calls reach the notice without their call sites changing:
 * `setStatus` in textUtils hands every update to `routeStatusToNotice`, which
 * mirrors warnings and errors here and clears a mirrored notice once a new
 * request starts. The policy half of this module is pure so it can be tested
 * without a DOM.
 */

import { createElement } from "../../utils/domHelpers";
import { getPanelI18n } from "./i18n";

export type NoticeKind = "info" | "success" | "warning" | "error";

/** Status-line variants, as `setStatus` receives them. */
export type NoticeStatusVariant = "ready" | "sending" | "error" | "warning";

/** Source tag for notices mirrored from the status line. */
export const STATUS_NOTICE_SOURCE = "status";

/** How long an info or success notice stays up. */
export const NOTICE_AUTO_DISMISS_MS = 4000;

export type NoticeAction = {
  label: string;
  onClick: () => void;
  /** Rendered as the filled button. */
  primary?: boolean;
};

export type NoticeOptions = {
  kind: NoticeKind;
  message: string;
  actions?: NoticeAction[];
  /** Keep an info/success notice up until closed or replaced. */
  persist?: boolean;
  /** Who raised it, so the owner can later take it down selectively. */
  source?: string;
  /** Called once when the notice is closed by the user (× button). */
  onClose?: () => void;
};

// ---------------------------------------------------------------------------
// Policy (pure)
// ---------------------------------------------------------------------------

/**
 * Milliseconds before a notice hides itself; `0` means it stays.
 *
 * Warnings and errors always stay: auto-hiding a problem is how it gets
 * missed. A notice carrying actions stays too, since a button that vanishes
 * mid-reach is worse than no button.
 */
export function resolveNoticeDismissDelay(options: {
  kind: NoticeKind;
  persist?: boolean;
  hasActions?: boolean;
}): number {
  if (options.persist) return 0;
  if (options.kind === "warning" || options.kind === "error") return 0;
  if (options.hasActions) return 0;
  return NOTICE_AUTO_DISMISS_MS;
}

/** Which status variants are mirrored into a notice. */
export function noticeKindForStatus(
  variant: NoticeStatusVariant,
): NoticeKind | null {
  if (variant === "error") return "error";
  if (variant === "warning") return "warning";
  return null;
}

/**
 * Whether a status update retires the notice currently shown.
 *
 * Only notices mirrored from the status line are retired, and only when a new
 * request starts: the user has moved on, and a stale "No text selected" above
 * a running answer reads as if the answer failed. Notices raised by a feature
 * (the auto-briefing prompt) belong to that feature and are left alone.
 */
export function shouldStatusRetireNotice(
  variant: NoticeStatusVariant,
  currentSource: string | null | undefined,
): boolean {
  return variant === "sending" && currentSource === STATUS_NOTICE_SOURCE;
}

/** ARIA politeness for a kind: errors interrupt, everything else waits. */
export function noticeAriaLive(kind: NoticeKind): "assertive" | "polite" {
  return kind === "error" ? "assertive" : "polite";
}

const NOTICE_ICONS: Record<NoticeKind, string> = {
  info: "i",
  success: "✓",
  warning: "!",
  error: "×",
};

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const NOTICE_ID = "llm-notice";
const dismissTimers = new WeakMap<Element, number>();
const closeCallbacks = new WeakMap<Element, () => void>();

/** Build the empty notice slot. Mounted once per panel by `buildUI`. */
export function createNoticeSlot(doc: Document): HTMLDivElement {
  const notice = createElement(doc, "div", "llm-notice", { id: NOTICE_ID });
  notice.hidden = true;
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.setAttribute("aria-atomic", "true");
  return notice;
}

/** The notice slot of the panel `anchor` belongs to, if it has one. */
export function findNoticeSlot(
  anchor: Element | null | undefined,
): HTMLElement | null {
  if (!anchor) return null;
  try {
    if ((anchor as HTMLElement).id === NOTICE_ID) return anchor as HTMLElement;
    const panel = anchor.closest?.(".llm-panel") || null;
    const scoped = panel?.querySelector?.(`#${NOTICE_ID}`) || null;
    if (scoped) return scoped as HTMLElement;
    return (anchor.querySelector?.(`#${NOTICE_ID}`) as HTMLElement) || null;
  } catch {
    return null;
  }
}

function clearDismissTimer(slot: HTMLElement): void {
  const timer = dismissTimers.get(slot);
  if (timer === undefined) return;
  dismissTimers.delete(slot);
  try {
    slot.ownerDocument?.defaultView?.clearTimeout(timer);
  } catch {
    /* window already gone */
  }
}

function setShellFlag(slot: HTMLElement, visible: boolean): void {
  const shell = slot.parentElement as HTMLElement | null;
  if (!shell) return;
  if (visible) shell.dataset.noticeVisible = "true";
  else delete shell.dataset.noticeVisible;
}

function hideSlot(slot: HTMLElement): void {
  clearDismissTimer(slot);
  closeCallbacks.delete(slot);
  slot.hidden = true;
  slot.textContent = "";
  delete slot.dataset.source;
  delete slot.dataset.kind;
  setShellFlag(slot, false);
}

/** Label of the close button, in the panel language. */
function resolveDismissLabel(): string {
  try {
    return getPanelI18n().noticeDismiss;
  } catch {
    return "Dismiss";
  }
}

/**
 * Show a notice in the panel `anchor` belongs to, replacing any current one.
 * Returns false when the panel has no notice slot.
 */
export function showPanelNotice(
  anchor: Element | null | undefined,
  options: NoticeOptions,
): boolean {
  const slot = findNoticeSlot(anchor);
  const doc = slot?.ownerDocument;
  if (!slot || !doc) return false;
  const message = String(options.message || "").trim();
  if (!message) return false;

  clearDismissTimer(slot);
  slot.textContent = "";
  slot.className = `llm-notice llm-notice--${options.kind}`;
  slot.dataset.kind = options.kind;
  slot.dataset.source = options.source || "";
  slot.setAttribute("aria-live", noticeAriaLive(options.kind));
  if (options.onClose) closeCallbacks.set(slot, options.onClose);
  else closeCallbacks.delete(slot);

  const icon = createElement(doc, "span", "llm-notice-icon", {
    textContent: NOTICE_ICONS[options.kind],
  });
  icon.setAttribute("aria-hidden", "true");
  const text = createElement(doc, "span", "llm-notice-message", {
    textContent: message,
    title: message,
  });
  slot.append(icon, text);

  const actions = options.actions || [];
  if (actions.length) {
    const actionRow = createElement(doc, "span", "llm-notice-actions");
    for (const action of actions) {
      const button = createElement(
        doc,
        "button",
        `llm-notice-action${action.primary ? " llm-notice-action--primary" : ""}`,
        { type: "button", textContent: action.label },
      );
      button.addEventListener("click", (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          action.onClick();
        } catch (err) {
          ztoolkit.log("LLM: notice action failed", err);
        }
      });
      actionRow.appendChild(button);
    }
    slot.appendChild(actionRow);
  }

  const dismissLabel = resolveDismissLabel();
  const close = createElement(doc, "button", "llm-notice-close", {
    type: "button",
    textContent: "×",
    title: dismissLabel,
  });
  close.setAttribute("aria-label", dismissLabel);
  close.addEventListener("click", (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    const onClose = closeCallbacks.get(slot);
    hideSlot(slot);
    try {
      onClose?.();
    } catch (err) {
      ztoolkit.log("LLM: notice close handler failed", err);
    }
  });
  slot.appendChild(close);

  slot.hidden = false;
  setShellFlag(slot, true);

  const delay = resolveNoticeDismissDelay({
    kind: options.kind,
    persist: options.persist,
    hasActions: actions.length > 0,
  });
  const win = doc.defaultView;
  if (delay > 0 && win) {
    dismissTimers.set(
      slot,
      win.setTimeout(() => {
        dismissTimers.delete(slot);
        hideSlot(slot);
      }, delay),
    );
  }
  return true;
}

/**
 * Take the current notice down. With `source`, only a notice raised by that
 * source is removed, so one feature never clears another's message.
 */
export function dismissPanelNotice(
  anchor: Element | null | undefined,
  filter?: { source?: string },
): void {
  const slot = findNoticeSlot(anchor);
  if (!slot || slot.hidden) return;
  if (filter?.source !== undefined && slot.dataset.source !== filter.source) {
    return;
  }
  hideSlot(slot);
}

/** Source tag of the notice on screen, or `null` when none is shown. */
export function getPanelNoticeSource(
  anchor: Element | null | undefined,
): string | null {
  const slot = findNoticeSlot(anchor);
  if (!slot || slot.hidden) return null;
  return slot.dataset.source ?? "";
}

/**
 * Mirror a status update into the notice slot. Never throws: the status line
 * is on every code path, and a missing slot (a panel built before this
 * existed, the translate tab's own status) must not break any of them.
 */
export function routeStatusToNotice(
  statusEl: Element | null | undefined,
  text: string,
  variant: NoticeStatusVariant,
): void {
  try {
    if (!statusEl) return;
    const kind = noticeKindForStatus(variant);
    if (kind) {
      showPanelNotice(statusEl, {
        kind,
        message: text,
        source: STATUS_NOTICE_SOURCE,
      });
      return;
    }
    if (shouldStatusRetireNotice(variant, getPanelNoticeSource(statusEl))) {
      dismissPanelNotice(statusEl, { source: STATUS_NOTICE_SOURCE });
    }
  } catch (err) {
    try {
      ztoolkit.log("LLM: notice routing failed", err);
    } catch {
      /* no toolkit in unit tests */
    }
  }
}
