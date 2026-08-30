/**
 * Page anchors — page-number provenance for document context and answers.
 *
 * Zotero's PDF worker joins page texts with a form feed, so extracted text can
 * be split back into pages and prefixed with a short `[page N]` marker. The
 * model is then asked to cite those pages as `[p.12]` (or `[S2 p.12]` when one
 * request carries several papers), and the chat/note renderers turn those
 * citations into clickable jump targets.
 *
 * Everything here is pure string handling apart from `isPageAnchorsEnabled`,
 * which reads the preference defensively so the module stays usable without a
 * Zotero runtime.
 */

import { config } from "../../package.json";

/** Form feed inserted between pages by Zotero's PDF full-text worker. */
export const PDF_PAGE_SEPARATOR = "\f";

/** Preference that gates marker injection and the model instruction. */
export const PAGE_ANCHORS_PREF_KEY = "pageAnchors.enabled";

/** Label used in supplemental metadata so the model can name its source. */
export const SUPPLEMENTAL_ANCHOR_ID_LABEL = "Anchor ID";

const PAGE_MARKER_PATTERN = /\[page\s+(\d{1,5})\]/i;
const SUPPLEMENTAL_ANCHOR_ID_PATTERN = /^S(\d{1,3})$/i;
const SUPPLEMENTAL_ANCHOR_ID_LINE_PATTERN = /^Anchor ID:\s*(S\d{1,3})\s*$/gim;

// `[p.12]`, `[p. 12]`, `[pp.12-14]`, `[S2 p.12]`, `[S2, p.12]`. The trailing
// lookahead keeps markdown links such as `[p.12](https://…)` intact.
const PAGE_ANCHOR_SOURCE =
  "\\[(?:(S\\d{1,3})[\\s,;:]+)?pp?\\.\\s*(\\d{1,5})(?:\\s*[-‐-―]\\s*(\\d{1,5}))?\\](?!\\()";

export type PageAnchor = {
  /** Supplemental source token such as `S2`; absent for the base document. */
  sourceId?: string;
  /** One-based physical page number. */
  page: number;
  /** One-based end page for a range citation such as `[pp.12-14]`. */
  endPage?: number;
};

export function formatPageMarker(page: number): string {
  return `[page ${page}]`;
}

/**
 * Split Zotero PDF full text back into its per-page pieces.
 *
 * Returns one entry per page, preserving empty pages so the array index stays
 * aligned with the physical page order.
 */
export function splitPdfTextIntoPages(text: string): string[] {
  const source = String(text || "");
  if (!source) return [];
  return source.split(PDF_PAGE_SEPARATOR);
}

/**
 * Prefix every extracted page with a `[page N]` marker.
 *
 * Without a form feed the extractor produced a single page. Marking a
 * multi-page document as page 1 would misattribute every later citation, so
 * that case only gets a marker when the caller confirms a one-page document.
 */
export function injectPageMarkers(
  text: string,
  options: { pageCount?: number } = {},
): string {
  const source = String(text || "");
  if (!source.trim()) return source;

  const pages = splitPdfTextIntoPages(source);
  const pageCount = Number.isFinite(options.pageCount)
    ? Math.max(0, Math.floor(options.pageCount as number))
    : 0;
  if (pages.length < 2 && pageCount !== 1) return source;

  const blocks: string[] = [];
  pages.forEach((page, index) => {
    const body = page.trim();
    // Blank pages are skipped, but the marker keeps using the physical index
    // so the numbering never drifts away from the reader's own pages.
    if (!body) return;
    blocks.push(`${formatPageMarker(index + 1)}\n${body}`);
  });
  return blocks.length ? blocks.join("\n\n") : source;
}

export function hasPageMarkers(text: string): boolean {
  return PAGE_MARKER_PATTERN.test(String(text || ""));
}

/** Anchor token used for the Nth supplemental paper (zero-based index). */
export function formatSupplementalAnchorId(index: number): string {
  const normalized = Number.isFinite(index)
    ? Math.max(0, Math.floor(index))
    : 0;
  return `S${normalized + 1}`;
}

export function formatSupplementalAnchorIdLine(index: number): string {
  return `${SUPPLEMENTAL_ANCHOR_ID_LABEL}: ${formatSupplementalAnchorId(index)}`;
}

/**
 * Declare a supplemental block's anchor token right under its label line.
 *
 * The token is assigned when the request is assembled rather than when the
 * block was built, so it always matches the paper's position in the context
 * refs a click later resolves against. Blocks without page markers are left
 * alone so the model never cites a source it cannot locate a page in.
 */
export function withSupplementalAnchorId(block: string, index: number): string {
  const source = String(block || "");
  if (!source.trim() || !hasPageMarkers(source)) return source;
  const line = formatSupplementalAnchorIdLine(index);
  const newlineIndex = source.indexOf("\n");
  return newlineIndex < 0
    ? `${source}\n${line}`
    : `${source.slice(0, newlineIndex)}\n${line}${source.slice(newlineIndex)}`;
}

/** Resolve `S2` back to its one-based supplemental position. */
export function parseSupplementalAnchorPosition(
  sourceId: string | undefined,
): number | null {
  const match = String(sourceId || "").match(SUPPLEMENTAL_ANCHOR_ID_PATTERN);
  if (!match) return null;
  const position = Number(match[1]);
  return Number.isFinite(position) && position > 0 ? position : null;
}

