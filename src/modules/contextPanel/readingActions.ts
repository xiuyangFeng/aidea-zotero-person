/**
 * Reading actions — one bridge from a passage the reader selected to the panel.
 *
 * Two halves that are deliberately separable:
 *
 *  - `buildReadingActionPrompt` is pure. It turns a kind plus a passage into
 *    the prompt text, using the existing prompt builders in `src/utils`, and is
 *    unit-tested without a Zotero runtime.
 *  - `dispatchReadingAction` is the panel side. It finds the AIdea panel that
 *    belongs to the active reader, pins the passage the way the popup's
 *    "Add Text" button does, drops the prompt into the composer and sends it,
 *    then brings the panel into view.
 *
 * Nothing here knows about the selection popup, so the panel's own menus can
 * call `dispatchReadingAction` with exactly the same arguments.
 */

import {
  buildAlgorithmWalkthroughPrompt,
  extractAlgorithms,
} from "../../utils/algorithmWalkthrough";
import {
  buildConceptDefinitionPrompt,
  CONCEPT_TERM_MAX_CHARS,
  normalizeConceptTerm,
} from "../../utils/conceptCards";
import { buildCriticalReviewPrompt } from "../../utils/criticalReview";
import {
  buildFormulaBreakdownPrompt,
  extractFormulas,
} from "../../utils/formulaBreakdown";
import { buildSentenceDissectorPrompt } from "../../utils/sentenceDissector";
import { getZoteroItem } from "../../utils/zoteroItems";
import { buildTableInsightPrompt } from "../../utils/tableInsight";
import { GLOBAL_CONVERSATION_KEY_BASE, PANE_ID } from "./constants";
import { TRANSLATION_LANGUAGE_OPTIONS } from "./languages";
import { getStringPref } from "./prefHelpers";
import {
  appendSelectedTextContextForItem,
  applySelectedTextPreview,
} from "./contextResolution";
import { getPanelI18n, getPanelLang } from "./i18n";
import { resolvePaperContextRefFromAttachment } from "./paperAttribution";
import {
  bootstrapSharedReaderPanel,
  getSharedReaderPanelHostForItem,
} from "./readerPanel";
import {
  activeConversationModeByLibrary,
  activeGlobalConversationByLibrary,
  isPanelGenerating,
} from "./state";
import { normalizeSelectedText, setStatus } from "./textUtils";
import type { PaperContextRef } from "./types";

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

/**
 * The reading actions a passage can be handed to.
 *
 * Deliberately identical to `CapsuleActionKind` in `src/utils/quickCapsule.ts`
 * so a recommendation from `recommendCapsuleActions()` can be dispatched as-is.
 */
export type ReadingActionKind =
  | "explain"
  | "dissect"
  | "formula"
  | "algorithm"
  | "table"
  | "review"
  | "concept"
  | "translate";

export const READING_ACTION_KINDS: readonly ReadingActionKind[] = [
  "translate",
  "explain",
  "dissect",
  "concept",
  "formula",
  "algorithm",
  "table",
  "review",
];

export function isReadingActionKind(
  value: unknown,
): value is ReadingActionKind {
  return (
    typeof value === "string" &&
    READING_ACTION_KINDS.includes(value as ReadingActionKind)
  );
}

// ---------------------------------------------------------------------------
// Prompt construction (pure)
// ---------------------------------------------------------------------------

export interface BuildReadingActionPromptOptions {
  /** The passage the reader selected. */
  selectedText: string;
  /** Panel language; anything starting with `zh` selects the Chinese copy. */
  lang?: string;
  /** Title of the paper the passage came from, when one is known. */
  paperTitle?: string;
  /** Human-readable target language for the `translate` fallback prompt. */
  targetLanguage?: string;
}

type ReadingActionPromptLang = "en-US" | "zh-CN";

