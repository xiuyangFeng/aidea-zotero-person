/**
 * Figure catalog — the Figure/Table captions of a document, as a list.
 *
 * Reading an experimental paper usually starts at its figures, so the panel
 * offers a "figure navigator": every `Figure N` / `Table N` caption the
 * extracted full text contains, with the page it sits on, ready to jump to or
 * to hand back to the model for an explanation.
 *
 * The input is the same text the chat context is built from, so PDFs arrive
 * with the `[page N]` markers `pageAnchors` injects and everything else (EPUB,
 * plain text) arrives without them. A caption found before any marker keeps a
 * `null` page rather than guessing one, and the panel hides the jump action
 * for those entries.
 *
 * Everything here is pure string handling: no Zotero runtime, no DOM. The
 * panel owns resolving the document, caching the result, and the UI.
 */

/** Whether an entry describes a figure or a table. */
export type FigureKind = "figure" | "table";

export type FigureCatalogEntry = {
  kind: FigureKind;
  /** Canonical label, for example `Figure 3`, `Table S2`, or `图 1`. */
  label: string;
  /** Caption text without the label and its separator. */
  caption: string;
  /** One-based page from the nearest preceding `[page N]` marker. */
  page: number | null;
};

/** Captions longer than this are cut; a figure legend is not a section. */
export const FIGURE_CATALOG_MAX_CAPTION_LENGTH = 500;

/** Upper bound on the entries one document may contribute. */
export const FIGURE_CATALOG_MAX_ENTRIES = 400;

/** A caption may wrap, but a whole column of text is not a caption. */
const MAX_CAPTION_LINES = 10;

/** Below this a "caption" is punctuation noise rather than a legend. */
const MIN_CAPTION_LENGTH = 2;

/** Captions this long are descriptive enough to outrank a bare reference. */
const DESCRIPTIVE_CAPTION_LENGTH = 40;

const PAGE_MARKER_GLOBAL = /\[page\s+(\d{1,5})\]/gi;
const PAGE_MARKER_ONLY = /^\s*\[page\s+\d{1,5}\]\s*$/i;

/**
 * `Figure 3:`, `Fig. 3.`, `FIGURE S2 —`, `Table 3.1`, `Tab. 4`.
 *
 * The leading character class swallows the bullets and rules PDF extraction
 * leaves at the start of a line. The number accepts an optional one or two
 * letter series prefix (`S2` supplemental, `A1` appendix) and an optional
 * panel suffix (`3a`), and the separator is captured so a caption colon can
 * be told apart from a sentence period.
 */