/** Collect the `Anchor ID: S…` tokens declared inside a context block. */
export function extractSupplementalAnchorIds(block: string): string[] {
  const source = String(block || "");
  if (!source) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  const pattern = new RegExp(SUPPLEMENTAL_ANCHOR_ID_LINE_PATTERN);
  let match = pattern.exec(source);
  while (match) {
    const id = match[1].toUpperCase();
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    match = pattern.exec(source);
  }
  return ids;
}

/** Fresh matcher so concurrent scans never share `lastIndex` state. */
export function createPageAnchorPattern(): RegExp {
  return new RegExp(PAGE_ANCHOR_SOURCE, "gi");
}

function normalizePageNumber(value: unknown): number | null {
  const page = Number(value);
  if (!Number.isFinite(page)) return null;
  const normalized = Math.floor(page);
  return normalized > 0 ? normalized : null;
}

/** Build an anchor from raw regex captures, rejecting impossible values. */
export function normalizePageAnchor(captures: {
  sourceId?: string;
  page?: string | number;
  endPage?: string | number;
}): PageAnchor | null {
  const page = normalizePageNumber(captures.page);
  if (page === null) return null;
  const sourceId = String(captures.sourceId || "")
    .trim()
    .toUpperCase();
  if (sourceId && !SUPPLEMENTAL_ANCHOR_ID_PATTERN.test(sourceId)) return null;
  const endPage = normalizePageNumber(captures.endPage);
  return {
    ...(sourceId ? { sourceId } : {}),
    page,
    // A descending or equal range carries no extra information.
    ...(endPage !== null && endPage > page ? { endPage } : {}),
  };
}

/** Parse a single `[p.12]`-style token; returns null when it is not one. */
export function parsePageAnchor(raw: string): PageAnchor | null {
  const pattern = new RegExp(`^${PAGE_ANCHOR_SOURCE}$`, "i");
  const match = String(raw || "").match(pattern);
  if (!match) return null;
  return normalizePageAnchor({
    sourceId: match[1],
    page: match[2],
    endPage: match[3],
  });
}

/** Compact chip text, for example `p.12`, `pp.12-14`, or `S2 p.12`. */
export function formatPageAnchorLabel(anchor: PageAnchor): string {
  const pages = anchor.endPage
    ? `pp.${anchor.page}-${anchor.endPage}`
    : `p.${anchor.page}`;
  return anchor.sourceId ? `${anchor.sourceId} ${pages}` : pages;
}

export type OpenPdfUrlParams = {
  itemKey: string;
  page: number;
  /** Present for group libraries; user libraries omit it. */
  groupID?: number | null;
};

/**
 * Build the `zotero://open-pdf` URL understood by Zotero's protocol handler.
 * Its `page` parameter is one-based and is converted to a zero-based
 * `pageIndex` by Zotero itself.
 */
export function buildOpenPdfUrl(params: OpenPdfUrlParams): string | null {
  const itemKey = String(params.itemKey || "").trim();
  if (!/^[A-Z0-9]{4,16}$/i.test(itemKey)) return null;
  const page = normalizePageNumber(params.page);
  if (page === null) return null;
  const groupID = Number(params.groupID);
  const path =
    Number.isFinite(groupID) && groupID > 0
      ? `groups/${Math.floor(groupID)}/items/${itemKey}`
      : `library/items/${itemKey}`;
  return `zotero://open-pdf/${path}?page=${page}`;
}

export type PageAnchorInstructionOptions = {
  /** Whether the base document block carries `[page N]` markers. */
  hasBaseDocument: boolean;
  /** Anchor tokens of supplemental blocks that carry markers. */
  supplementalAnchorIds?: readonly string[];
};

/**
 * Instruction appended to the context blocks (never to the user-editable
 * system prompt) so the model cites the pages it actually read.
 */
export function buildPageAnchorInstruction(
  options: PageAnchorInstructionOptions,
): string {
  const supplementalIds = (options.supplementalAnchorIds || []).filter(Boolean);
  if (!options.hasBaseDocument && !supplementalIds.length) return "";

  const lines = [
    "[INSTRUCTION: Page provenance. The context above is tagged with `[page N]` markers.",
    "- After every key claim, number, and quotation, cite its page as [p.N].",
    "- Take N from the nearest preceding [page N] marker of the text you used; never guess a page.",
    "- Use [pp.N-M] only when the evidence really spans consecutive pages.",
  ];
  if (supplementalIds.length) {
    lines.push(
      `- Prefix supplemental papers with their Anchor ID, for example [${supplementalIds[0]} p.N]` +
        ` (available: ${supplementalIds.join(", ")}). Keep [p.N] unprefixed for the main document.`,
    );
  }
  lines.push(
    "- Omit the citation instead of inventing one when no marker covers the claim.",
    "- Cite pages inline only; do not add a separate reference list.]",
  );
  return lines.join("\n");
}

/**
 * Whether page markers and the citation instruction should be injected.
 * Defaults to enabled, including when no Zotero runtime is available.
 */
export function isPageAnchorsEnabled(): boolean {
  try {
    const prefs = (globalThis as { Zotero?: { Prefs?: { get?: unknown } } })
      .Zotero?.Prefs;
    if (typeof prefs?.get !== "function") return true;
    const value = (prefs.get as (key: string, global?: boolean) => unknown)(
      `${config.prefsPrefix}.${PAGE_ANCHORS_PREF_KEY}`,
      true,
    );
    if (typeof value === "boolean") return value;
    const normalized = String(value ?? "")
      .trim()
      .toLowerCase();
    if (!normalized) return true;
    return normalized !== "false" && normalized !== "0";
  } catch {
    return true;
  }
}
