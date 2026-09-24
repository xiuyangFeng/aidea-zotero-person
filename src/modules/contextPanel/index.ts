/**
 * Context Panel Module
 *
 * This is the main entry point for the LLM context panel, which provides
 * a chat interface in Zotero's reader/library side panel.
 *
 * The module is split into focused sub-modules:
 * - constants.ts   – shared constants
 * - types.ts       – shared type definitions
 * - state.ts       – module-level mutable state
 * - buildUI.ts     – UI construction
 * - setupHandlers.ts – event handler wiring
 * - chat.ts        – conversation logic, send/refresh
 * - shortcuts.ts   – shortcut rendering and management
 * - screenshot.ts  – screenshot capture from PDF reader
 * - pdfContext.ts   – PDF text extraction, chunking, BM25, embeddings
 * - notes.ts       – Zotero note creation from chat
 * - contextResolution.ts – tab/reader context resolution
 * - menuPositioning.ts   – dropdown/context menu positioning
 * - prefHelpers.ts – preference access helpers
 * - textUtils.ts   – text sanitization, formatting
 */

import { getLocaleID } from "../../utils/locale";
import { renderMarkdown } from "../../utils/markdown";
import { getZoteroItem } from "../../utils/zoteroItems";
import { config, PANE_ID } from "./constants";
import type { Message } from "./types";
import {
  chatHistory,
  loadedConversationKeys,
  readerContextPanelRegistered,
  setReaderContextPanelRegistered,
  recentReaderSelectionCache,
  conversationContextPool,
} from "./state";
import { clearConversation as clearStoredConversation } from "../../utils/chatStore";
import {
  ATTACHMENT_GC_MIN_AGE_MS,
  clearOwnerAttachmentRefs,
  collectAndDeleteUnreferencedBlobs,
} from "../../utils/attachmentRefStore";
import { normalizeSelectedText, sanitizeText } from "./textUtils";
import { copyTextToClipboard, zoneBSummaryCache } from "./chat";
import {
  getItemSelectionCacheKeys,
  getActiveContextAttachmentFromTabs,
  getActiveReaderDocumentAttachmentFromTabs,
} from "./contextResolution";
import {
  getFirstSelectionFromReader,
  getSelectionFromDocument,
} from "./readerSelection";
import { getSharedReaderPanelHostForItem } from "./readerPanel";
import {
  clearActiveSelectionPopupTranslate,
  setActiveSelectionPopupTranslate,
} from "./selectionPopupTranslate";
import {
  addSelectionTextToPanel,
  dispatchReadingAction,
  type ReadingActionKind,
} from "./readingActions";
import {
  bootstrapSharedLibraryPanel,
  getSharedLibraryPanelHost,
} from "./libraryPanel";
import {
  getLibrarySelectionStateFromWindow,
  isManagedLibraryPanelSectionEnabled,
} from "./librarySelection";
import { getPanelI18n, getPanelLang } from "./i18n";
import {
  CAPSULE_ACTIONS,
  recommendCapsuleActions,
  type CapsuleActionKind,
  type QuickCapsuleLang,
} from "../../utils/quickCapsule";
import {
  isSelectionTranslateAutoEnabled,
  isSelectionTranslateBilingualEnabled,
  isSelectionTranslateEnabled,
  setSelectionTranslateBilingualEnabled,
  translateSelectedTextForReader,
} from "./selectionTranslate";
import {
  resolveSelectionBilingualViewState,
  toggleSelectionBilingual,
} from "./selectionTranslateBilingual";
import { EPUB_CONTENT_TYPE, getReaderDocumentKind } from "./documentContext";
import { appendSelectionTranslationToNote } from "./notes";
import {
  PANEL_TYPOGRAPHY_REFRESH_EVENT,
  SELECTION_POPUP_HEIGHT_BOUNDS,
  getPanelTypographyBounds,
  getPanelTypographySettings,
  getSelectionTranslatePopupHeight,
  setSelectionTranslatePopupHeight,
  setSelectionTranslatePopupWidth,
} from "./prefHelpers";
import {
  getSelectionTranslateMeasuredHeight,
  getSelectionTranslateSingleLineHeight,
  getSelectionTranslateSourceMaxHeight,
  resolveSelectionTranslateContentHeight,
  scheduleSelectionTranslateLayout,
} from "./selectionTranslatePopupSize";
import { createSelectionTranslatePopupStream } from "./selectionTranslatePopupStream";
import { applyCurrentThemeToRoot } from "./theme";

type ReaderSelectionPopupHandler =
  _ZoteroTypes.Reader.EventHandler<"renderTextSelectionPopup">;

let readerContextPanelSectionKey: string | null = null;
let readerSelectionPopupHandler: ReaderSelectionPopupHandler | null = null;

function shouldEnablePanelSection(
  body: Element,
  tabType: unknown,
  item?: unknown,
): boolean {
  if (tabType === "reader") return true;
  if (tabType !== "library") return false;
  if (item) return true;
  const win = body.ownerDocument?.defaultView;
  return isManagedLibraryPanelSectionEnabled(
    getLibrarySelectionStateFromWindow(win),
  );
}

function attachLibraryManagedPanelHost(
  body: Element,
  tabType: unknown,
  item?: unknown,
): { win: Window; host: HTMLElement } | null {
  if (tabType !== "library") return null;
  const doc = body.ownerDocument;
  const win = doc?.defaultView;
  if (!win || !shouldEnablePanelSection(body, tabType, item)) return null;

  const host = getSharedLibraryPanelHost(win);
  if (!body.contains(host)) {
    body.textContent = "";
    body.appendChild(host);
  }
  host.style.display = "flex";
  return { win, host };
}

// =============================================================================
// Public API
// =============================================================================

// =============================================================================
// Section Visibility
// =============================================================================

export function registerLLMStyles(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  removeLLMStyles(win);

  // Main styles
  const link = doc.createElement("link") as HTMLLinkElement;
  link.id = `${config.addonRef}-styles`;
  link.rel = "stylesheet";
  link.type = "text/css";
  link.href = `chrome://${config.addonRef}/content/zoteroPane.css`;
  doc.documentElement?.appendChild(link);

  // KaTeX styles for math rendering
  const katexLink = doc.createElement("link") as HTMLLinkElement;
  katexLink.id = `${config.addonRef}-katex-styles`;
  katexLink.rel = "stylesheet";
  katexLink.type = "text/css";
  katexLink.href = `chrome://${config.addonRef}/content/vendor/katex/katex.min.css`;
  doc.documentElement?.appendChild(katexLink);
}

export function removeLLMStyles(win: Window) {
  const doc = win.document;
  doc.getElementById(`${config.addonRef}-styles`)?.remove();
  doc.getElementById(`${config.addonRef}-katex-styles`)?.remove();
}