const LATIN_ENTRY_HEAD =
  /^[\s>*#·•|[\]()\-–—]*(fig(?:ure)?|table|tab)\s*\.?\s*([a-z]{0,2}\d+(?:\.\d+)*[a-z]?)(?!\w)\s*([:：.。．—–|,，、-]?)\s*/i;

/**
 * `图 1`, `图1：`, `表 2 —`, `圖 3.1`.
 *
 * Chinese writing has no word spacing, so a separator or whitespace after the
 * number is required: without it `图1所示` (an in-text reference) would read
 * as a caption for every paper that mentions its own figures.
 */
const CJK_ENTRY_HEAD =
  /^[\s>*#·•|[\]()\-–—]*(图|圖|表)\s*(\d+(?:\.\d+)*)\s*([:：.。．—–|,，、-]|\s)\s*/;

/** Separators that only a caption uses. */
const STRONG_SEPARATORS = new Set([":", "：", "—", "–", "|", "｜"]);

/** Separators that are also ordinary sentence punctuation. */
const WEAK_SEPARATORS = new Set([".", "。", "．", ",", "，", "、", "-"]);

const SENTENCE_END = /[.。．!！?？]["'”’)）\]]*$/;
const NEW_SENTENCE_START = /^[A-Z\u3400-\u9fff\uf900-\ufaff]/;
const CJK_CHARACTER = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

type EntryHead = {
  kind: FigureKind;
  label: string;
  /** Dedup key: the same figure written `Fig. 3` and `Figure 3` shares one. */
  key: string;
  /** Text of the head line after the label and separator. */
  rest: string;
  separator: string;
};

type Candidate = {
  entry: FigureCatalogEntry;
  score: number;
  order: number;
};

/**
 * Normalize a figure number so `fig. s2` and `Figure S2` land on one label.
 * A series prefix is a class name and is upper-cased; a panel suffix is part
 * of the sub-figure name and stays lower-case.
 */
function normalizeFigureNumber(raw: string): string {
  const match = /^([A-Za-z]{0,2})(\d+(?:\.\d+)*)([A-Za-z]?)$/.exec(raw);
  if (!match) return raw;
  return `${match[1].toUpperCase()}${match[2]}${match[3].toLowerCase()}`;
}

function matchLatinEntryHead(line: string): EntryHead | null {
  const match = LATIN_ENTRY_HEAD.exec(line);
  if (!match) return null;
  const keyword = match[1].toLowerCase();
  const kind: FigureKind = keyword.startsWith("fig") ? "figure" : "table";
  const word = kind === "figure" ? "Figure" : "Table";
  const number = normalizeFigureNumber(match[2]);
  return {
    kind,
    label: `${word} ${number}`,
    key: `${word}|${number}`,
    rest: line.slice(match[0].length),
    separator: (match[3] || "").trim(),
  };
}

function matchCjkEntryHead(line: string): EntryHead | null {
  const match = CJK_ENTRY_HEAD.exec(line);
  if (!match) return null;
  const word = match[1];
  const kind: FigureKind = word === "表" ? "table" : "figure";
  const number = match[2];
  return {
    kind,
    label: `${word} ${number}`,
    key: `${word}|${number}`,
    rest: line.slice(match[0].length),
    separator: (match[3] || "").trim(),
  };
}

function matchEntryHead(line: string): EntryHead | null {
  return matchLatinEntryHead(line) || matchCjkEntryHead(line);
}

/** Drop `[page N]` markers so they never leak into a caption. */
function stripPageMarkers(line: string): string {
  return line.replace(PAGE_MARKER_GLOBAL, " ");
}

/** Page declared by the last marker on a line, or null when it carries none. */
function readLinePage(line: string): number | null {
  const pattern = new RegExp(PAGE_MARKER_GLOBAL);
  let page: number | null = null;
  let match = pattern.exec(line);
  while (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) page = Math.floor(value);
    match = pattern.exec(line);
  }
  return page;
}

function endsSentence(text: string): boolean {
  return Boolean(text) && SENTENCE_END.test(text);
}

function startsNewSentence(line: string): boolean {
  return NEW_SENTENCE_START.test(line);
}

/**
 * Append a wrapped caption line.
 *
 * PDF extraction keeps the typesetter's line breaks, so a word hyphenated
 * across a break is rejoined, two CJK lines are joined without a gap, and
 * everything else gets the single space the break stood for.
 */
function joinCaptionLines(text: string, line: string): string {
  if (!text) return line;
  if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(line)) {
    return `${text.slice(0, -1)}${line}`;
  }
  if (
    CJK_CHARACTER.test(text.slice(-1)) &&
    CJK_CHARACTER.test(line.slice(0, 1))
  ) {
    return `${text}${line}`;
  }
  return `${text} ${line}`;
}

function normalizeCaption(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= FIGURE_CATALOG_MAX_CAPTION_LENGTH) return collapsed;
  return `${collapsed
    .slice(0, FIGURE_CATALOG_MAX_CAPTION_LENGTH - 1)
    .trimEnd()}…`;
}

/**
 * How strongly a match looks like a real caption rather than a sentence that
 * happens to begin with a figure reference.
 *
 * A caption is introduced by a caption separator, and it starts a block of its
 * own; an in-text reference continues the paragraph above it. Length is the
 * last word, matching the plain "the longer text wins" rule.
 */
