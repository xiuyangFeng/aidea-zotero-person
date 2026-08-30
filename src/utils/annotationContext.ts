/**
 * Annotation context — the reader's own highlights and notes as prompt input.
 *
 * Zotero stores every highlight, underline, and sticky note as a child item of
 * the attachment. Those are the passages the user already decided were worth
 * marking, so they make far better context than a retrieval guess. This module
 * turns raw annotation fields into a compact, budgeted context block.
 *
 * Everything here is pure string and array handling: it takes plain records so
 * the formatting, ordering, and truncation rules stay testable without a
 * Zotero runtime. Reading the records off real items lives in
 * `modules/contextPanel/annotationSources.ts`.
 */

/** Annotation kinds that carry text worth sending to the model. */
export const TEXTUAL_ANNOTATION_TYPES = [
  "highlight",
  "underline",
  "note",
] as const;

export type AnnotationKind = (typeof TEXTUAL_ANNOTATION_TYPES)[number];

/** Hard cap on entries so a heavily annotated book cannot flood the prompt. */
export const ANNOTATION_CONTEXT_MAX_ENTRIES = 200;
/** Character budget for the whole entry list, excluding the header. */
export const ANNOTATION_CONTEXT_MAX_CHARS = 20000;
/** Per-entry clamps; long highlights are the common case, comments are short. */
export const ANNOTATION_TEXT_MAX_CHARS = 600;
export const ANNOTATION_COMMENT_MAX_CHARS = 400;

export type AnnotationRecord = {
  /** Zotero annotation key; used only to drop duplicates. */
  key?: string;
  type: AnnotationKind;
  /** The marked-up passage. Empty for standalone sticky notes. */
  text: string;
  /** The user's own remark on the annotation. */
  comment: string;
  /** Reader-facing page label. Often empty outside PDFs. */
  pageLabel: string;
  /** Zero-based physical page. Absent for EPUB and snapshot annotations. */
  pageIndex: number | null;
  /** Hex colour exactly as Zotero stored it. */
  color: string;
  /** Zotero's fixed-width `annotationSortIndex`, used for reading order. */
  sortIndex: string;
};

export type RawAnnotationInput = {
  key?: unknown;
  type?: unknown;
  text?: unknown;
  comment?: unknown;
  pageLabel?: unknown;
  pageIndex?: unknown;
  color?: unknown;
  sortIndex?: unknown;
};

export type AnnotationContextBlock = {
  /** Formatted block, or an empty string when nothing could be included. */
  text: string;
  includedCount: number;
  totalCount: number;
  /** True when entries were dropped to stay inside the budget. */
  truncated: boolean;
};

export type AnnotationContextOptions = {
  /** Document title shown in the block header. */
  title?: string;
  maxEntries?: number;
  maxChars?: number;
};

const TEXTUAL_ANNOTATION_TYPE_SET = new Set<string>(TEXTUAL_ANNOTATION_TYPES);

function normalizeWhitespace(value: unknown): string {
  if (typeof value !== "string") return "";
  // Highlights carry the PDF's own line breaks; collapsing them keeps each
  // entry to one line so the entry budget maps to what the model actually sees.
  return value.replace(/\s+/g, " ").trim();
}

function clampText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function normalizePageIndex(value: unknown): number | null {
  const index = Number(value);
  if (!Number.isFinite(index)) return null;
  const normalized = Math.floor(index);
  return normalized >= 0 ? normalized : null;
}

/**
 * Build one record from loose annotation fields.
 *
 * Returns null for annotation kinds without usable text (image, ink) and for
 * entries where both the passage and the comment are empty, since those
 * contribute nothing but page noise.
 */