export function registerReaderContextPanel() {
  if (readerContextPanelRegistered) return;
  unregisterReaderContextPanel();
  const sectionKey = Zotero.ItemPaneManager.registerSection({
    paneID: PANE_ID,
    pluginID: config.addonID,
    header: {
      l10nID: getLocaleID("llm-panel-head"),
      icon: `chrome://${config.addonRef}/content/icons/icon-20.png`,
    },
    sidenav: {
      l10nID: getLocaleID("llm-panel-sidenav-tooltip"),
      icon: `chrome://${config.addonRef}/content/icons/icon-20.png`,
    },
    onInit: ({ body, setEnabled, tabType }) => {
      // Reader tabs and selected Library items use Zotero's managed
      // section so native item-pane sections remain selectable.
      const enabled = shouldEnablePanelSection(body, tabType);
      setEnabled(enabled);
      ztoolkit.log(`LLM: panel init tabType=${tabType} enabled=${enabled}`);
    },
    onItemChange: ({ body, setEnabled, tabType }) => {
      const enabled = shouldEnablePanelSection(body, tabType);
      setEnabled(enabled);
      ztoolkit.log(
        `LLM: panel itemChange tabType=${tabType} enabled=${enabled}`,
      );
    },
    onRender: ({ body, item, tabType }) => {
      ztoolkit.log(
        `LLM: panel onRender tabType=${tabType} hasItem=${Boolean(item)}`,
      );
      if (typeof tabType === "string") {
        (body as HTMLElement).dataset.tabType = tabType;
      }
      if (tabType === "library") {
        try {
          attachLibraryManagedPanelHost(body, tabType, item);
        } catch (err) {
          ztoolkit.log("LLM: library sync reparent failed", err);
        }
        return;
      }
      // ── Reader mode: synchronously reparent the cached host ──
      if (tabType === "reader" && item) {
        try {
          const doc = body.ownerDocument;
          const win = doc?.defaultView;
          if (win) {
            // Zotero may pass a parent item. Prefer the attachment owned by
            // the active reader so mixed PDF/EPUB parents cannot pick the
            // wrong document by attachment order.
            let renderItem = item;
            if (!getReaderDocumentKind(item)) {
              const documentFromTab =
                getActiveReaderDocumentAttachmentFromTabs();
              if (documentFromTab) {
                renderItem = documentFromTab;
              }
            }
            const host = getSharedReaderPanelHostForItem(win, renderItem);
            if (!body.contains(host)) {
              body.textContent = "";
              body.appendChild(host);
            }
            host.style.display = "flex";
          }
          // Removed: scrollSectionIntoView(body) — was hijacking sidebar scroll
        } catch (err) {
          ztoolkit.log("LLM: reader sync reparent failed", err);
        }
        return;
      }
      if (tabType !== "reader") return;
      try {
        // Removed: scrollSectionIntoView(body) — was hijacking sidebar scroll
      } catch (err) {
        ztoolkit.log("LLM: scroll section failed", err);
      }
    },
    onAsyncRender: async ({ body, item, setEnabled, tabType }) => {
      const enabled = shouldEnablePanelSection(body, tabType, item);
      setEnabled(enabled);
      ztoolkit.log(
        `LLM: panel asyncRender tabType=${tabType} enabled=${enabled} hasItem=${Boolean(item)}`,
      );

      if (typeof tabType === "string") {
        (body as HTMLElement).dataset.tabType = tabType;
      }

      if (tabType === "library") {
        const attached = attachLibraryManagedPanelHost(body, tabType, item);
        if (!attached) return;
        await bootstrapSharedLibraryPanel(attached.win, attached.host);
        return;
      }

      // ── Reader mode: bootstrap shared persistent DOM ──
      // The host was already reparented synchronously in onRender.
      // Here we only run the one-time async bootstrap.
      if (tabType !== "reader") return;

      if (!item) return;
      const doc = body.ownerDocument;
      if (!doc) return;
      const win = doc.defaultView;
      if (!win) return;

      // Zotero sometimes passes the parent item instead of the attachment.
      // Resolve the active reader attachment before bootstrapping so mixed
      // PDF/EPUB parents cannot warm the wrong document.
      let readerItem = item;
      if (!getReaderDocumentKind(item)) {
        const documentFromTab = getActiveReaderDocumentAttachmentFromTabs();
        if (documentFromTab) {
          readerItem = documentFromTab;
        }
      }

      const host = getSharedReaderPanelHostForItem(win, readerItem);

      // Defensive: ensure host is attached (in case onRender didn't fire)
      if (!body.contains(host)) {
        body.textContent = "";
        body.appendChild(host);
        host.style.display = "flex";
      }

      const { bootstrapSharedReaderPanel } = await import("./readerPanel");
      await bootstrapSharedReaderPanel(win, host, readerItem);
    },
    onToggle: ({ body, event, item, tabType }) => {
      if (tabType !== "library") return;
      const target = event?.target as { open?: boolean } | null | undefined;
      if (target?.open === false) return;

      try {
        const attached = attachLibraryManagedPanelHost(body, tabType, item);
        if (!attached) return;
        void bootstrapSharedLibraryPanel(attached.win, attached.host).catch(
          (err) => {
            ztoolkit.log("LLM: library toggle bootstrap failed", err);
          },
        );
      } catch (err) {
        ztoolkit.log("LLM: library toggle reparent failed", err);
      }
    },
  });
  if (sectionKey === false) {
    ztoolkit.log("LLM: failed to register reader context panel");
    return;
  }
  readerContextPanelSectionKey = sectionKey;
  setReaderContextPanelRegistered(true);
}

export function unregisterReaderContextPanel() {
  const key = readerContextPanelSectionKey || PANE_ID;
  try {
    Zotero.ItemPaneManager.unregisterSection(key);
  } catch (_err) {
    void _err;
  }
  readerContextPanelSectionKey = null;
  setReaderContextPanelRegistered(false);
}

type SelectionPopupRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