function scoreCandidate(options: {
  separator: string;
  blockStart: boolean;
  afterSentence: boolean;
  captionLength: number;
}): number {
  let score = 0;
  if (STRONG_SEPARATORS.has(options.separator)) score += 3;
  else if (WEAK_SEPARATORS.has(options.separator)) score += 1;
  if (options.blockStart) score += 2;
  else if (options.afterSentence) score += 1;
  if (options.captionLength >= DESCRIPTIVE_CAPTION_LENGTH) score += 1;
  return score;
}

/** Numeric-aware label order, so `Figure 9` precedes `Figure 10`. */
function compareLabels(a: string, b: string): number {
  const left = a.match(/\d+|\D+/g) || [];
  const right = b.match(/\d+|\D+/g) || [];
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const l = left[index];
    const r = right[index];
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) {
      const diff = Number(l) - Number(r);
      if (diff) return diff;
      continue;
    }
    if (l !== r) return l < r ? -1 : 1;
  }
  return left.length - right.length;
}

function collectCandidates(source: string): Map<string, Candidate> {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const candidates = new Map<string, Candidate>();
  let page: number | null = null;
  // Empty means "the previous line ended a block", which is also true at the
  // very start of the document.
  let previousLine = "";
  let order = 0;
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const markerPage = readLinePage(rawLine);
    if (markerPage !== null) page = markerPage;
    if (PAGE_MARKER_ONLY.test(rawLine)) {
      previousLine = "";
      index += 1;
      continue;
    }
    const line = stripPageMarkers(rawLine).trim();
    if (!line) {
      previousLine = "";
      index += 1;
      continue;
    }
    const head = matchEntryHead(line);
    if (!head) {
      previousLine = line;
      index += 1;
      continue;
    }

    let caption = head.rest.trim();
    let cursor = index + 1;
    let consumed = 0;
    while (cursor < lines.length && consumed < MAX_CAPTION_LINES) {
      const nextRaw = lines[cursor];
      if (PAGE_MARKER_ONLY.test(nextRaw)) break;
      const next = stripPageMarkers(nextRaw).trim();
      if (!next) break;
      if (matchEntryHead(next)) break;
      if (caption.length >= FIGURE_CATALOG_MAX_CAPTION_LENGTH) break;
      if (endsSentence(caption) && startsNewSentence(next)) break;
      caption = joinCaptionLines(caption, next);
      cursor += 1;
      consumed += 1;
    }

    const normalized = normalizeCaption(caption);
    if (normalized.length >= MIN_CAPTION_LENGTH) {
      const score = scoreCandidate({
        separator: head.separator,
        blockStart: previousLine === "",
        afterSentence: endsSentence(previousLine),
        captionLength: normalized.length,
      });
      const existing = candidates.get(head.key);
      const better =
        !existing ||
        score > existing.score ||
        (score === existing.score &&
          normalized.length > existing.entry.caption.length);
      if (better) {
        candidates.set(head.key, {
          entry: {
            kind: head.kind,
            label: head.label,
            caption: normalized,
            page,
          },
          score,
          order: existing ? existing.order : order,
        });
      }
      if (!existing) order += 1;
    }

    previousLine = lines[cursor - 1]
      ? stripPageMarkers(lines[cursor - 1]).trim()
      : line;
    index = cursor;
  }

  return candidates;
}

/**
 * Extract every Figure/Table caption from a document's extracted full text.
 *
 * Entries are unique per label and ordered by page, then by label, so the list
 * reads in the order the reader meets the figures. Anything unparseable — a
 * non-string, an empty document, text without a single caption — yields an
 * empty array rather than an error.
 */