export function normalizeAnnotationRecord(
  raw: RawAnnotationInput | null | undefined,
): AnnotationRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const type = String(raw.type ?? "")
    .trim()
    .toLowerCase();
  if (!TEXTUAL_ANNOTATION_TYPE_SET.has(type)) return null;

  const text = clampText(
    normalizeWhitespace(raw.text),
    ANNOTATION_TEXT_MAX_CHARS,
  );
  const comment = clampText(
    normalizeWhitespace(raw.comment),
    ANNOTATION_COMMENT_MAX_CHARS,
  );
  if (!text && !comment) return null;

  return {
    ...(typeof raw.key === "string" && raw.key.trim()
      ? { key: raw.key.trim() }
      : {}),
    type: type as AnnotationKind,
    text,
    comment,
    pageLabel: normalizeWhitespace(raw.pageLabel),
    pageIndex: normalizePageIndex(raw.pageIndex),
    color: typeof raw.color === "string" ? raw.color.trim() : "",
    sortIndex: typeof raw.sortIndex === "string" ? raw.sortIndex.trim() : "",
  };
}

/**
 * Order annotations the way the reader meets them.
 *
 * `annotationSortIndex` is a fixed-width string (`page|offset|y`) for every
 * annotated format, so a plain string compare already yields reading order.
 * Records missing it fall back to the page index and then to their original
 * position, which keeps the sort stable.
 */
export function sortAnnotationRecords(
  records: readonly AnnotationRecord[],
): AnnotationRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => {
      const sortIndexA = a.record.sortIndex;
      const sortIndexB = b.record.sortIndex;
      if (sortIndexA && sortIndexB && sortIndexA !== sortIndexB) {
        return sortIndexA < sortIndexB ? -1 : 1;
      }
      if (!sortIndexA !== !sortIndexB) return sortIndexA ? -1 : 1;
      const pageA = a.record.pageIndex;
      const pageB = b.record.pageIndex;
      if (pageA !== null && pageB !== null && pageA !== pageB) {
        return pageA - pageB;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.record);
}

/** Normalize, drop duplicates and unusable kinds, and sort into reading order. */
export function normalizeAnnotationRecords(
  rawRecords: readonly (RawAnnotationInput | null | undefined)[],
): AnnotationRecord[] {
  const records: AnnotationRecord[] = [];
  const seenKeys = new Set<string>();
  for (const raw of rawRecords || []) {
    const record = normalizeAnnotationRecord(raw);
    if (!record) continue;
    if (record.key) {
      if (seenKeys.has(record.key)) continue;
      seenKeys.add(record.key);
    }
    records.push(record);
  }
  return sortAnnotationRecords(records);
}

/**
 * One-based page number for an annotation, or null when it has none.
 *
 * PDFs carry a zero-based `pageIndex`; EPUB and snapshot annotations do not,
 * so a purely numeric page label is the next best source. Roman numerals and
 * chapter-style labels are deliberately not converted — a wrong number would
 * produce a citation that jumps to the wrong place.
 */
export function resolveAnnotationPageNumber(
  record: Pick<AnnotationRecord, "pageIndex" | "pageLabel">,
): number | null {
  if (record.pageIndex !== null && record.pageIndex !== undefined) {
    return record.pageIndex + 1;
  }
  const label = String(record.pageLabel || "").trim();
  if (!/^\d{1,5}$/.test(label)) return null;
  const page = Number(label);
  return Number.isFinite(page) && page > 0 ? page : null;
}

/** Citation-shaped prefix, e.g. `[p.12] `, `(at Chapter 3) `, or `` when unknown. */
export function formatAnnotationPagePrefix(
  record: Pick<AnnotationRecord, "pageIndex" | "pageLabel">,
): string {
  const page = resolveAnnotationPageNumber(record);
  // `[p.N]` is the anchor token the chat and note renderers already turn into
  // a jump target, so the model can copy it verbatim into its answer.
  if (page !== null) return `[p.${page}] `;
  const label = String(record.pageLabel || "").trim();
  // A non-numeric label cannot become an anchor; keep it as plain prose so the
  // model never emits a citation that resolves to the wrong page.
  return label ? `(at ${label}) ` : "";
}

