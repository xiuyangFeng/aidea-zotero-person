/**
 * Sentence-level page anchors for the chat view.
 *
 * The markdown renderer turns `[p.12]` citations into compact chips. Reading a
 * long answer peppered with `p.12` badges is noisy, so in chat the chip is
 * folded away and the sentence it annotates becomes the clickable jump target
 * instead — the same interaction, without the visual debris. Notes keep the
 * explicit `p.12` link, which is why this only runs on chat DOM.
 *
 * The wrapper keeps the `.llm-page-anchor` class and every `data-anchor-*`
 * attribute of the chip it replaces, so the existing chatBox click/keydown
 * delegation resolves it without any change.
 *
 * Everything here fails soft: a chip that cannot be upgraded (no text before
 * it, an unparsable anchor, a DOM that behaves unexpectedly) is left exactly
 * as the renderer produced it.
 */

import { normalizePageAnchor, type PageAnchor } from "../../utils/pageAnchors";
import { getPanelI18n } from "./i18n";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Class shared with the chip so the existing event delegation still matches. */
const ANCHOR_CLASS = "llm-page-anchor";

/** Marks an upgraded wrapper, both for styling and for idempotency. */
const SENTENCE_CLASS = "llm-page-anchor-sentence";

/**
 * Elements that end the backwards walk. `<br>` and block-level tags bound the
 * visual line or block; `<a>` is excluded so a jump link never nests inside
 * another link; a `.llm-page-anchor` stops the walk so each anchor only claims
 * the text between the previous anchor and itself.
 */