function makeSelectionPopupRect(
  left: number,
  top: number,
  right: number,
  bottom: number,
): SelectionPopupRect {
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function getViewportRect(doc: Document): SelectionPopupRect {
  const win = doc.defaultView;
  const width =
    doc.documentElement?.clientWidth ||
    doc.body?.clientWidth ||
    win?.innerWidth ||
    800;
  const height =
    doc.documentElement?.clientHeight ||
    doc.body?.clientHeight ||
    win?.innerHeight ||
    600;
  return makeSelectionPopupRect(0, 0, width, height);
}

function getReaderSelectionClientRect(
  doc: Document,
): SelectionPopupRect | null {
  const selection = doc.defaultView?.getSelection?.();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const rects = Array.from(range.getClientRects?.() || []).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  if (!rects.length) {
    const rect = range.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      ? makeSelectionPopupRect(rect.left, rect.top, rect.right, rect.bottom)
      : null;
  }
  return makeSelectionPopupRect(
    Math.min(...rects.map((rect) => rect.left)),
    Math.min(...rects.map((rect) => rect.top)),
    Math.max(...rects.map((rect) => rect.right)),
    Math.max(...rects.map((rect) => rect.bottom)),
  );
}

function getRectOverlapArea(
  a: SelectionPopupRect,
  b: SelectionPopupRect,
): number {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function movePopupToViewportPoint(
  popup: HTMLElement,
  left: number,
  top: number,
): void {
  const rect = popup.getBoundingClientRect();
  const currentLeft = Number.parseFloat(popup.style.left || "");
  const currentTop = Number.parseFloat(popup.style.top || "");
  const baseLeft = Number.isFinite(currentLeft)
    ? currentLeft
    : popup.offsetLeft;
  const baseTop = Number.isFinite(currentTop) ? currentTop : popup.offsetTop;
  popup.style.left = `${baseLeft + (left - rect.left)}px`;
  popup.style.top = `${baseTop + (top - rect.top)}px`;
}

function clampSelectionPopupToViewport(
  doc: Document,
  popup: HTMLElement | null,
  margin: number = 10,
): void {
  if (!popup?.isConnected) return;
  const viewport = getViewportRect(doc);
  const rect = popup.getBoundingClientRect();
  const popupWidth = Math.min(rect.width, viewport.width - margin * 2);
  const popupHeight = Math.min(rect.height, viewport.height - margin * 2);
  movePopupToViewportPoint(
    popup,
    clamp(
      rect.left,
      margin,
      Math.max(margin, viewport.width - popupWidth - margin),
    ),
    clamp(
      rect.top,
      margin,
      Math.max(margin, viewport.height - popupHeight - margin),
    ),
  );
}

function measureSelectionTranslateNaturalHeight(params: {
  wrap: HTMLElement;
  resultBox: HTMLElement;
  minimumHeight: number;
}): number {
  const { wrap, resultBox, minimumHeight } = params;
  const width = Math.max(
    1,
    resultBox.getBoundingClientRect().width || resultBox.offsetWidth,
  );
  const measurement = resultBox.cloneNode(true) as HTMLElement;
  measurement.tabIndex = -1;
  measurement.setAttribute("aria-hidden", "true");
  measurement.style.position = "fixed";
  measurement.style.left = "-100000px";
  measurement.style.top = "0";
  measurement.style.display = "block";
  measurement.style.visibility = "hidden";
  measurement.style.pointerEvents = "none";
  measurement.style.width = `${width}px`;
  measurement.style.height = "auto";
  measurement.style.minHeight = "0";
  measurement.style.maxHeight = "none";
  measurement.style.overflow = "visible";
  measurement.style.resize = "none";
  measurement.style.outline = "none";
  wrap.appendChild(measurement);
  try {
    return getSelectionTranslateMeasuredHeight({
      boundingHeight: measurement.getBoundingClientRect().height,
      offsetHeight: measurement.offsetHeight,
      scrollHeight: measurement.scrollHeight,
      minimumHeight,
    });
  } finally {
    measurement.remove();
  }
}

function getSelectionTranslateAvailableResultHeight(params: {
  viewportHeight: number;
  popup: HTMLElement | null;
  resultBox: HTMLElement;
  minimumHeight: number;
  margin?: number;
}): number {
  const {
    viewportHeight,
    popup,
    resultBox,
    minimumHeight,
    margin = 10,
  } = params;
  const popupHeight = popup?.getBoundingClientRect().height ?? 0;
  const popupChromeHeight = Math.max(80, popupHeight - resultBox.offsetHeight);
  return Math.max(
    minimumHeight,
    Math.min(
      SELECTION_POPUP_HEIGHT_BOUNDS.max,
      viewportHeight - margin * 2 - popupChromeHeight,
    ),
  );
}

function layoutSelectionTranslatePopup(params: {
  doc: Document;
  popup: HTMLElement | null;
  wrap: HTMLElement;
  resultBox: HTMLElement;
  /** Bilingual source block, when the popup is showing one. */
  sourceBox?: HTMLElement | null;
  selectionRect: SelectionPopupRect | null;
  preferredWidth: number;
  preferredHeight: number;
  minimumHeight: number;
  reposition?: boolean;
}): void {
  const {
    doc,
    popup,
    wrap,
    resultBox,
    sourceBox = null,
    selectionRect,
    preferredWidth,
    preferredHeight,
    minimumHeight,
    reposition = true,
  } = params;
  if (!popup?.isConnected || !wrap.isConnected) return;

  const viewport = getViewportRect(doc);
  const margin = 10;
  const gap = 8;
  const typography = getPanelTypographySettings();
  const availableWidth = Math.max(180, viewport.width - margin * 2);
  const width = clamp(
    preferredWidth,
    Math.min(184, availableWidth),
    availableWidth,
  );

  wrap.style.width = `${width}px`;
  wrap.style.maxWidth = `${availableWidth}px`;
  if (sourceBox) {
    // The source scrolls inside its own ceiling; what is left of the viewport
    // is measured as popup chrome below, so the result box shrinks to match.
    sourceBox.style.maxHeight = `${getSelectionTranslateSourceMaxHeight({
      viewerHeight: viewport.height,
      minimumHeight,
    })}px`;
  }
  resultBox.style.width = "100%";
  resultBox.style.fontSize = `${typography.selectionFontSize}px`;
  resultBox.style.lineHeight = String(typography.selectionLineHeight);
  const availableResultHeight = getSelectionTranslateAvailableResultHeight({
    viewportHeight: viewport.height,
    popup,
    resultBox,
    minimumHeight,
    margin,
  });
  resultBox.style.maxHeight = `${availableResultHeight}px`;
  resultBox.style.height = `${clamp(
    preferredHeight,
    minimumHeight,
    availableResultHeight,
  )}px`;

  const popupRect = popup.getBoundingClientRect();
  const popupWidth = Math.min(
    popupRect.width || width,
    viewport.width - 2 * margin,
  );
  const popupHeight = Math.min(
    popupRect.height || resultBox.scrollHeight || minimumHeight + 80,
    viewport.height - 2 * margin,
  );

  if (!reposition || !selectionRect) {
    clampSelectionPopupToViewport(doc, popup, margin);
    return;
  }

  const centeredLeft =
    selectionRect.left + selectionRect.width / 2 - popupWidth / 2;
  const candidates = [
    {
      left: centeredLeft,
      top: selectionRect.bottom + gap,
      priority: 4,
    },
    {
      left: centeredLeft,
      top: selectionRect.top - popupHeight - gap,
      priority: 3.8,
    },
    {
      left: selectionRect.right + gap,
      top: selectionRect.top,
      priority: 3.2,
    },
    {
      left: selectionRect.left - popupWidth - gap,
      top: selectionRect.top,
      priority: 3,
    },
  ].map((candidate) => {
    const unclamped = makeSelectionPopupRect(
      candidate.left,
      candidate.top,
      candidate.left + popupWidth,
      candidate.top + popupHeight,
    );
    const left = clamp(
      candidate.left,
      margin,
      viewport.width - popupWidth - margin,
    );
    const top = clamp(
      candidate.top,
      margin,
      viewport.height - popupHeight - margin,
    );
    const rect = makeSelectionPopupRect(
      left,
      top,
      left + popupWidth,
      top + popupHeight,
    );
    const fits =
      unclamped.left >= margin &&
      unclamped.top >= margin &&
      unclamped.right <= viewport.width - margin &&
      unclamped.bottom <= viewport.height - margin;
    const overlap = getRectOverlapArea(rect, selectionRect);
    const visible = getRectOverlapArea(rect, viewport);
    return {
      left,
      top,
      score:
        (fits ? 1_000_000 : 0) +
        visible -
        overlap * 20 +
        candidate.priority * 10_000,
    };
  });

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best) movePopupToViewportPoint(popup, best.left, best.top);
}

export function registerReaderSelectionTracking() {
  const readerAPI = Zotero.Reader as _ZoteroTypes.Reader & {
    __llmSelectionTrackingRegistered?: boolean;
    __llmSelectionTrackingHandler?: ReaderSelectionPopupHandler | null;
  };
  if (!readerAPI) return;
  if (readerAPI.__llmSelectionTrackingRegistered && readerSelectionPopupHandler)
    return;
  if (readerAPI.__llmSelectionTrackingHandler) {
    try {
      Zotero.Reader.unregisterEventListener(
        "renderTextSelectionPopup",
        readerAPI.__llmSelectionTrackingHandler,
      );
    } catch (_err) {
      void _err;
    }
  }
  readerAPI.__llmSelectionTrackingRegistered = false;
  readerAPI.__llmSelectionTrackingHandler = null;

  const handler: _ZoteroTypes.Reader.EventHandler<
    "renderTextSelectionPopup"
  > = (event) => {
    const i18n = getPanelI18n();
    const selectedText = (() => {
      const fromAnnotation = normalizeSelectedText(
        event.params?.annotation?.text || "",
      );
      if (fromAnnotation) return fromAnnotation;
      const fromPopupDoc = getSelectionFromDocument(
        event.doc,
        normalizeSelectedText,
      );
      if (fromPopupDoc) return fromPopupDoc;
      return getFirstSelectionFromReader(
        event.reader as any,
        normalizeSelectedText,
      );
    })();
    const itemId = event.reader?._item?.id || event.reader?.itemID;
    if (typeof itemId !== "number") return;
    const item = getZoteroItem(itemId);
    const cacheKeys = getItemSelectionCacheKeys(item);
    const keys = cacheKeys.length ? cacheKeys : [itemId];
    const isPopupOptionEnabled = (key: string): boolean => {
      const value = Zotero.Prefs.get(`${config.prefsPrefix}.${key}`, true);
      if (typeof value === "boolean") return value;
      const normalized = `${value ?? ""}`.trim().toLowerCase();
      if (!normalized) return true;
      return normalized !== "false" && normalized !== "0";
    };
    const showAddTextInPopup = isPopupOptionEnabled("showPopupAddText");
    const showCopyButton = isPopupOptionEnabled(
      "selectionTranslate.showCopyButton",
    );
    const showAddToNoteButton = isPopupOptionEnabled(
      "selectionTranslate.showAddToNoteButton",
    );
    const hasVisibleSelectionTranslateActions =
      showCopyButton || showAddToNoteButton;
    let selectionTranslateRelayout: (() => void) | null = null;
    let selectionTranslateContentChanged:
      ((preservePosition?: boolean) => void) | null = null;

    const resolveSelectedTextForPopupAction = (): string => {
      const fromPopupDoc = getSelectionFromDocument(
        event.doc,
        normalizeSelectedText,
      );
      if (fromPopupDoc) return fromPopupDoc;
      const fromParams = normalizeSelectedText(
        (event.params as unknown as { text?: string; selectedText?: string })
          ?.text ||
          (event.params as unknown as { text?: string; selectedText?: string })
            ?.selectedText ||
          "",
      );
      if (fromParams) return fromParams;
      const fromAnnotation = normalizeSelectedText(
        event.params?.annotation?.text || "",
      );
      if (fromAnnotation) return fromAnnotation;
      const fromReader = getFirstSelectionFromReader(
        event.reader as any,
        normalizeSelectedText,
      );
      if (fromReader) return fromReader;
      for (const key of keys) {
        const cached = normalizeSelectedText(
          recentReaderSelectionCache.get(key) || "",
        );
        if (cached) return cached;
      }
      return "";
    };
    const resolveSelectionPageLabel = (): string => {
      const i18n = getPanelI18n();
      const params = event.params as unknown as {
        pageIndex?: unknown;
        page?: unknown;
        annotation?: {
          pageLabel?: unknown;
          pageIndex?: unknown;
          page?: unknown;
          position?: { pageIndex?: unknown; page?: unknown };
        };
      };
      if (item?.attachmentContentType === EPUB_CONTENT_TYPE) {
        const parent = item.parentID ? getZoteroItem(item.parentID) : null;
        const title = sanitizeText(
          parent?.getField?.("title") ||
            item.getField?.("title") ||
            (
              item as Zotero.Item & {
                attachmentFilename?: string;
              }
            ).attachmentFilename ||
            "EPUB",
        ).trim();
        const pageLabel = sanitizeText(
          typeof params?.annotation?.pageLabel === "string"
            ? params.annotation.pageLabel
            : "",
        ).trim();
        return [title || "EPUB", pageLabel].filter(Boolean).join(", ");
      }
      const rawPageIndex =
        params?.annotation?.position?.pageIndex ??
        params?.annotation?.pageIndex ??
        params?.pageIndex;
      const rawPage =
        params?.annotation?.position?.page ??
        params?.annotation?.page ??
        params?.page;
      const pageNumber =
        typeof rawPageIndex === "number"
          ? rawPageIndex + 1
          : Number.isFinite(Number(rawPageIndex))
            ? Number(rawPageIndex) + 1
            : typeof rawPage === "number"
              ? rawPage
              : Number.isFinite(Number(rawPage))
                ? Number(rawPage)
                : 0;
      if (!pageNumber || pageNumber < 1) {
        return i18n.trCurrentPdf;
      }
      return i18n.currentPdfPage(Math.floor(pageNumber));
    };

    if (selectedText || showAddTextInPopup) {
      let popupSentinelEl: HTMLElement | null = null;
      // Typography refresh listeners registered for a popup are disposed
      // either lazily (event fires after the popup is gone) or eagerly via
      // the sentinel watch below. Keyed by the per-render reader event.
      const selectionTypographyCleanupByEvent = new WeakMap<
        object,
        () => void
      >();
      const addTextToPanel = async () => {
        const effectiveSelectedText =
          normalizeSelectedText(selectedText) ||
          resolveSelectedTextForPopupAction();
        if (!effectiveSelectedText) {
          ztoolkit.log("LLM: Add Text popup action skipped (no selection)");
          return;
        }
        await addSelectionTextToPanel({
          doc: event.doc,
          item,
          selectedText: effectiveSelectedText,
        });
      };
      const stripPopupRowChrome = (
        row: HTMLElement | null,
        hideRow: boolean = false,
      ) => {
        if (!row) return;
        const HTMLElementCtor = event.doc.defaultView?.HTMLElement;
        if (hideRow) {
          row.style.display = "none";
        } else {
          row.style.width = "100%";
          row.style.padding = "0 12px";
          row.style.margin = "0";
          row.style.borderTop = "none";
          row.style.borderBottom = "none";
          row.style.boxShadow = "none";
          row.style.background = "transparent";
        }
        const isSeparator = (el: Element | null): el is HTMLElement => {
          if (!el || !HTMLElementCtor || !(el instanceof HTMLElementCtor))
            return false;
          const tag = el.tagName.toLowerCase();
          return tag === "hr" || el.getAttribute("role") === "separator";
        };
        const prev = row.previousElementSibling;
        const next = row.nextElementSibling;
        if (isSeparator(prev)) prev.style.display = "none";
        if (isSeparator(next)) next.style.display = "none";
      };

      // ══ Quick-action capsule ══
      // A compact row of reading actions, ordered by what the passage looks
      // like (formula, algorithm, table, long sentence, term). The first three
      // sit on one line; the rest hide behind "More" so a long selection can
      // never widen the popup past the translation panel's own width budget.
      const createPopupNode = <T extends HTMLElement>(
        tag: string,
        className: string,
      ): T => {
        const node = event.doc.createElementNS(
          "http://www.w3.org/1999/xhtml",
          tag,
        ) as unknown as T;
        node.className = className;
        return node;
      };
      const stopPopupBubbling = (target: HTMLElement) => {
        for (const eventName of [
          "pointerdown",
          "pointerup",
          "mousedown",
          "mouseup",
          "click",
        ]) {
          target.addEventListener(eventName, (e: Event) => {
            e.stopPropagation();
          });
        }
      };
      const quickActionsEnabled = isPopupOptionEnabled(
        "selectionPopup.quickActions",
      );
      const selectionTranslateEnabled = isSelectionTranslateEnabled();
      // "Translate on selection" off means the popup renders the translation
      // panel but waits: nothing is sent until the reader asks for it.
      const autoTranslateEnabled = isSelectionTranslateAutoEnabled();
      // Assigned by the translation block below when it renders. Declared here
      // so the capsule can drive a translation it is laid out above.
      let runPopupSelectionTranslate: (() => Promise<void>) | null = null;
      let revealSelectionTranslateWrap: (() => void) | null = null;
      const triggerPopupTranslate = () => {
        if (runPopupSelectionTranslate) {
          revealSelectionTranslateWrap?.();
          void runPopupSelectionTranslate();
          return;
        }
        // Selection translation is switched off entirely — fall back to the
        // panel, which answers in the conversation instead of the popup.
        const fallbackText =
          normalizeSelectedText(selectedText) ||
          resolveSelectedTextForPopupAction();
        if (!fallbackText) return;
        void dispatchReadingAction({
          kind: "translate",
          selectedText: fallbackText,
          readerItem: item,
          doc: event.doc,
        }).catch((err) => {
          ztoolkit.log("LLM: popup translate fallback failed", err);
        });
      };
      const runPopupReadingAction = (kind: ReadingActionKind) => {
        if (kind === "translate") {
          triggerPopupTranslate();
          return;
        }
        const actionText =
          normalizeSelectedText(selectedText) ||
          resolveSelectedTextForPopupAction();
        if (!actionText) return;
        void dispatchReadingAction({
          kind,
          selectedText: actionText,
          readerItem: item,
          doc: event.doc,
        })
          .then((result) => {
            if (result.outcome === "no-panel") {
              ztoolkit.log(
                `LLM: quick action "${kind}" found no AIdea panel to send to`,
              );
            }
          })
          .catch((err) => {
            ztoolkit.log(`LLM: quick action "${kind}" failed`, err);
          });
      };
      const createPopupActionButton = (
        label: string,
        title: string,
        onActivate: () => void,
      ): HTMLButtonElement => {
        const button = createPopupNode<HTMLButtonElement>(
          "button",
          "llm-selection-quick-action",
        );
        button.type = "button";
        button.textContent = label;
        button.title = title;
        button.setAttribute("aria-label", title);
        button.style.cssText = [
          "flex:0 0 auto",
          "margin:0",
          "padding:4px 8px",
          "box-sizing:border-box",
          "border:1px solid rgba(130,130,130,0.38)",
          "border-radius:6px",
          "background:rgba(127,127,127,0.08)",
          // Inherit so the label stays readable in both reader themes.
          "color:inherit",
          "font-size:12px",
          "line-height:1.25",
          "text-align:center",
          "white-space:nowrap",
          "cursor:pointer",
        ].join(";");
        // Reader popup rows can be torn down on the focus shift before "click"
        // would ever arrive, so the pointer press is the primary trigger — and
        // preventing its default keeps the reader's selection intact, which is
        // the very text these actions are about to send.
        //
        // pointerdown and mousedown are two reports of one press; the flag
        // collapses them and then swallows the click that completes the same
        // gesture. It is cleared each time, so a button that stays on screen
        // (the More toggle) can be pressed again and again.
        let pointerActivated = false;
        const run = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          onActivate();
        };
        const onPointerPress = (e: Event) => {
          const maybeMouse = e as MouseEvent;
          if (typeof maybeMouse.button === "number" && maybeMouse.button !== 0)
            return;
          // "pointerdown" always opens a new gesture; a "mousedown" that
          // follows one is the same press reported twice.
          if (pointerActivated && e.type !== "pointerdown") {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          pointerActivated = true;
          run(e);
        };
        button.addEventListener("pointerdown", onPointerPress);
        button.addEventListener("mousedown", onPointerPress);
        button.addEventListener("click", (e: Event) => {
          if (pointerActivated) {
            pointerActivated = false;
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          // Keyboard activation produces a click with no press before it.
          run(e);
        });
        return button;
      };
      const buildQuickActionCapsule = (): HTMLDivElement | null => {
        const capsuleText = normalizeSelectedText(selectedText);
        if (!capsuleText) return null;
        const capsuleLang: QuickCapsuleLang = getPanelLang().startsWith("zh")
          ? "zh-CN"
          : "en-US";
        const typography = getPanelTypographySettings();
        const container = createPopupNode<HTMLDivElement>(
          "div",
          "llm-selection-quick-actions",
        );
        container.style.cssText = [
          "display:flex",
          "flex-direction:column",
          "gap:4px",
          "width:100%",
          `max-width:min(${typography.selectionPopupWidth}px, calc(100vw - 20px))`,
          "box-sizing:border-box",
          "margin:0",
          "padding:2px 0",
          "color:inherit",
        ].join(";");
        applyCurrentThemeToRoot(container);
        stopPopupBubbling(container);

        const rowStyle = (display: "flex" | "none") =>
          [
            `display:${display}`,
            "flex-wrap:wrap",
            "align-items:center",
            "gap:4px",
            "width:100%",
            "box-sizing:border-box",
          ].join(";");
        const primaryRow = createPopupNode<HTMLDivElement>(
          "div",
          "llm-selection-quick-actions-row",
        );
        primaryRow.style.cssText = rowStyle("flex");
        const overflowRow = createPopupNode<HTMLDivElement>(
          "div",
          "llm-selection-quick-actions-row",
        );
        overflowRow.style.cssText = rowStyle("none");

        const recommended = recommendCapsuleActions(capsuleText);
        // With automatic translation off, the translate button is the one the
        // reader came here to press — it must not end up behind "More".
        const ordered =
          selectionTranslateEnabled && !autoTranslateEnabled
            ? ([
                "translate",
                ...recommended.filter((kind) => kind !== "translate"),
              ] as CapsuleActionKind[])
            : recommended;
        const primaryKinds = ordered.slice(0, 3);
        const overflowKinds = ordered.slice(3);
        const appendActionButton = (
          row: HTMLDivElement,
          kind: CapsuleActionKind,
        ) => {
          const definition = CAPSULE_ACTIONS[kind];
          row.appendChild(
            createPopupActionButton(
              `${definition.icon} ${definition.label[capsuleLang]}`,
              definition.description[capsuleLang],
              () => runPopupReadingAction(kind),
            ),
          );
        };
        for (const kind of primaryKinds) appendActionButton(primaryRow, kind);
        for (const kind of overflowKinds) appendActionButton(overflowRow, kind);

        container.appendChild(primaryRow);
        if (overflowKinds.length) {
          let overflowVisible = false;
          const moreBtn = createPopupActionButton(
            `${i18n.quickActionsMore} ▾`,
            i18n.quickActionsMore,
            () => {
              overflowVisible = !overflowVisible;
              overflowRow.style.display = overflowVisible ? "flex" : "none";
              const label = overflowVisible
                ? `${i18n.quickActionsLess} ▴`
                : `${i18n.quickActionsMore} ▾`;
              moreBtn.textContent = label;
              moreBtn.title = overflowVisible
                ? i18n.quickActionsLess
                : i18n.quickActionsMore;
              moreBtn.setAttribute("aria-expanded", String(overflowVisible));
              // The popup grew or shrank by a row; let the translation layout
              // re-measure so it never overlaps the selection.
              selectionTranslateContentChanged?.(true);
              selectionTranslateRelayout?.();
            },
          );
          moreBtn.setAttribute("aria-expanded", "false");
          primaryRow.appendChild(moreBtn);
          container.appendChild(overflowRow);
        }
        container.setAttribute("role", "group");
        container.setAttribute("aria-label", i18n.quickActionsTitle);
        return container;
      };

      if (selectedText && quickActionsEnabled) {
        try {
          const capsule = buildQuickActionCapsule();
          if (capsule) {
            event.append(capsule);
            if (!popupSentinelEl) popupSentinelEl = capsule;
            stripPopupRowChrome(capsule.parentElement as HTMLElement | null);
          }
        } catch (err) {
          ztoolkit.log("LLM: failed to append quick action capsule", err);
        }
      }

      if (selectedText && selectionTranslateEnabled) {
        try {
          const i18n = getPanelI18n();
          const text = {
            coldStart: i18n.selectionTranslateColdStart,
            translating: i18n.selectionTranslateTranslating,
            failed: i18n.selectionTranslateFailed,
            copy: i18n.copy,
            copied: i18n.copied,
          };
          const bilingualText = {
            showSource: i18n.selectionTranslateShowSource,
            hideSource: i18n.selectionTranslateHideSource,
          };
          const noteText = {
            addToNote: i18n.addToNote,
            addingToNote: i18n.addingToNote,
            addedToNote: i18n.addedToNote,
            addToNoteFailed: i18n.addToNoteFailed,
          };
          const selectionPopup = event.doc.querySelector(
            ".selection-popup",
          ) as HTMLElement | null;
          if (selectionPopup) {
            selectionPopup.style.maxWidth = "none";
            selectionPopup.style.width = "auto";
            selectionPopup.style.boxSizing = "border-box";
          }
          const selectionRect = getReaderSelectionClientRect(event.doc);
          const typography = getPanelTypographySettings();
          const calculateMinimumResultHeight = (
            settings = getPanelTypographySettings(),
          ) =>
            getSelectionTranslateSingleLineHeight({
              fontSize: settings.selectionFontSize,
              lineHeight: settings.selectionLineHeight,
            });
          let minimumResultHeight = calculateMinimumResultHeight(typography);
          let rememberedPopupHeight = getSelectionTranslatePopupHeight();
          let currentPopupWidth = typography.selectionPopupWidth;
          let currentPopupHeight = minimumResultHeight;
          const wrap = event.doc.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "div",
          ) as HTMLDivElement;
          wrap.className = "llm-selection-translate-wrap";
          wrap.style.cssText = [
            "display:flex",
            "flex-direction:column",
            "gap:10px",
            "padding:8px 0",
            `width:min(${currentPopupWidth}px, calc(100vw - 20px))`,
            "max-width:calc(100vw - 20px)",
            "margin:0",
            "box-sizing:border-box",
            "color:inherit",
          ].join(";");
          applyCurrentThemeToRoot(wrap);

          // Bilingual mode is a display choice, not a translation choice: the
          // source is already in hand, so the toggle only shows or hides it and
          // never costs a second request.
          const createPopupElement = <T extends HTMLElement>(
            tag: string,
            className: string,
          ): T => {
            const element = event.doc.createElementNS(
              "http://www.w3.org/1999/xhtml",
              tag,
            ) as unknown as T;
            element.className = className;
            return element;
          };
          const stopPopupEventBubbling = (
            target: HTMLElement,
            eventNames: string[],
          ) => {
            for (const eventName of eventNames) {
              target.addEventListener(eventName, (e: Event) => {
                e.stopPropagation();
              });
            }
          };

          let bilingualEnabled = isSelectionTranslateBilingualEnabled();
          let bilingualSourceText = selectedText;

          const toolbar = createPopupElement<HTMLDivElement>(
            "div",
            "llm-selection-translate-toolbar",
          );
          toolbar.style.cssText = [
            "display:flex",
            "width:100%",
            "align-items:center",
            "justify-content:flex-end",
            "gap:6px",
            "margin:0 0 -4px 0",
            "box-sizing:border-box",
          ].join(";");
          stopPopupEventBubbling(toolbar, [
            "pointerdown",
            "pointerup",
            "mousedown",
            "mouseup",
            "click",
          ]);
          const bilingualBtn = createPopupElement<HTMLButtonElement>(
            "button",
            "llm-selection-translate-bilingual-btn",
          );
          bilingualBtn.type = "button";
          // A language pair reads at any size and needs no icon asset in the
          // reader document, which cannot load the plugin's own chrome.
          bilingualBtn.textContent = "A文";
          bilingualBtn.style.cssText = [
            "margin:0",
            "padding:1px 6px",
            "box-sizing:border-box",
            "border:1px solid transparent",
            "border-radius:6px",
            "background:transparent",
            "color:inherit",
            "font-size:11px",
            "line-height:1.5",
            "white-space:nowrap",
            "cursor:pointer",
          ].join(";");

          const sourceBox = createPopupElement<HTMLDivElement>(
            "div",
            "llm-selection-translate-source",
          );
          sourceBox.style.cssText = [
            "display:none",
            "width:100%",
            "max-width:calc(100vw - 20px)",
            "overflow:auto",
            "box-sizing:border-box",
            "padding:4px 10px",
            "border-left:2px solid var(--llm-theme-border, rgba(130,130,130,0.45))",
            "border-radius:0 6px 6px 0",
            "background:transparent",
            "color:var(--llm-theme-chat-muted, inherit)",
            "opacity:0.74",
            `font-size:${Math.max(10, typography.selectionFontSize - 1)}px`,
            `line-height:${typography.selectionLineHeight}`,
            "white-space:pre-wrap",
            "overflow-wrap:anywhere",
            "cursor:text",
            "user-select:text",
            "-moz-user-select:text",
          ].join(";");
          stopPopupEventBubbling(sourceBox, [
            "pointerdown",
            "pointerup",
            "mousedown",
            "mouseup",
            "click",
            "selectstart",
            "dragstart",
          ]);
          const applyBilingualState = (preservePosition: boolean = true) => {
            const view = resolveSelectionBilingualViewState({
              bilingual: bilingualEnabled,
              sourceText: bilingualSourceText,
              labels: bilingualText,
            });
            sourceBox.textContent = view.sourceText;
            sourceBox.style.display = view.showSourceBlock ? "block" : "none";
            bilingualBtn.title = view.toggleLabel;
            bilingualBtn.setAttribute("aria-label", view.toggleLabel);
            bilingualBtn.setAttribute(
              "aria-pressed",
              view.togglePressed ? "true" : "false",
            );
            bilingualBtn.style.opacity = view.togglePressed ? "1" : "0.55";
            bilingualBtn.style.borderColor = view.togglePressed
              ? "var(--llm-theme-border, rgba(130,130,130,0.38))"
              : "transparent";
            bilingualBtn.style.background = view.togglePressed
              ? "var(--llm-theme-chip-bg, rgba(127,127,127,0.10))"
              : "transparent";
            selectionTranslateContentChanged?.(preservePosition);
          };
          bilingualBtn.addEventListener("click", (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            bilingualEnabled = setSelectionTranslateBilingualEnabled(
              toggleSelectionBilingual(bilingualEnabled),
            );
            applyBilingualState();
          });
          toolbar.appendChild(bilingualBtn);

          const resultBox = event.doc.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "div",
          ) as HTMLDivElement;
          resultBox.className = "llm-selection-translate-result";
          resultBox.tabIndex = 0;
          resultBox.textContent = text.translating;
          resultBox.style.cssText = [
            "display:block",
            "width:100%",
            "min-width:184px",
            `min-height:${minimumResultHeight}px`,
            "max-width:calc(100vw - 20px)",
            "max-height:min(320px, 42vh)",
            "overflow:auto",
            "resize:both",
            "box-sizing:border-box",
            "padding:10px 12px",
            "border:1px solid rgba(130,130,130,0.32)",
            "border-radius:8px",
            "outline:none",
            "outline-offset:-2px",
            "background:rgba(127,127,127,0.08)",
            "color:inherit",
            `font-size:${typography.selectionFontSize}px`,
            `line-height:${typography.selectionLineHeight}`,
            "white-space:pre-wrap",
            "overflow-wrap:anywhere",
            "cursor:text",
            "user-select:text",
            "-moz-user-select:text",
          ].join(";");
          const setResultBoxFocusRing = (focused: boolean) => {
            resultBox.style.outline = focused
              ? "2px solid var(--accent-blue8, #0a84ff)"
              : "none";
          };
          resultBox.addEventListener("focus", () => {
            setResultBoxFocusRing(true);
          });
          resultBox.addEventListener("blur", () => {
            setResultBoxFocusRing(false);
          });
          // Zotero's native selection popup is non-selectable and owns mouse
          // handlers on its outer rows. Keep events inside the result while
          // preserving their default behavior so normal text selection works.
          for (const eventName of [
            "pointerdown",
            "pointerup",
            "mousedown",
            "mouseup",
            "click",
            "selectstart",
            "dragstart",
          ]) {
            resultBox.addEventListener(eventName, (e: Event) => {
              e.stopPropagation();
            });
          }
          resultBox.addEventListener("mousedown", (e: MouseEvent) => {
            if (e.button !== 0) return;
            resultBox.focus({ preventScroll: true });
          });
          const setResultText = (
            value: string,
            preservePosition: boolean = false,
          ) => {
            try {
              resultBox.innerHTML = renderMarkdown(value);
            } catch {
              resultBox.textContent = value;
            }
            selectionTranslateContentChanged?.(preservePosition);
          };
          const actionRow = event.doc.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "div",
          ) as HTMLDivElement;
          actionRow.className = "llm-selection-translate-actions";
          actionRow.style.cssText = [
            "display:none",
            "width:100%",
            "align-items:center",
            "justify-content:flex-end",
            "flex-wrap:wrap",
            "gap:6px",
            "box-sizing:border-box",
          ].join(";");
          for (const eventName of [
            "pointerdown",
            "pointerup",
            "mousedown",
            "mouseup",
            "click",
          ]) {
            actionRow.addEventListener(eventName, (e: Event) => {
              e.stopPropagation();
            });
          }
          const copyBtn = event.doc.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "button",
          ) as HTMLButtonElement;
          copyBtn.className = "llm-selection-translate-copy-btn";
          copyBtn.type = "button";
          copyBtn.textContent = text.copy;
          copyBtn.title = text.copy;
          copyBtn.setAttribute("aria-label", text.copy);
          copyBtn.disabled = true;
          copyBtn.style.cssText = [
            "width:fit-content",
            "margin:0",
            "padding:5px 10px",
            "box-sizing:border-box",
            "border:1px solid rgba(130,130,130,0.38)",
            "border-radius:6px",
            "background:rgba(127,127,127,0.08)",
            "color:inherit",
            `font-size:${typography.selectionFontSize}px`,
            "line-height:1.25",
            "text-align:center",
            "white-space:nowrap",
            "cursor:pointer",
          ].join(";");
          const addToNoteBtn = event.doc.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "button",
          ) as HTMLButtonElement;
          addToNoteBtn.className = "llm-selection-translate-note-btn";
          addToNoteBtn.type = "button";
          addToNoteBtn.textContent = noteText.addToNote;
          addToNoteBtn.style.cssText = [
            "width:fit-content",
            "margin:0",
            "padding:5px 10px",
            "box-sizing:border-box",
            "border:1px solid rgba(130,130,130,0.38)",
            "border-radius:6px",
            "background:rgba(255,255,255,0.04)",
            "color:inherit",
            `font-size:${typography.selectionFontSize}px`,
            "line-height:1.25",
            "text-align:center",
            "white-space:nowrap",
            "cursor:pointer",
          ].join(";");
          const createStableButtonLabel = (
            button: HTMLButtonElement,
            labels: string[],
            initialLabel: string,
          ): ((label: string) => void) => {
            button.textContent = "";
            button.style.display = "inline-grid";
            button.style.placeItems = "center";
            for (const label of Array.from(new Set(labels))) {
              const spacer = event.doc.createElementNS(
                "http://www.w3.org/1999/xhtml",
                "span",
              ) as HTMLSpanElement;
              spacer.textContent = label;
              spacer.setAttribute("aria-hidden", "true");
              spacer.style.cssText = [
                "grid-area:1 / 1",
                "visibility:hidden",
                "pointer-events:none",
              ].join(";");
              button.appendChild(spacer);
            }
            const visibleLabel = event.doc.createElementNS(
              "http://www.w3.org/1999/xhtml",
              "span",
            ) as HTMLSpanElement;
            visibleLabel.style.gridArea = "1 / 1";
            button.appendChild(visibleLabel);
            const setLabel = (label: string) => {
              visibleLabel.textContent = label;
              button.title = label;
              button.setAttribute("aria-label", label);
            };
            setLabel(initialLabel);
            return setLabel;
          };
          const setCopyButtonLabel = createStableButtonLabel(
            copyBtn,
            [text.copy, text.copied],
            text.copy,
          );
          const setAddToNoteButtonLabel = createStableButtonLabel(
            addToNoteBtn,
            [
              noteText.addToNote,
              noteText.addingToNote,
              noteText.addedToNote,
              noteText.addToNoteFailed,
            ],
            noteText.addToNote,
          );
          if (showCopyButton) actionRow.appendChild(copyBtn);
          if (showAddToNoteButton) actionRow.appendChild(addToNoteBtn);
          wrap.append(toolbar, sourceBox, resultBox, actionRow);
          if (!autoTranslateEnabled && !quickActionsEnabled) {
            // No capsule to carry the action, so the popup needs a button of
            // its own or the translation would be unreachable.
            const manualTranslateBtn = createPopupActionButton(
              i18n.selectionTranslateAction,
              i18n.selectionTranslateManualHint,
              () => triggerPopupTranslate(),
            );
            manualTranslateBtn.style.flex = "1 1 auto";
            manualTranslateBtn.style.width = "100%";
            event.append(manualTranslateBtn);
            if (!popupSentinelEl) popupSentinelEl = manualTranslateBtn;
            stripPopupRowChrome(
              manualTranslateBtn.parentElement as HTMLElement | null,
            );
          }
          if (!autoTranslateEnabled) wrap.style.display = "none";
          event.append(wrap);
          if (!popupSentinelEl) popupSentinelEl = wrap;
          const wrapRow = wrap.parentElement as HTMLElement | null;
          stripPopupRowChrome(wrapRow, !autoTranslateEnabled);
          const popupWin = event.doc.defaultView;
          let contentSizeRevision = 0;
          const runOnNextPopupFrame = (callback: () => void) => {
            if (popupWin?.requestAnimationFrame) {
              popupWin.requestAnimationFrame(callback);
            } else {
              setTimeout(callback, 0);
            }
          };
          // While the panel is waiting to be asked for a translation it is
          // display:none, and measuring it would collapse the popup around a
          // zero-sized box — including the capsule row above it.
          const isTranslateWrapHidden = () => wrap.style.display === "none";
          selectionTranslateRelayout = () =>
            scheduleSelectionTranslateLayout({
              scheduleFrame: runOnNextPopupFrame,
              readLayoutState: () => ({
                doc: event.doc,
                popup: selectionPopup,
                wrap,
                resultBox,
                sourceBox,
                selectionRect,
                preferredWidth: currentPopupWidth,
                preferredHeight: currentPopupHeight,
                minimumHeight: minimumResultHeight,
              }),
              applyLayout(state) {
                if (isTranslateWrapHidden()) return;
                if (!resizeActive) layoutSelectionTranslatePopup(state);
              },
            });
          selectionTranslateContentChanged = (
            preservePosition: boolean = false,
          ) => {
            const revision = ++contentSizeRevision;
            const updatePopupSize = () => {
              if (
                revision !== contentSizeRevision ||
                !wrap.isConnected ||
                isTranslateWrapHidden() ||
                resizeActive
              ) {
                return;
              }
              layoutSelectionTranslatePopup({
                doc: event.doc,
                popup: selectionPopup,
                wrap,
                resultBox,
                sourceBox,
                selectionRect,
                preferredWidth: currentPopupWidth,
                preferredHeight: currentPopupHeight,
                minimumHeight: minimumResultHeight,
                reposition: !preservePosition,
              });

              const naturalHeight = measureSelectionTranslateNaturalHeight({
                wrap,
                resultBox,
                minimumHeight: minimumResultHeight,
              });
              const viewerHeight = getViewportRect(event.doc).height;
              currentPopupHeight = resolveSelectionTranslateContentHeight({
                contentHeight: naturalHeight,
                viewerHeight,
                minimumHeight: minimumResultHeight,
                rememberedHeight: rememberedPopupHeight,
              });
              layoutSelectionTranslatePopup({
                doc: event.doc,
                popup: selectionPopup,
                wrap,
                resultBox,
                sourceBox,
                selectionRect,
                preferredWidth: currentPopupWidth,
                preferredHeight: currentPopupHeight,
                minimumHeight: minimumResultHeight,
                reposition: !preservePosition,
              });
            };
            runOnNextPopupFrame(updatePopupSize);
          };
          const getSelectedResultText = (): string => {
            const selection = event.doc.getSelection?.();
            if (!selection || selection.rangeCount === 0) return "";
            const anchor = selection.anchorNode;
            const focus = selection.focusNode;
            const containsNode = (node: Node | null) =>
              Boolean(node && (node === resultBox || resultBox.contains(node)));
            if (!containsNode(anchor) || !containsNode(focus)) return "";
            return selection.toString().trim();
          };
          resultBox.addEventListener("keydown", (e: KeyboardEvent) => {
            if (!e.ctrlKey && !e.metaKey) return;
            const key = e.key.toLowerCase();
            if (key === "a") {
              const selection = event.doc.getSelection?.();
              if (!selection) return;
              const range = event.doc.createRange();
              range.selectNodeContents(resultBox);
              selection.removeAllRanges();
              selection.addRange(range);
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            if (key !== "c") return;
            const selectedResultText = getSelectedResultText();
            if (!selectedResultText) return;
            e.preventDefault();
            e.stopPropagation();
            void copyTextToClipboard(resultBox, selectedResultText);
          });

          let resizeActive = false;
          let resizeWidthMoved = false;
          let resizeHeightMoved = false;
          let resizeStartWidth = 0;
          let resizeStartHeight = 0;
          let resizeOriginalWidth = currentPopupWidth;
          let resizeOriginalHeight = currentPopupHeight;
          let resizeObserver: ResizeObserver | null = null;
          let resizePreviewFramePending = false;
          let resizeFinishTimer: ReturnType<typeof setTimeout> | null = null;
          let resizeWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
          const syncResizePreview = () => {
            if (!resizeActive) return;
            const width = Math.round(resultBox.offsetWidth);
            const height = Math.round(resultBox.offsetHeight);
            resizeWidthMoved ||= Math.abs(width - resizeStartWidth) > 1;
            resizeHeightMoved ||= Math.abs(height - resizeStartHeight) > 1;
            if (!resizeWidthMoved && !resizeHeightMoved) return;
            currentPopupWidth = width;
            currentPopupHeight = height;
            wrap.style.width = `${width}px`;
            clampSelectionPopupToViewport(event.doc, selectionPopup);
          };
          const scheduleResizePreview = () => {
            if (!resizeActive || resizePreviewFramePending) return;
            resizePreviewFramePending = true;
            runOnNextPopupFrame(() => {
              resizePreviewFramePending = false;
              syncResizePreview();
            });
          };
          const cleanupSelectionResize = () => {
            resizeObserver?.disconnect();
            resizeObserver = null;
            resultBox.removeEventListener("mousemove", onSelectionResizeMove);
            resultBox.removeEventListener(
              "mouseup",
              requestFinishSelectionResize,
              true,
            );
            resultBox.removeEventListener(
              "pointerup",
              requestFinishSelectionResize,
              true,
            );
            event.doc.removeEventListener("mousemove", onSelectionResizeMove);
            event.doc.removeEventListener(
              "mouseup",
              requestFinishSelectionResize,
              true,
            );
            event.doc.removeEventListener(
              "pointerup",
              requestFinishSelectionResize,
              true,
            );
            popupWin?.removeEventListener(
              "mouseup",
              requestFinishSelectionResize,
              true,
            );
            popupWin?.removeEventListener(
              "pointerup",
              requestFinishSelectionResize,
              true,
            );
            popupWin?.removeEventListener("blur", requestFinishSelectionResize);
            if (resizeWatchdogTimer !== null) {
              clearTimeout(resizeWatchdogTimer);
              resizeWatchdogTimer = null;
            }
          };
          const finishSelectionResize = () => {
            if (!resizeActive) return;
            if (!resultBox.isConnected || !wrap.isConnected) {
              resizeActive = false;
              cleanupSelectionResize();
              return;
            }
            syncResizePreview();
            resizeActive = false;
            cleanupSelectionResize();
            if (resizeWidthMoved) {
              currentPopupWidth = setSelectionTranslatePopupWidth(
                resultBox.offsetWidth,
              );
            } else {
              currentPopupWidth = resizeOriginalWidth;
            }
            if (resizeHeightMoved) {
              rememberedPopupHeight = setSelectionTranslatePopupHeight(
                resultBox.offsetHeight,
                minimumResultHeight,
              );
              currentPopupHeight = rememberedPopupHeight;
            } else {
              currentPopupHeight = resizeOriginalHeight;
            }
            selectionTranslateContentChanged?.(true);
          };
          const requestFinishSelectionResize = () => {
            if (!resizeActive || resizeFinishTimer !== null) return;
            // Gecko can commit the final native resize after mouseup dispatch.
            // Finish in a new task so offsetWidth/offsetHeight are final.
            resizeFinishTimer = setTimeout(() => {
              resizeFinishTimer = null;
              finishSelectionResize();
            }, 0);
          };
          const onSelectionResizeMove = (e: MouseEvent) => {
            if (!resizeActive) return;
            if ((e.buttons & 1) === 0) {
              requestFinishSelectionResize();
              return;
            }
            scheduleResizePreview();
          };
          const isInSelectionResizeGrip = (e: MouseEvent): boolean => {
            const rect = resultBox.getBoundingClientRect();
            const gripSize = 18;
            return (
              rect.right - e.clientX >= 0 &&
              rect.right - e.clientX <= gripSize &&
              rect.bottom - e.clientY >= 0 &&
              rect.bottom - e.clientY <= gripSize
            );
          };
          resultBox.addEventListener("mousemove", (e: MouseEvent) => {
            if (resizeActive) return;
            resultBox.style.cursor = isInSelectionResizeGrip(e)
              ? "nwse-resize"
              : "text";
          });
          resultBox.addEventListener("mouseleave", () => {
            if (!resizeActive) resultBox.style.cursor = "text";
          });
          resultBox.addEventListener("mousedown", (e: MouseEvent) => {
            if (e.button !== 0) return;
            if (resizeActive) return;
            if (!isInSelectionResizeGrip(e)) return;
            contentSizeRevision += 1;
            resizeActive = true;
            resizeWidthMoved = false;
            resizeHeightMoved = false;
            resizeStartWidth = Math.round(resultBox.offsetWidth);
            resizeStartHeight = Math.round(resultBox.offsetHeight);
            resizeOriginalWidth = currentPopupWidth;
            resizeOriginalHeight = currentPopupHeight;
            resultBox.style.width = `${resizeStartWidth}px`;
            resultBox.style.height = `${resizeStartHeight}px`;
            const viewport = getViewportRect(event.doc);
            const widthBounds = getPanelTypographyBounds().selectionPopupWidth;
            resultBox.style.maxWidth = `${Math.max(
              widthBounds.min,
              Math.min(widthBounds.max, viewport.width - 20),
            )}px`;
            resultBox.style.maxHeight = `${getSelectionTranslateAvailableResultHeight(
              {
                viewportHeight: viewport.height,
                popup: selectionPopup,
                resultBox,
                minimumHeight: minimumResultHeight,
              },
            )}px`;
            const ResizeObserverCtor = popupWin?.ResizeObserver;
            if (typeof ResizeObserverCtor === "function") {
              const observer = new ResizeObserverCtor(scheduleResizePreview);
              observer.observe(resultBox);
              resizeObserver = observer;
            }
            resultBox.addEventListener("mousemove", onSelectionResizeMove);
            resultBox.addEventListener(
              "mouseup",
              requestFinishSelectionResize,
              true,
            );
            resultBox.addEventListener(
              "pointerup",
              requestFinishSelectionResize,
              true,
            );
            event.doc.addEventListener("mousemove", onSelectionResizeMove);
            event.doc.addEventListener(
              "mouseup",
              requestFinishSelectionResize,
              true,
            );
            event.doc.addEventListener(
              "pointerup",
              requestFinishSelectionResize,
              true,
            );
            popupWin?.addEventListener(
              "mouseup",
              requestFinishSelectionResize,
              true,
            );
            popupWin?.addEventListener(
              "pointerup",
              requestFinishSelectionResize,
              true,
            );
            popupWin?.addEventListener("blur", requestFinishSelectionResize);
            resizeWatchdogTimer = setTimeout(
              requestFinishSelectionResize,
              30_000,
            );
          });

          const refreshSelectionTypography = () => {
            if (!wrap.isConnected) {
              removeSelectionTypographyListeners();
              return;
            }
            const nextTypography = getPanelTypographySettings();
            currentPopupWidth = nextTypography.selectionPopupWidth;
            minimumResultHeight = calculateMinimumResultHeight(nextTypography);
            resultBox.style.minHeight = `${minimumResultHeight}px`;
            resultBox.style.fontSize = `${nextTypography.selectionFontSize}px`;
            resultBox.style.lineHeight = String(
              nextTypography.selectionLineHeight,
            );
            sourceBox.style.fontSize = `${Math.max(
              10,
              nextTypography.selectionFontSize - 1,
            )}px`;
            sourceBox.style.lineHeight = String(
              nextTypography.selectionLineHeight,
            );
            copyBtn.style.fontSize = `${nextTypography.selectionFontSize}px`;
            copyBtn.style.lineHeight = "1.25";
            addToNoteBtn.style.fontSize = `${nextTypography.selectionFontSize}px`;
            addToNoteBtn.style.lineHeight = "1.25";
            selectionTranslateContentChanged?.();
          };
          const selectionTypographyRefreshTargets: Window[] = [];
          const removeSelectionTypographyListeners = () => {
            for (const target of selectionTypographyRefreshTargets.splice(0)) {
              target.removeEventListener(
                PANEL_TYPOGRAPHY_REFRESH_EVENT,
                refreshSelectionTypography,
              );
            }
            selectionTypographyCleanupByEvent.delete(event);
          };
          const addSelectionTypographyRefreshTarget = (
            target: Window | null | undefined,
          ) => {
            if (!target || selectionTypographyRefreshTargets.includes(target))
              return;
            target.addEventListener(
              PANEL_TYPOGRAPHY_REFRESH_EVENT,
              refreshSelectionTypography,
            );
            selectionTypographyRefreshTargets.push(target);
          };
          addSelectionTypographyRefreshTarget(popupWin);
          try {
            addSelectionTypographyRefreshTarget(
              Zotero.getMainWindow?.() || null,
            );
          } catch {
            /* ignore */
          }
          try {
            const mainWindows: Window[] = Zotero.getMainWindows?.() || [];
            for (const mainWindow of mainWindows) {
              addSelectionTypographyRefreshTarget(mainWindow);
            }
          } catch {
            /* ignore */
          }
          selectionTypographyCleanupByEvent.set(
            event,
            removeSelectionTypographyListeners,
          );
          applyBilingualState(false);
          selectionTranslateContentChanged();

          let latestSelectionTranslation: {
            selectedText: string;
            translation: string;
            model: string;
            provider?: string;
          } | null = null;
          let translateRunning = false;
          let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
          const resetCopyFeedback = () => {
            if (copyFeedbackTimer !== null) {
              clearTimeout(copyFeedbackTimer);
              copyFeedbackTimer = null;
            }
            setCopyButtonLabel(text.copy);
            copyBtn.disabled = !latestSelectionTranslation;
          };
          copyBtn.addEventListener("click", async (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            const current = latestSelectionTranslation;
            if (!current?.translation.trim()) return;
            copyBtn.disabled = true;
            await copyTextToClipboard(wrap, current.translation);
            setCopyButtonLabel(text.copied);
            copyFeedbackTimer = setTimeout(() => {
              copyFeedbackTimer = null;
              if (!wrap.isConnected) return;
              setCopyButtonLabel(text.copy);
              copyBtn.disabled = !latestSelectionTranslation;
            }, 1400);
          });
          addToNoteBtn.addEventListener("click", async (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            if (!item || !latestSelectionTranslation) return;
            addToNoteBtn.disabled = true;
            setAddToNoteButtonLabel(noteText.addingToNote);
            try {
              await appendSelectionTranslationToNote(item, {
                ...latestSelectionTranslation,
                pageLabel: resolveSelectionPageLabel(),
              });
              setAddToNoteButtonLabel(noteText.addedToNote);
            } catch (err) {
              ztoolkit.log(
                "LLM: add selection translation to note failed",
                err,
              );
              addToNoteBtn.disabled = false;
              setAddToNoteButtonLabel(noteText.addToNoteFailed);
            }
          });
          const runSelectionTranslate = async () => {
            if (translateRunning) return;
            translateRunning = true;
            let popupStream: ReturnType<
              typeof createSelectionTranslatePopupStream
            > | null = null;
            let receivedStreamingContent = false;
            latestSelectionTranslation = null;
            resetCopyFeedback();
            actionRow.style.display = "none";
            addToNoteBtn.disabled = true;
            setAddToNoteButtonLabel(noteText.addToNote);
            try {
              const effectiveSelectedText =
                normalizeSelectedText(selectedText) ||
                resolveSelectedTextForPopupAction();
              if (effectiveSelectedText !== bilingualSourceText) {
                // The popup may have opened before the reader settled on a
                // selection; the source block follows whatever was translated.
                bilingualSourceText = effectiveSelectedText;
                applyBilingualState();
              }
              if (!item || !effectiveSelectedText) {
                resultBox.textContent = text.failed;
                selectionTranslateContentChanged?.();
                return;
              }
              popupStream = createSelectionTranslatePopupStream({
                scheduleFrame: runOnNextPopupFrame,
                render(value) {
                  if (!wrap.isConnected) return;
                  setResultText(value, true);
                },
              });
              const result = await translateSelectedTextForReader({
                item,
                selectedText: effectiveSelectedText,
                callbacks: {
                  onStage(stage) {
                    resultBox.textContent =
                      stage === "cold-start"
                        ? text.coldStart
                        : text.translating;
                    selectionTranslateContentChanged?.();
                  },
                  onDelta(delta) {
                    if (!delta) return;
                    receivedStreamingContent = true;
                    popupStream?.push(delta);
                  },
                },
              });
              popupStream.invalidate();
              popupStream = null;
              if (!result.translation.trim()) {
                resultBox.textContent = text.failed;
                selectionTranslateContentChanged?.(receivedStreamingContent);
                return;
              }
              latestSelectionTranslation = {
                selectedText: effectiveSelectedText,
                translation: result.translation,
                model: result.model,
                provider: result.provider,
              };
              copyBtn.disabled = false;
              addToNoteBtn.disabled = false;
              setAddToNoteButtonLabel(noteText.addToNote);
              actionRow.style.display = hasVisibleSelectionTranslateActions
                ? "flex"
                : "none";
              setResultText(result.translation, receivedStreamingContent);
            } catch (err) {
              popupStream?.invalidate();
              popupStream = null;
              ztoolkit.log("LLM: selection translation failed", err);
              resultBox.textContent = `${text.failed}: ${
                err instanceof Error ? err.message : String(err)
              }`;
              selectionTranslateContentChanged?.(receivedStreamingContent);
            } finally {
              popupStream?.invalidate();
              translateRunning = false;
            }
          };
          runPopupSelectionTranslate = runSelectionTranslate;
          setActiveSelectionPopupTranslate({
            node: wrap,
            reveal: () => revealSelectionTranslateWrap?.(),
            run: runSelectionTranslate,
          });
          revealSelectionTranslateWrap = () => {
            if (wrap.style.display !== "none") return;
            wrap.style.display = "flex";
            if (wrapRow) wrapRow.style.display = "";
            stripPopupRowChrome(wrapRow);
            selectionTranslateContentChanged?.();
            selectionTranslateRelayout?.();
          };
          if (autoTranslateEnabled) {
            setTimeout(() => void runSelectionTranslate(), 0);
          }
        } catch (err) {
          ztoolkit.log("LLM: failed to append selection translate popup", err);
        }
      }

      if (showAddTextInPopup) {
        try {
          const addTextBtn = event.doc.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "button",
          ) as HTMLButtonElement;
          addTextBtn.type = "button";
          addTextBtn.textContent = i18n.addText;
          addTextBtn.title = i18n.addTextPopupTitle;
          addTextBtn.style.cssText = [
            "display:block",
            "width:100%",
            "margin:0",
            "padding:6px 8px",
            "box-sizing:border-box",
            "border:1px solid rgba(130,130,130,0.38)",
            "border-radius:6px",
            "background:rgba(255,255,255,0.04)",
            // Keep text readable across light/dark themes.
            "color:inherit",
            "font-size:12px",
            "line-height:1.25",
            "text-align:center",
            "cursor:pointer",
          ].join(";");
          let addTextHandled = false;
          const handleAddTextAction = (e: Event) => {
            if (addTextHandled) return;
            addTextHandled = true;
            e.preventDefault();
            e.stopPropagation();
            void addTextToPanel();
          };
          const isPrimaryButton = (e: Event): boolean => {
            const maybeMouse = e as MouseEvent;
            return (
              typeof maybeMouse.button !== "number" || maybeMouse.button === 0
            );
          };
          // Reader popup items may be removed before "click" fires.
          // Handle early pointer/mouse down as the primary trigger.
          addTextBtn.addEventListener("pointerdown", (e: Event) => {
            if (!isPrimaryButton(e)) return;
            handleAddTextAction(e);
          });
          addTextBtn.addEventListener("mousedown", (e: Event) => {
            if (!isPrimaryButton(e)) return;
            handleAddTextAction(e);
          });
          addTextBtn.addEventListener("click", handleAddTextAction);
          addTextBtn.addEventListener("command", handleAddTextAction);
          event.append(addTextBtn);
          popupSentinelEl = addTextBtn;
          stripPopupRowChrome(addTextBtn.parentElement as HTMLElement | null);
          selectionTranslateRelayout?.();
        } catch (err) {
          ztoolkit.log("LLM: failed to append Add Text popup button", err);
        }
      }

      if (selectedText) {
        for (const key of keys) {
          recentReaderSelectionCache.set(key, selectedText);
        }
      } else {
        for (const key of keys) {
          recentReaderSelectionCache.delete(key);
        }
      }

      if (selectedText) {
        try {
          let sentinel = popupSentinelEl;
          if (!sentinel) {
            const fallback = event.doc.createElementNS(
              "http://www.w3.org/1999/xhtml",
              "span",
            ) as HTMLSpanElement;
            fallback.style.display = "none";
            event.append(fallback);
            stripPopupRowChrome(
              fallback.parentElement as HTMLElement | null,
              true,
            );
            sentinel = fallback;
          }

          let wasConnected = false;
          let checks = 0;
          const maxChecks = 600;

          const watchSentinel = () => {
            if (++checks > maxChecks) return;
            if (sentinel.isConnected) {
              wasConnected = true;
              setTimeout(watchSentinel, 500);
              return;
            }
            if (!wasConnected && checks <= 6) {
              setTimeout(watchSentinel, 200);
              return;
            }
            if (!wasConnected) {
              // Popup never made it into the DOM — dispose its typography
              // refresh listeners instead of waiting for a refresh event.
              selectionTypographyCleanupByEvent.get(event)?.();
              clearActiveSelectionPopupTranslate();
              return;
            }
            // Popup is gone — dispose its typography refresh listeners and
            // drop the recent-selection cache entries for it.
            selectionTypographyCleanupByEvent.get(event)?.();
            clearActiveSelectionPopupTranslate();
            for (const key of keys) {
              if (recentReaderSelectionCache.get(key) === selectedText) {
                recentReaderSelectionCache.delete(key);
              }
            }
          };
          setTimeout(watchSentinel, 100);
        } catch (_err) {
          ztoolkit.log("LLM: selection popup sentinel failed", _err);
        }
      }
    } else {
      for (const key of keys) {
        recentReaderSelectionCache.delete(key);
      }
    }
  };

  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    handler,
    config.addonID,
  );
  readerSelectionPopupHandler = handler;
  readerAPI.__llmSelectionTrackingHandler = handler;
  readerAPI.__llmSelectionTrackingRegistered = true;
}