/** Render a single annotation as one numbered entry. */
export function formatAnnotationEntry(
  record: AnnotationRecord,
  position: number,
): string {
  const prefix = formatAnnotationPagePrefix(record);
  if (!record.text) {
    // A sticky note has no source passage — the comment is the whole content.
    return `${position}. ${prefix}note: ${record.comment}`;
  }
  const head = `${position}. ${prefix}${record.type}: "${record.text}"`;
  return record.comment ? `${head}\n   user note: ${record.comment}` : head;
}

/** Per-kind tally, useful for chip tooltips. */
export function countAnnotationsByType(
  records: readonly AnnotationRecord[],
): Record<AnnotationKind, number> {
  const counts: Record<AnnotationKind, number> = {
    highlight: 0,
    underline: 0,
    note: 0,
  };
  for (const record of records || []) {
    if (record && TEXTUAL_ANNOTATION_TYPE_SET.has(record.type)) {
      counts[record.type] += 1;
    }
  }
  return counts;
}

function normalizeLimit(value: unknown, fallback: number): number {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.floor(limit));
}

/**
 * Build the annotation context block under an entry and character budget.
 *
 * Entries are taken in reading order, so a truncated block still covers the
 * front of the document rather than an arbitrary slice. At least one entry is
 * always kept: a single oversized highlight should still reach the model.
 */
export function buildAnnotationContextBlock(
  records: readonly AnnotationRecord[],
  options: AnnotationContextOptions = {},
): AnnotationContextBlock {
  const source = Array.isArray(records) ? records : [];
  const totalCount = source.length;
  if (!totalCount) {
    return { text: "", includedCount: 0, totalCount: 0, truncated: false };
  }

  const maxEntries = normalizeLimit(
    options.maxEntries,
    ANNOTATION_CONTEXT_MAX_ENTRIES,
  );
  const maxChars = normalizeLimit(
    options.maxChars,
    ANNOTATION_CONTEXT_MAX_CHARS,
  );

  const entries: string[] = [];
  let usedChars = 0;
  for (const record of source) {
    if (entries.length >= maxEntries) break;
    const entry = formatAnnotationEntry(record, entries.length + 1);
    const nextChars = usedChars + entry.length + (entries.length ? 1 : 0);
    if (entries.length && nextChars > maxChars) break;
    entries.push(entry);
    usedChars = nextChars;
  }

  if (!entries.length) {
    return { text: "", includedCount: 0, totalCount, truncated: false };
  }

  const truncated = entries.length < totalCount;
  const title = normalizeWhitespace(options.title);
  const header = title ? `[USER ANNOTATIONS — ${title}]` : "[USER ANNOTATIONS]";
  const lines = [
    header,
    "The passages below were highlighted or annotated by the user in the reader." +
      " They are the reader's own emphasis, so treat them as high-priority evidence" +
      " and stay consistent with what they marked.",
    "Cite the page of any annotation you rely on as [p.N], exactly as it appears below;" +
      " omit the citation when an entry carries no page.",
    truncated
      ? `Showing the first ${entries.length} of ${totalCount} annotations (truncated to fit the context budget).`
      : `${totalCount} annotation${totalCount === 1 ? "" : "s"}.`,
    "",
    ...entries,
  ];

  return {
    text: lines.join("\n"),
    includedCount: entries.length,
    totalCount,
    truncated,
  };
}

/**
 * Append the annotation block to a model prompt.
 *
 * Returns the question untouched when there is nothing to add, so callers can
 * apply it unconditionally.
 */
export function buildModelPromptWithAnnotationContext(
  baseQuestion: string,
  records: readonly AnnotationRecord[],
  options: AnnotationContextOptions = {},
): string {
  const block = buildAnnotationContextBlock(records, options);
  if (!block.text) return baseQuestion;
  const base = String(baseQuestion || "");
  return base.trim() ? `${base}\n\n${block.text}` : block.text;
}