function resolvePromptLang(
  lang: string | null | undefined,
): ReadingActionPromptLang {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

/**
 * The short built-in "explain this" prompt.
 *
 * Kept deliberately small: the point of this action is a fast, readable answer
 * about one passage, so it asks for the paper's own terminology and caps the
 * length rather than inviting a structured report like the other builders do.
 */
function buildExplainPrompt(
  selectedText: string,
  lang: ReadingActionPromptLang,
  paperTitle?: string,
): string {
  const passage = selectedText.trim();
  if (lang === "zh-CN") {
    const paperLine = paperTitle?.trim()
      ? `\n\n**所在论文**：《${paperTitle.trim()}》`
      : "";
    return [
      "请用通俗易懂的大白话解释下面这段论文原文的意思。",
      "",
      "**待解释片段**：",
      `"""\n${passage}\n"""${paperLine}`,
      "",
      "## 要求：",
      "1. 结合当前论文的语境来解释，保留论文本身使用的术语（首次出现时用一句话说明该术语指什么）。",
      "2. 先给一句话结论，再补充必要的展开；能打比方就打比方。",
      "3. 不要逐句翻译，也不要罗列与该片段无关的背景。",
      "4. 全文控制在 300 字以内。",
    ].join("\n");
  }
  const paperLine = paperTitle?.trim()
    ? `\n\n**From the paper**: "${paperTitle.trim()}"`
    : "";
  return [
    "Explain the following passage from this paper in plain language.",
    "",
    "**Passage**:",
    `"""\n${passage}\n"""${paperLine}`,
    "",
    "## Requirements:",
    "1. Explain it in the context of this paper and keep the paper's own terminology, glossing each term once when it first appears.",
    "2. Lead with a one-sentence answer, then add only the elaboration that is needed; use an analogy where one helps.",
    "3. Do not translate sentence by sentence, and do not add background unrelated to the passage.",
    "4. Keep the whole answer under 200 words.",
  ].join("\n");
}

/**
 * Fallback translation prompt for the panel.
 *
 * The selection popup does its own streaming translation; this is only used
 * when a translate action is dispatched with no popup to render into, e.g.
 * from a hotkey pressed while the popup is already dismissed.
 */
function buildTranslatePrompt(
  selectedText: string,
  lang: ReadingActionPromptLang,
  targetLanguage?: string,
): string {
  const passage = selectedText.trim();
  if (lang === "zh-CN") {
    const target = targetLanguage?.trim() || "简体中文";
    return [
      `请把下面这段论文原文翻译成${target}。`,
      "",
      `"""\n${passage}\n"""`,
      "",
      "## 要求：",
      "1. 保持学术书面语体，术语按本领域通行译法处理，拿不准的术语在括号内保留原文。",
      "2. 只输出译文，不要解释，不要添加原文没有的内容。",
    ].join("\n");
  }
  const target = targetLanguage?.trim() || "English";
  return [
    `Translate the following passage from this paper into ${target}.`,
    "",
    `"""\n${passage}\n"""`,
    "",
    "## Requirements:",
    "1. Keep an academic register and use the field's standard rendering for each term, leaving the original in parentheses where a term is ambiguous.",
    "2. Output the translation only — no commentary, and nothing the source does not say.",
  ].join("\n");
}

/**
 * Build the prompt one reading action sends for one passage.
 *
 * Returns an empty string when the passage cannot drive that action at all
 * (an empty selection, or a `concept` request whose text is not a term), which
 * the caller reports rather than sending.
 */
export function buildReadingActionPrompt(
  kind: ReadingActionKind,
  options: BuildReadingActionPromptOptions,
): string {
  const selectedText = String(options.selectedText || "").trim();
  if (!selectedText) return "";
  const lang = resolvePromptLang(options.lang);
  const paperTitle = options.paperTitle?.trim() || "";

  switch (kind) {
    case "explain":
      return buildExplainPrompt(selectedText, lang, paperTitle);
    case "translate":
      return buildTranslatePrompt(selectedText, lang, options.targetLanguage);
    case "dissect":
      return buildSentenceDissectorPrompt({
        sentence: selectedText,
        lang,
      });
    case "formula": {
      // A selection usually carries the sentence around the equation. Send the
      // equation as the subject and the rest as context, so the breakdown is
      // about the formula but still knows what the symbols denote here.
      const formula = extractFormulas(selectedText)[0] || selectedText;
      const contextPassage =
        formula.trim() === selectedText ? undefined : selectedText;
      return buildFormulaBreakdownPrompt({
        formula,
        contextPassage,
        lang,
      });
    }
    case "algorithm": {
      const algorithmText = extractAlgorithms(selectedText)[0] || selectedText;
      const paperContext =
        algorithmText.trim() === selectedText ? undefined : selectedText;
      return buildAlgorithmWalkthroughPrompt({
        algorithmText,
        paperContext,
        lang,
      });
    }
    case "table":
      return buildTableInsightPrompt({
        tableContent: selectedText,
        paperContext: paperTitle || undefined,
        lang,
      });
    case "review":
      // Reviewing one passage, not a whole paper: the passage is the content,
      // and the paper title is only there to name what is being reviewed.
      return buildCriticalReviewPrompt({
        paperTitle:
          paperTitle || (lang === "zh-CN" ? "选中片段" : "this paper"),
        paperContent: selectedText,
        lang,
      });
    case "concept": {
      // A candidate longer than a term can be is a passage, not a term — the
      // same rule the panel's own "record a concept" action applies.
      const term = normalizeConceptTerm(selectedText);
      if (!term || term.length > CONCEPT_TERM_MAX_CHARS) return "";
      return buildConceptDefinitionPrompt({ term, lang });
    }
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Panel resolution — the shared "Add Text" bridge
// ---------------------------------------------------------------------------

type PanelRootState = {
  root: HTMLDivElement;
  panelItemId: number | null;
  panelLibraryId: number | null;
  conversationKey: number | null;
  visible: boolean;
  sameDoc: boolean;
  sameLibrary: boolean;
  matchesReaderPaper: boolean;
  matchesLockedGlobal: boolean;
  hasActiveFocus: boolean;
  isPreferredReaderRoot: boolean;
};

export interface ResolvedReadingPanel {
  /** The `#llm-main` element of the winning panel. */
  panelRoot: HTMLDivElement;
  /** The panel host — the element every panel-state helper is keyed by. */
  panelBody: HTMLElement;
  /** `#llm-status` inside the winning panel, when it has one. */
  status: HTMLElement | null;
  conversationKey: number;
  isGlobalConversation: boolean;
  /** Paper the active reader is showing, when it could be attributed. */
  readerPaperContext: PaperContextRef | null;
  /**
   * True when a paper-mode panel is showing a different paper than the reader.
   * Such a panel must not take text from this reader.
   */
  paperMismatch: boolean;
  /** Every panel host currently bound to the same conversation. */
  siblingBodies: HTMLElement[];
}

function isVisibleRoot(root: HTMLElement): boolean {
  try {
    return root.getClientRects().length > 0;
  } catch {
    return false;
  }
}

function readPositiveInt(value: unknown): number | null {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

/**
 * Rank the candidate panels and pick the one this reader's text belongs in.
 *
 * The ordering is the one the popup's Add Text button has always used:
 * a panel bootstrapped for this very reader item wins outright; otherwise a
 * visible, focused panel in the popup's own window beats a background one, and
 * a panel already locked to this conversation beats an unrelated one.
 */
function scorePanelState(state: PanelRootState): number {
  if (state.isPreferredReaderRoot) return 100;
  if (state.sameDoc && state.visible && state.hasActiveFocus) return 8;
  if (state.visible && state.hasActiveFocus) return 7;
  if (state.sameDoc && state.visible && state.matchesLockedGlobal) return 6.5;
  if (state.sameDoc && state.visible && state.matchesReaderPaper) return 6;
  if (state.sameDoc && state.visible) return 5;
  if (state.visible && state.matchesLockedGlobal) return 4.5;
  if (state.visible && state.matchesReaderPaper) return 4;
  if (state.visible) return 3;
  if (state.sameDoc) return 2;
  if (state.hasActiveFocus) return 1;
  return 0;
}

/**
 * Every `#llm-main` reachable from here, most relevant first.
 *
 * The popup runs inside a reader iframe whose document holds no panel, so the
 * search has to climb to the top window and then across every main window: a
 * second Zotero window may be the one showing the panel that should answer.
 */
function collectPanelRoots(
  eventDoc: Document | null,
  preferredPanelRoot: HTMLDivElement | null,
): HTMLDivElement[] {
  const docs = new Set<Document>();
  const pushDoc = (doc?: Document | null) => {
    if (doc) docs.add(doc);
  };
  pushDoc(eventDoc);
  pushDoc(eventDoc?.defaultView?.top?.document || null);
  try {
    pushDoc(Zotero.getMainWindow()?.document || null);
  } catch (_err) {
    void _err;
  }
  try {
    const wins = Zotero.getMainWindows?.() || [];
    for (const win of wins) {
      pushDoc(win?.document || null);
    }
  } catch (_err) {
    void _err;
  }

  const panelRoots: HTMLDivElement[] = [];
  const seenRoots = new Set<Element>();
  if (preferredPanelRoot) {
    seenRoots.add(preferredPanelRoot);
    panelRoots.push(preferredPanelRoot);
  }
  for (const doc of docs) {
    const roots = Array.from(
      doc.querySelectorAll("#llm-main"),
    ) as HTMLDivElement[];
    for (const root of roots) {
      if (seenRoots.has(root)) continue;
      seenRoots.add(root);
      panelRoots.push(root);
    }
  }
  return panelRoots;
}

export interface ResolveReadingPanelOptions {
  /**
   * Document the request came from — a reader iframe document for the
   * selection popup, the main window document for a hotkey.
   */
  doc?: Document | null;
  /** The reader attachment whose panel should be preferred. */
  item?: Zotero.Item | null;
}

/**
 * Find the AIdea panel that should receive text from the active reader.
 *
 * Bootstraps the reader's own cached panel first so a reader tab whose panel
 * has never been rendered still has somewhere to put the passage.
 */
export async function resolveReadingPanel(
  options: ResolveReadingPanelOptions,
): Promise<ResolvedReadingPanel | null> {
  const eventDoc = options.doc || null;
  const item = options.item || null;

  let preferredPanelRoot: HTMLDivElement | null = null;
  const readerWin = (eventDoc?.defaultView?.top || null) as Window | null;
  if (readerWin && item) {
    try {
      const host = getSharedReaderPanelHostForItem(readerWin, item);
      await bootstrapSharedReaderPanel(readerWin, host, item);
      preferredPanelRoot = host.querySelector(
        "#llm-main",
      ) as HTMLDivElement | null;
    } catch (err) {
      ztoolkit.log("LLM: reading action reader panel bootstrap failed", err);
    }
  }

  const panelRoots = collectPanelRoots(eventDoc, preferredPanelRoot);
  if (!panelRoots.length) return null;

  const normalizedReaderLibraryID = readPositiveInt(item?.libraryID) || 0;
  const readerModeLock =
    normalizedReaderLibraryID > 0
      ? activeConversationModeByLibrary.get(normalizedReaderLibraryID)
      : null;
  const readerGlobalConversationKey =
    readerModeLock === "global" && normalizedReaderLibraryID > 0
      ? readPositiveInt(
          activeGlobalConversationByLibrary.get(normalizedReaderLibraryID),
        ) || 0
      : 0;
  const readerPaperContext = resolvePaperContextRefFromAttachment(item);
  const readerPaperConversationKey =
    readerPaperContext && Number.isFinite(readerPaperContext.itemId)
      ? Math.floor(readerPaperContext.itemId)
      : 0;

  const getPanelLibraryId = (root: HTMLDivElement): number | null =>
    readPositiveInt(root.dataset.libraryId);
  const resolvePanelConversationKey = (
    root: HTMLDivElement,
    panelItemId: number | null,
  ): number | null => {
    if (!panelItemId) return null;
    const libraryID = getPanelLibraryId(root);
    if (libraryID) {
      const mode = activeConversationModeByLibrary.get(libraryID);
      if (mode === "global") {
        const lockedGlobal = readPositiveInt(
          activeGlobalConversationByLibrary.get(libraryID),
        );
        if (lockedGlobal) return lockedGlobal;
      }
    }
    if (
      readerGlobalConversationKey > 0 &&
      panelItemId < GLOBAL_CONVERSATION_KEY_BASE
    ) {
      return readerGlobalConversationKey;
    }
    return panelItemId;
  };

  const popupTopDoc = eventDoc?.defaultView?.top?.document || null;
  const rootStates = panelRoots
    .map((root): PanelRootState => {
      const ownerDoc = root.ownerDocument;
      const panelItemId = readPositiveInt(root.dataset.itemId);
      const panelLibraryId = getPanelLibraryId(root);
      const conversationKey = resolvePanelConversationKey(root, panelItemId);
      return {
        root,
        panelItemId,
        panelLibraryId,
        conversationKey,
        visible: isVisibleRoot(root),
        sameDoc: popupTopDoc ? ownerDoc === popupTopDoc : false,
        sameLibrary:
          normalizedReaderLibraryID > 0 &&
          panelLibraryId === normalizedReaderLibraryID,
        matchesReaderPaper:
          readerPaperConversationKey > 0 &&
          conversationKey === readerPaperConversationKey,
        matchesLockedGlobal:
          readerGlobalConversationKey > 0 &&
          conversationKey === readerGlobalConversationKey,
        hasActiveFocus: Boolean(
          ownerDoc?.activeElement && root.contains(ownerDoc.activeElement),
        ),
        isPreferredReaderRoot: root === preferredPanelRoot,
      };
    })
    .filter((state) => state.panelItemId !== null && state.conversationKey);
  if (!rootStates.length) return null;

  const preferredStates = rootStates.filter(
    (state) => state.isPreferredReaderRoot,
  );
  const sameLibraryStates =
    normalizedReaderLibraryID > 0
      ? rootStates.filter((state) => state.sameLibrary)
      : [];
  const rankedStates = preferredStates.length
    ? preferredStates
    : sameLibraryStates.length
      ? sameLibraryStates
      : rootStates;

  let bestState = rankedStates[0];
  let bestScore = scorePanelState(bestState);
  for (const state of rankedStates.slice(1)) {
    const score = scorePanelState(state);
    if (score > bestScore) {
      bestState = state;
      bestScore = score;
    }
  }

  const panelRoot = bestState.root;
  const conversationKey = bestState.conversationKey as number;
  const isGlobalConversation = conversationKey >= GLOBAL_CONVERSATION_KEY_BASE;
  // Compare using the Zotero item/parent IDs, NOT the conversation key which
  // lives in the paper-conversation numeric range.
  const readerItemId = Number(item?.id || 0);
  const readerParentId = Number(item?.parentID || 0);
  // With no reader item there is nothing to compare against, and refusing
  // everything would make the panel's own menus and the hotkeys useless in the
  // library. The selection popup always supplies one, so its behavior here is
  // unchanged.
  const paperMismatch =
    !isGlobalConversation &&
    Boolean(item) &&
    (!readerPaperContext ||
      (readerPaperContext.itemId !== readerItemId &&
        readerPaperContext.itemId !== readerParentId));

  const panelBody = (panelRoot.parentElement || panelRoot) as HTMLElement;
  const siblingBodies = rootStates
    .filter((state) => (state.conversationKey as number) === conversationKey)
    .map((state) => (state.root.parentElement || state.root) as HTMLElement);

  return {
    panelRoot,
    panelBody,
    status: panelBody.querySelector("#llm-status") as HTMLElement | null,
    conversationKey,
    isGlobalConversation,
    readerPaperContext,
    paperMismatch,
    siblingBodies: siblingBodies.length ? siblingBodies : [panelBody],
  };
}

/**
 * Pin a passage to a resolved panel as selected-text context.
 *
 * This is the body of the popup's "Add Text" button: the same paper-mode
 * guard, the same preview refresh across every panel showing the conversation,
 * and the same status line.
 */
export function attachSelectionToPanel(
  panel: ResolvedReadingPanel,
  selectedText: string,
  options?: { focusInput?: boolean; silent?: boolean },
): boolean {
  const text = normalizeSelectedText(selectedText);
  if (!text) return false;
  if (panel.paperMismatch) {
    if (panel.status && options?.silent !== true) {
      setStatus(
        panel.status,
        getPanelI18n().paperModeForeignSelection,
        "error",
      );
    }
    return false;
  }
  const selectedPaperContext = panel.isGlobalConversation
    ? panel.readerPaperContext
    : null;
  const added = appendSelectedTextContextForItem(
    panel.conversationKey,
    text,
    "pdf",
    selectedPaperContext,
  );
  for (const body of panel.siblingBodies) {
    applySelectedTextPreview(body, panel.conversationKey);
  }
  if (panel.status && options?.silent !== true) {
    setStatus(
      panel.status,
      added ? "Selected text included" : "Text Context up to 5",
      added ? "ready" : "error",
    );
  }
  if (added && options?.focusInput !== false) {
    const inputEl = panel.panelBody.querySelector(
      "#llm-input",
    ) as HTMLTextAreaElement | null;
    inputEl?.focus({ preventScroll: true });
  }
  return added;
}

/**
 * The selection popup's "Add Text" action, as a function.
 *
 * Kept as its own export because the popup, the panel menus and the hotkeys
 * all need exactly this and nothing more.
 */
export async function addSelectionTextToPanel(options: {
  doc?: Document | null;
  item?: Zotero.Item | null;
  selectedText: string;
}): Promise<boolean> {
  const text = normalizeSelectedText(options.selectedText);
  if (!text) return false;
  try {
    const panel = await resolveReadingPanel({
      doc: options.doc,
      item: options.item,
    });
    if (!panel) return false;
    return attachSelectionToPanel(panel, text);
  } catch (err) {
    ztoolkit.log("LLM: Add Text popup action failed", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Bringing the panel into view
// ---------------------------------------------------------------------------

/**
 * Open and scroll to the AIdea section, then focus the composer.
 *
 * Zotero 7 gives no single supported call for "reveal my section", so this
 * tries the documented pieces in order and tolerates every one of them being
 * missing: un-collapse the pane, open the `<collapsible-section>`, ask the
 * sidenav to scroll to the pane, and fall back to `scrollIntoView`.
 */
export function revealReadingPanel(
  panelBody: HTMLElement,
  options?: { focusComposer?: boolean },
): void {
  const doc = panelBody.ownerDocument;
  if (!doc) return;
  const win = doc.defaultView as (Window & Record<string, any>) | null;

  // 1. The whole pane may be collapsed. In a reader tab that is the context
  //    pane; in the library it is the item pane.
  try {
    const contextPane = win?.ZoteroContextPane;
    if (contextPane && contextPane.collapsed === true) {
      contextPane.togglePane?.();
    }
  } catch (_err) {
    void _err;
  }
  try {
    const itemPane = win?.ZoteroPane?.itemPane as
      (HTMLElement & { collapsed?: boolean }) | undefined;
    if (itemPane && itemPane.getAttribute?.("collapsed") === "true") {
      const zoteroPane = win?.ZoteroPane;
      if (typeof zoteroPane?.toggleItemPane === "function") {
        zoteroPane.toggleItemPane();
      } else {
        itemPane.removeAttribute("collapsed");
      }
    }
  } catch (_err) {
    void _err;
  }

  // 2. The section itself may be collapsed.
  const section = (panelBody.closest?.(
    "item-pane-custom-section, [data-pane]",
  ) || null) as (HTMLElement & { open?: boolean; paneID?: string }) | null;
  try {
    if (section && section.open === false) section.open = true;
  } catch (_err) {
    void _err;
  }

  // 3. Ask the sidenav that owns this section to scroll to it. Fall back to
  //    the DOM's own scrollIntoView when the element has no such method.
  const paneID = section?.dataset?.pane || section?.paneID || PANE_ID;
  let scrolled = false;
  try {
    const sidenav = (section
      ?.closest?.("item-pane")
      ?.querySelector?.("item-pane-sidenav") ||
      win?.ZoteroContextPane?.sidenav ||
      doc.getElementById("zotero-view-item-sidenav")) as
      | (HTMLElement & {
          scrollToPane?: (id: string, behavior?: string) => void;
        })
      | null;
    if (typeof sidenav?.scrollToPane === "function") {
      sidenav.scrollToPane(paneID, "smooth");
      scrolled = true;
    }
  } catch (_err) {
    void _err;
  }
  if (!scrolled) {
    try {
      (section || panelBody).scrollIntoView?.({
        block: "start",
        behavior: "smooth",
      });
    } catch (_err) {
      void _err;
    }
  }

  if (options?.focusComposer === false) return;
  try {
    const inputEl = panelBody.querySelector(
      "#llm-input",
    ) as HTMLTextAreaElement | null;
    inputEl?.focus({ preventScroll: true });
  } catch (_err) {
    void _err;
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type ReadingActionOutcome =
  /** The prompt went into the composer and Send was clicked. */
  | "sent"
  /** Handed to an existing panel flow (concept cards) or to the popup. */
  | "delegated"
  | "no-selection"
  | "no-panel"
  | "no-prompt"
  | "generating"
  | "not-ready"
  | "paper-mismatch"
  | "failed";

export interface ReadingActionResult {
  outcome: ReadingActionOutcome;
  /** The resolved panel, when one was found. */
  panel?: ResolvedReadingPanel;
}

export interface DispatchReadingActionOptions {
  kind: ReadingActionKind;
  selectedText: string;
  /** The reader attachment the passage came from. */
  readerItem?: Zotero.Item | null;
  /**
   * Document the request came from. Defaults to the reader item's own window,
   * i.e. the main window; pass the popup's document from the reader popup so
   * the panel in that very window wins the ranking.
   */
  doc?: Document | null;
  /**
   * Runs the popup's own streaming translation. Supplied by the selection
   * popup; without it a `translate` action falls back to a panel request.
   */
  runPopupTranslate?: () => void | Promise<void>;
  /** Title of the paper, used by the prompts that name one. */
  paperTitle?: string;
  /** Target language label for the `translate` fallback prompt. */
  targetLanguage?: string;
  /** Skip bringing the panel into view (the popup keeps the reader in place). */
  reveal?: boolean;
}

/**
 * The language the popup's translation would use, named the way a person names
 * it. Used only by the panel's fallback translate prompt, so a translation
 * asked for without a popup still lands in the language the reader configured.
 */
function resolveSelectionTargetLanguage(): string {
  try {
    const code = getStringPref("selectionTranslate.targetLang").trim();
    if (!code) return "";
    const option = TRANSLATION_LANGUAGE_OPTIONS.find(
      (candidate) => candidate.code === code,
    );
    return option?.label || code;
  } catch {
    return "";
  }
}

function resolvePaperTitle(item: Zotero.Item | null | undefined): string {
  if (!item) return "";
  try {
    const parentId = item.parentID;
    const parent =
      typeof parentId === "number" && parentId > 0
        ? getZoteroItem(parentId)
        : null;
    const title =
      (parent?.getField?.("title") as string | undefined) ||
      (item.getField?.("title") as string | undefined) ||
      "";
    return String(title || "").trim();
  } catch {
    return "";
  }
}

/**
 * Whether the panel is usable right now.
 *
 * The panel writes its readiness into `data-chat-readiness` whenever the model
 * button refreshes, so the check costs nothing and matches exactly what the
 * user is being shown. A panel that has never rendered the attribute is
 * treated as ready — refusing on a missing attribute would block the first
 * action after a rebuild.
 */
function isPanelChatReady(panelRoot: HTMLElement): boolean {
  const state = panelRoot.dataset.chatReadiness;
  return !state || state === "ready";
}

/**
 * Run one reading action against the panel of the active reader.
 *
 * Independent of the selection popup on purpose: the popup passes its own
 * document and translation runner, the panel's menus and the hotkeys pass
 * neither, and everything else is identical.
 */
export async function dispatchReadingAction(
  options: DispatchReadingActionOptions,
): Promise<ReadingActionResult> {
  const selectedText = normalizeSelectedText(options.selectedText || "");
  if (!selectedText) return { outcome: "no-selection" };

  // The popup owns the translation UI; when it is the caller, the passage
  // never has to reach the panel at all.
  if (options.kind === "translate" && options.runPopupTranslate) {
    try {
      await options.runPopupTranslate();
    } catch (err) {
      ztoolkit.log("LLM: popup translate action failed", err);
      return { outcome: "failed" };
    }
    return { outcome: "delegated" };
  }

  const item = options.readerItem || null;
  let panel: ResolvedReadingPanel | null;
  try {
    panel = await resolveReadingPanel({ doc: options.doc, item });
  } catch (err) {
    ztoolkit.log("LLM: reading action panel resolution failed", err);
    return { outcome: "failed" };
  }
  if (!panel) return { outcome: "no-panel" };

  const labels = getPanelI18n();
  const reveal = options.reveal !== false;

  if (isPanelGenerating(panel.panelBody)) {
    if (panel.status) {
      setStatus(panel.status, labels.waitForCurrentResponse, "ready");
    }
    if (reveal) revealReadingPanel(panel.panelBody);
    return { outcome: "generating", panel };
  }

  if (!isPanelChatReady(panel.panelRoot)) {
    if (panel.status) {
      setStatus(panel.status, labels.chatReadinessTitle, "warning");
    }
    if (reveal) revealReadingPanel(panel.panelBody);
    return { outcome: "not-ready", panel };
  }

  if (panel.paperMismatch) {
    if (panel.status) {
      setStatus(
        panel.status,
        getPanelI18n().paperModeForeignSelection,
        "error",
      );
    }
    if (reveal) revealReadingPanel(panel.panelBody);
    return { outcome: "paper-mismatch", panel };
  }

  const inputBox = panel.panelBody.querySelector(
    "#llm-input",
  ) as HTMLTextAreaElement | null;
  const sendBtn = panel.panelBody.querySelector(
    "#llm-send",
  ) as HTMLButtonElement | null;
  if (!inputBox || !sendBtn) return { outcome: "no-panel", panel };

  // The concept card flow files the answer it gets back, so it has to run
  // inside the panel rather than being rebuilt here. Prefilling the composer
  // is exactly how that flow expects to be told which term to define.
  if (options.kind === "concept") {
    const recordOption = panel.panelBody.querySelector(
      "#llm-slash-concept-record-option",
    ) as HTMLButtonElement | null;
    if (recordOption) {
      attachSelectionToPanel(panel, selectedText, {
        focusInput: false,
        silent: true,
      });
      inputBox.value = selectedText;
      if (reveal) revealReadingPanel(panel.panelBody);
      recordOption.click();
      return { outcome: "delegated", panel };
    }
    // No concept option in this panel — fall through to the plain prompt.
  }

  const prompt = buildReadingActionPrompt(options.kind, {
    selectedText,
    lang: getPanelLang(),
    paperTitle: options.paperTitle || resolvePaperTitle(item),
    targetLanguage: options.targetLanguage || resolveSelectionTargetLanguage(),
  });
  if (!prompt) return { outcome: "no-prompt", panel };

  attachSelectionToPanel(panel, selectedText, {
    focusInput: false,
    silent: true,
  });
  inputBox.value = prompt;
  if (reveal) revealReadingPanel(panel.panelBody);
  sendBtn.click();
  return { outcome: "sent", panel };
}

/**
 * Bring the AIdea panel of the current tab into view and focus its composer.
 *
 * Used by the focus hotkey, which has no passage to act on.
 */
export async function focusReadingPanelComposer(options: {
  doc?: Document | null;
  item?: Zotero.Item | null;
}): Promise<boolean> {
  try {
    const panel = await resolveReadingPanel(options);
    if (panel) {
      revealReadingPanel(panel.panelBody);
      return true;
    }
    // A panel with no conversation bound yet — an empty library panel — has
    // nowhere to put a passage but is still somewhere to type.
    const roots = collectPanelRoots(options.doc || null, null);
    const fallback =
      roots.find((root) => isVisibleRoot(root)) || roots[0] || null;
    if (!fallback) return false;
    revealReadingPanel((fallback.parentElement || fallback) as HTMLElement);
    return true;
  } catch (err) {
    ztoolkit.log("LLM: focus composer action failed", err);
    return false;
  }
}