export function unregisterReaderSelectionTracking() {
  const readerAPI = Zotero.Reader as
    | (_ZoteroTypes.Reader & {
        __llmSelectionTrackingRegistered?: boolean;
        __llmSelectionTrackingHandler?: ReaderSelectionPopupHandler | null;
      })
    | undefined;
  if (!readerAPI) return;
  const handler =
    readerSelectionPopupHandler || readerAPI.__llmSelectionTrackingHandler;
  if (handler) {
    try {
      Zotero.Reader.unregisterEventListener(
        "renderTextSelectionPopup",
        handler,
      );
    } catch (_err) {
      void _err;
    }
  }
  readerSelectionPopupHandler = null;
  readerAPI.__llmSelectionTrackingHandler = null;
  readerAPI.__llmSelectionTrackingRegistered = false;
  recentReaderSelectionCache.clear();
}

export function clearConversation(itemId: number) {
  chatHistory.delete(itemId);
  conversationContextPool.delete(itemId);
  zoneBSummaryCache.delete(itemId);
  loadedConversationKeys.add(itemId);
  void clearStoredConversation(itemId).catch((err) => {
    ztoolkit.log("LLM: Failed to clear persisted chat history", err);
  });
  void clearOwnerAttachmentRefs("conversation", itemId).catch((err) => {
    ztoolkit.log(
      "LLM: Failed to clear persisted conversation attachment refs",
      err,
    );
  });
  void collectAndDeleteUnreferencedBlobs(ATTACHMENT_GC_MIN_AGE_MS).catch(
    (err) => {
      ztoolkit.log("LLM: Failed to collect unreferenced attachment blobs", err);
    },
  );
}

export function getConversationHistory(itemId: number): Message[] {
  return chatHistory.get(itemId) || [];
}