const STOP_TAGS = new Set([
  "A",
  "BR",
  "BLOCKQUOTE",
  "DIV",
  "FIGURE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "IMG",
  "LI",
  "OL",
  "P",
  "PRE",
  "TABLE",
  "TBODY",
  "TD",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

/** Guard against a malformed DOM turning the sibling walk into a hang. */
const MAX_WALK_STEPS = 500;

/** Full-width terminators are unambiguous sentence ends. */
const FULL_WIDTH_TERMINATORS = "。．！？；";

/** ASCII terminators need a following separator to not split `3.5`. */
const ASCII_TERMINATORS = ".!?;";

/** Closing punctuation may sit between a terminator and the next sentence. */
const CLOSING_CHARS = "\"'’”)]}»›》」』〉";

/** Log without assuming a Zotero runtime, so the module stays test-friendly. */
function logFailure(message: string, err: unknown): void {
  try {
    (
      globalThis as { ztoolkit?: { log?: (...args: unknown[]) => void } }
    ).ztoolkit?.log?.(message, err);
  } catch {
    // Diagnostics must never break rendering.
  }
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function isTerminatorChar(char: string): boolean {
  return (
    FULL_WIDTH_TERMINATORS.includes(char) || ASCII_TERMINATORS.includes(char)
  );
}

/**
 * Whether `text[index]` really ends a sentence within `[0, regionEnd)`.
 *
 * A bare `.` also appears inside `3.5`, `e.g`, and file names, so an ASCII
 * terminator only counts when whitespace, closing punctuation, or the end of
 * the scanned region follows it. Full-width punctuation never needs that.
 */
function isSentenceEndAt(
  text: string,
  index: number,
  regionEnd: number,
): boolean {
  const char = text[index];
  if (!char) return false;
  if (FULL_WIDTH_TERMINATORS.includes(char)) return true;
  if (!ASCII_TERMINATORS.includes(char)) return false;
  const next = index + 1;
  if (next >= regionEnd) return true;
  const nextChar = text[next];
  return isWhitespace(nextChar) || CLOSING_CHARS.includes(nextChar);
}

export type SentenceScanResult = {
  /**
   * Offset where the annotated sentence starts inside this text.
   * `null` means no boundary was found, so the whole text belongs to the
   * sentence and the caller should keep walking towards earlier nodes.
   */
  startOffset: number | null;
  /** Tail state to pass to the next (earlier) node. */
  atTail: boolean;
};

/**
 * Find where the sentence that ends at this text's end begins.
 *
 * `atTail` marks the text that sits immediately before the anchor. Its own
 * closing punctuation ("…the pipeline." before `[p.5]`) belongs to the
 * annotated sentence and must not be mistaken for the previous sentence's
 * boundary, so the trailing whitespace/terminator run is skipped before the
 * backwards search starts. Once real content has been passed the tail is over
 * and later (earlier) nodes are scanned normally.
 */
export function scanSentenceStartInText(
  text: string,
  atTail: boolean,
): SentenceScanResult {
  const source = String(text ?? "");
  const end = source.length;

  let cursor = end;
  let consumedTail = false;
  if (atTail) {
    for (;;) {
      while (cursor > 0 && isWhitespace(source[cursor - 1])) cursor--;
      if (cursor <= 0) break;
      const char = source[cursor - 1];
      // Inside a run such as `?!` the follow-up check no longer applies: the
      // first terminator already proved the run ends the sentence.
      const isEnd = consumedTail
        ? isTerminatorChar(char)
        : isSentenceEndAt(source, cursor - 1, end);
      if (!isEnd) break;
      cursor--;
      consumedTail = true;
    }
  }

  // Nothing but whitespace and this sentence's own closing punctuation: the
  // whole node belongs to the sentence, keep looking further back.
  if (cursor <= 0) {
    return { startOffset: null, atTail: atTail && !consumedTail };
  }

  for (let index = cursor - 1; index >= 0; index--) {
    if (!isSentenceEndAt(source, index, cursor)) continue;
    let start = index + 1;
    while (start < end && isWhitespace(source[start])) start++;
    return { startOffset: start, atTail: false };
  }
  return { startOffset: null, atTail: false };
}

/** Index just past the last non-whitespace character. */
function trimEndOffset(text: string): number {
  let end = text.length;
  while (end > 0 && isWhitespace(text[end - 1])) end--;
  return end;
}

function hasClass(node: unknown, className: string): boolean {
  const element = node as {
    classList?: { contains?: (name: string) => boolean };
    className?: unknown;
  };
  try {
    if (typeof element?.classList?.contains === "function") {
      return element.classList.contains(className);
    }
  } catch {
    // Fall through to the string form below.
  }
  const raw = typeof element?.className === "string" ? element.className : "";
  return raw.split(/\s+/).includes(className);
}

function isStopNode(node: Node): boolean {
  if (node.nodeType !== ELEMENT_NODE) return false;
  const element = node as Element;
  const tag = String(element.tagName || "").toUpperCase();
  if (STOP_TAGS.has(tag)) return true;
  return hasClass(element, ANCHOR_CLASS);
}

function readAnchor(chip: Element): PageAnchor | null {
  return normalizePageAnchor({
    sourceId: chip.getAttribute("data-anchor-source") || undefined,
    page: chip.getAttribute("data-anchor-page") || undefined,
    endPage: chip.getAttribute("data-anchor-page-end") || undefined,
  });
}

/** Tooltip for the sentence link, e.g. `S2 · Jump to pages 5-6`. */
function buildSentenceLabel(anchor: PageAnchor): string {
  let jump: string;
  try {
    jump = getPanelI18n().pageAnchorJumpTo(anchor.page, anchor.endPage);
  } catch {
    jump = anchor.endPage
      ? `Jump to pages ${anchor.page}-${anchor.endPage}`
      : `Jump to page ${anchor.page}`;
  }
  return anchor.sourceId ? `${anchor.sourceId} · ${jump}` : jump;
}

/**
 * Collect the nodes of the sentence ending at `chip`, in document order.
 *
 * Text nodes may be split so the wrapper starts exactly at the sentence and
 * does not swallow the space that separated the chip from the text. Splitting
 * is visually inert, so it is safe even when the caller later gives up.
 */
function collectSentenceNodes(chip: Element): Node[] {
  const collected: Node[] = [];
  let atTail = true;
  let node: Node | null = chip.previousSibling;
  let steps = 0;

  while (node && steps++ < MAX_WALK_STEPS) {
    if (isStopNode(node)) break;

    if (node.nodeType !== TEXT_NODE) {
      collected.unshift(node);
      if (/\S/.test(node.textContent || "")) atTail = false;
      node = node.previousSibling;
      continue;
    }

    const textNode = node as Text;
    let value = textNode.nodeValue || "";
    if (atTail && !collected.length) {
      const trimmed = trimEndOffset(value);
      if (trimmed === 0) {
        // Pure whitespace right before the chip: leave it outside the link.
        node = textNode.previousSibling;
        continue;
      }
      if (trimmed < value.length) {
        textNode.splitText(trimmed);
        value = textNode.nodeValue || "";
      }
    }

    const scan = scanSentenceStartInText(value, atTail);
    atTail = scan.atTail;
    if (scan.startOffset === null) {
      collected.unshift(textNode);
      node = textNode.previousSibling;
      continue;
    }
    if (scan.startOffset >= value.length) break;
    collected.unshift(
      scan.startOffset > 0 ? textNode.splitText(scan.startOffset) : textNode,
    );
    break;
  }

  return collected;
}

/** Move the chip's identity onto the wrapper so delegation keeps working. */
function applyAnchorAttributes(
  wrapper: Element,
  chip: Element,
  anchor: PageAnchor,
): void {
  const attributes = Array.from(chip.attributes || []);
  for (const attribute of attributes) {
    if (!attribute?.name?.startsWith("data-")) continue;
    wrapper.setAttribute(attribute.name, attribute.value);
  }
  wrapper.setAttribute("role", chip.getAttribute("role") || "button");
  wrapper.setAttribute("tabindex", chip.getAttribute("tabindex") || "0");
  const label = buildSentenceLabel(anchor);
  wrapper.setAttribute("title", label);
  wrapper.setAttribute("aria-label", label);
}

/** Replace one chip with a sentence wrapper; returns false when skipped. */
function upgradeChip(chip: Element): boolean {
  const parent = chip.parentNode;
  const doc = chip.ownerDocument;
  if (!parent || !doc) return false;

  const anchor = readAnchor(chip);
  if (!anchor) return false;

  const collected = collectSentenceNodes(chip);
  const first = collected[0];
  if (!first) return false;
  const hasContent = collected.some((node) =>
    /\S/.test(node.textContent || ""),
  );
  if (!hasContent) return false;

  const wrapper = doc.createElement("span");
  wrapper.setAttribute("class", `${ANCHOR_CLASS} ${SENTENCE_CLASS}`);
  applyAnchorAttributes(wrapper, chip, anchor);

  parent.insertBefore(wrapper, first);
  for (const node of collected) wrapper.appendChild(node);
  parent.removeChild(chip);
  return true;
}

/**
 * Upgrade every page-anchor chip inside `root` into a sentence jump link.
 *
 * Safe to call repeatedly on the same subtree: wrappers created by an earlier
 * pass are skipped, and a chip that cannot claim a sentence stays a chip, so
 * the result of a second run is identical to the first.
 */
export function upgradePageAnchorSentences(root: Element | null): void {
  if (!root) return;
  try {
    const found = root.querySelectorAll?.(`.${ANCHOR_CLASS}`);
    if (!found) return;
    const chips = Array.from(found as ArrayLike<Element>).filter(
      (element) => element && !hasClass(element, SENTENCE_CLASS),
    );
    for (const chip of chips) {
      try {
        upgradeChip(chip);
      } catch (err) {
        logFailure("LLM: page anchor sentence upgrade failed", err);
      }
    }
  } catch (err) {
    logFailure("LLM: page anchor sentence pass failed", err);
  }
}