export function extractFigureCatalog(text: unknown): FigureCatalogEntry[] {
  try {
    const source = typeof text === "string" ? text : "";
    if (!source.trim()) return [];

    const candidates = collectCandidates(source);
    const entries = [...candidates.values()]
      .sort((a, b) => {
        const aPage = a.entry.page ?? Number.POSITIVE_INFINITY;
        const bPage = b.entry.page ?? Number.POSITIVE_INFINITY;
        if (aPage !== bPage) return aPage - bPage;
        const byLabel = compareLabels(a.entry.label, b.entry.label);
        if (byLabel) return byLabel;
        return a.order - b.order;
      })
      .map((candidate) => candidate.entry);
    return entries.slice(0, FIGURE_CATALOG_MAX_ENTRIES);
  } catch {
    return [];
  }
}

export type FigureExplainLang = "en-US" | "zh-CN";

/** Explanation copy exists in English and Simplified Chinese only. */
export function resolveFigureExplainLang(
  lang: string | null | undefined,
): FigureExplainLang {
  return String(lang || "").startsWith("zh") ? "zh-CN" : "en-US";
}

const FIGURE_EXPLAIN_COPY: Record<
  FigureExplainLang,
  {
    heading: (label: string) => string;
    captionLabel: string;
    pageLabel: (page: number) => string;
    rules: string[];
    pageRule: string;
    noPageRule: string;
  }
> = {
  "en-US": {
    heading: (label) => `Walk me through ${label} of the document in context.`,
    captionLabel: "Caption",
    pageLabel: (page) => `Printed on page ${page}.`,
    rules: [
      "- Describe what it actually shows: what is plotted or tabulated, the axes or columns, the conditions being compared.",
      "- State the conclusion the authors draw from it, using the surrounding text rather than the caption alone.",
      "- Point out details worth noticing: baselines, ablations, error bars, outliers, missing controls, or claims the data does not support.",
      "- Keep it to a short prose answer; skip anything the document does not say.",
    ],
    pageRule:
      "- Cite the page of every key claim as [p.N], taking N from the nearest preceding [page N] marker.",
    noPageRule:
      "- This document carries no page markers, so do not cite page numbers.",
  },
  "zh-CN": {
    heading: (label) => `结合正文，讲讲这篇文献里的 ${label}。`,
    captionLabel: "图注",
    pageLabel: (page) => `位于第 ${page} 页。`,
    rules: [
      "- 先说清它到底画/列了什么：坐标轴或表头是什么，比较的是哪些条件。",
      "- 再说作者用它论证了什么结论，要结合正文，而不是只复述图注。",
      "- 指出值得注意的细节：基线、消融、误差棒、异常点、缺失的对照，或数据其实撑不起的论断。",
      "- 用简短的连贯段落回答，文中没写的不要编。",
    ],
    pageRule: "- 关键论断后用 [p.N] 标注页码，N 取自最近的 [page N] 标记。",
    noPageRule: "- 本文档没有页码标记，不要标注页码。",
  },
};

export type BuildFigureExplainPromptOptions = {
  entry: FigureCatalogEntry;
  lang?: string;
  /** Defaults to whether the entry carries a page, i.e. whether markers exist. */
  pageCitations?: boolean;
};

/**
 * Prompt for the "explain" action of one catalog entry.
 *
 * The document's full text is already the conversation's base context, so the
 * prompt only has to name the figure and quote its caption — the model reads
 * the surrounding discussion from the context it already has.
 */
export function buildFigureExplainPrompt(
  options: BuildFigureExplainPromptOptions,
): string {
  const entry = options.entry;
  if (!entry || !entry.label) return "";
  const copy = FIGURE_EXPLAIN_COPY[resolveFigureExplainLang(options.lang)];
  const caption = String(entry.caption || "").trim();
  const pageCitations =
    options.pageCitations === undefined
      ? entry.page !== null
      : options.pageCitations !== false;

  const header = [copy.heading(entry.label)];
  if (caption) header.push(`${copy.captionLabel}: ${caption}`);
  if (entry.page !== null) header.push(copy.pageLabel(entry.page));

  const rules = [
    ...copy.rules,
    pageCitations ? copy.pageRule : copy.noPageRule,
  ];
  return [header.join("\n"), rules.join("\n")].join("\n\n");
}
