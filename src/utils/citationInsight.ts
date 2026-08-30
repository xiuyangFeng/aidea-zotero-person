/**
 * Citation insight — the works a passage cites, read back to the user.
 *
 * Reading a paper's body text means walking past `[12]` and `(Smith et al.,
 * 2024)` markers without knowing what sits behind them. This module turns a
 * reader selection into that list: the markers it contains, the bibliography
 * entry each one points at, and the prompt that asks the model to explain why
 * the authors reached for those works here.
 *
 * The input is the same text the chat context is built from, so PDFs arrive
 * with the `[page N]` markers `pageAnchors` injects and everything else (EPUB,
 * plain text) arrives without them. Markers are stripped before parsing and
 * remembered as the page an entry was printed on.
 *
 * Everything here is pure string handling: no Zotero runtime, no DOM. The
 * panel owns resolving the document, searching the library, and the UI.
 */

/** Whether a marker is a numbered citation or an author-year citation. */
export type CitationMarkerKind = "numeric" | "author-year";

export type CitationMarker = {
  kind: CitationMarkerKind;
  /** Marker as it should be shown back to the user, e.g. `[12]`. */
  raw: string;
  /** Citation number, for numbered markers. */
  number: number | null;
  /** First author's surname, for author-year markers. */
  author: string | null;
  /** Four-digit year, for author-year markers. */
  year: string | null;
  /** Dedup key: the same work cited twice in one passage yields one marker. */
  key: string;
};

export type ReferenceEntry = {
  /** Citation number for a numbered bibliography, else null. */
  number: number | null;
  /** Entry text, whitespace-collapsed and length-capped. */
  text: string;
  /** One-based page from the nearest preceding `[page N]` marker. */
  page: number | null;
};

export type CitationResolution = {
  marker: CitationMarker;
  /** Bibliography entry the marker points at, or null when not located. */
  reference: ReferenceEntry | null;
  /** Title of the matching Zotero item, filled in by the panel. */
  libraryTitle?: string | null;
};

/** A single `[12-15]` range never expands past this many citations. */
export const CITATION_RANGE_MAX_SPAN = 30;

/** Upper bound on the markers one selection may contribute. */
export const CITATION_MARKER_MAX_ENTRIES = 30;

/** Library lookups one run may issue; a long selection stays cheap. */
export const CITATION_LIBRARY_LOOKUP_MAX = 10;

/** Search hits examined per query; a title query returning more is too loose. */
export const CITATION_LIBRARY_MATCH_CANDIDATES = 8;

/** Share of the guessed title a library item must cover to count as the work. */
export const CITATION_LIBRARY_MATCH_MIN_SCORE = 0.6;

/** Numbers outside this range are years or measurements, not citations. */
const CITATION_NUMBER_MAX = 999;

/** Bibliography entries longer than this are cut; an entry is not a section. */
export const REFERENCE_ENTRY_MAX_LENGTH = 600;

/** An entry may wrap, but a whole column of text is not one entry. */
const REFERENCE_ENTRY_MAX_LINES = 8;

/** Below this a "References" section is a table-of-contents line, not the list. */
const REFERENCE_SECTION_MIN_LENGTH = 40;

/** Titles longer than this are cut; the query only needs the opening. */
export const REFERENCE_TITLE_MAX_LENGTH = 200;

/** Below this a "title" is an initial or a page range, not a title. */
const REFERENCE_TITLE_MIN_LENGTH = 8;

/** Words a shortened library query keeps; enough to be distinctive. */
const LIBRARY_QUERY_MAX_WORDS = 8;

/** The selected passage travels with the prompt only up to this length. */
export const CITATION_SELECTION_MAX_LENGTH = 1500;

const PAGE_MARKER_GLOBAL = /\[page\s+(\d{1,5})\]/gi;
const PAGE_MARKER_ONLY = /^\s*\[page\s+\d{1,5}\]\s*$/i;

// Every dash class below spells out the Unicode dash block plus the minus
// sign, because PDF extraction hands back whichever one the typesetter used.

/** `[12]`, `[12, 15]`, `[12-15]` — digits, separators, and dashes only. */
const NUMERIC_BRACKET = /\[([^[\]]{1,80})\]/g;
const NUMERIC_BRACKET_BODY = /^[\s\d,;‐-―−-]+$/;
const NUMERIC_RANGE = /^(\d{1,4})\s*[‐-―−-]\s*(\d{1,4})$/;

/** The dash joining `[12]–[14]`, which spans the brackets rather than sits in one. */
const BRACKET_RANGE_JOINER = /^\s*[‐-―−-]\s*$/;

const PAREN_GROUP = /\(([^()]{0,200})\)/g;
const YEAR = /\b((?:19|20)\d{2})[a-z]?\b/;
const YEAR_ONLY =
  /^\s*(?:19|20)\d{2}[a-z]?\s*(?:[,;]\s*(?:pp?\.?\s*[\d‐-―−-]+)?\s*)?$/i;

/** `e.g.`, `see also`, `cf.` — signal words that precede the actual name. */
const CITATION_SIGNAL_PREFIX =
  /^(?:e\.?\s?g\.?|i\.?\s?e\.?|see\s+also|see|cf\.?|cited\s+in|as\s+in|reviewed\s+in|following|after|viz\.?)[,.\s]+/i;

/** Separators between the first author and everything after them. */
const AUTHOR_TAIL = /\s+et\s+al\.?|\s*&\s*|\s+and\s+|[,;]/i;

/** Trailing narrative author of a `Smith et al. (2024)` citation. */
const NARRATIVE_AUTHOR =
  /([\p{Lu}\p{Lo}][\p{L}'’‐-―−-]*(?:\s+(?:et\s+al\.?|&\s*[\p{Lu}\p{Lo}][\p{L}'’-]*|and\s+[\p{Lu}\p{Lo}][\p{L}'’-]*))?)\s*$/u;

/** How far back a narrative citation's author may sit before its year. */
const NARRATIVE_AUTHOR_LOOKBEHIND = 60;

/** `References`, `7. Bibliography`, `参考文献` — on a line of its own. */
const REFERENCE_HEADING =
  /^(?:\d+(?:\.\d+)*\s*[.)]?\s*)?(?:references?(?:\s+list)?|bibliography|works\s+cited|literature\s+cited|参\s*考\s*文\s*献|參\s*考\s*文\s*獻|引\s*用\s*文\s*献|参\s*考\s*书\s*目)\s*[:：.]?$/i;

/**
 * The heading that ends the bibliography when a paper carries back matter.
 *
 * `Appendix A` and `Supplementary Material` carry a designator, so the match
 * is not anchored at the end of the line. The length guard below is what keeps
 * a sentence that merely mentions an appendix from cutting the section short.
 */
const REFERENCE_SECTION_END =
  /^(?:\d+(?:\.\d+)*\s*[.)]?\s*)?(?:appendi(?:x|ces|xes)|supplement(?:ary|al)|acknowledge?ments?|author\s+contributions?|conflicts?\s+of\s+interest|about\s+the\s+authors?|附\s*录|附\s*錄|致\s*谢|致\s*謝|作\s*者\s*简\s*介)\b/i;

/** A section-ending heading is a short line; a sentence mentioning one is not. */
const REFERENCE_SECTION_END_MAX_LENGTH = 80;

/** `[12] `, `(12) `, `12. `, `12) ` at the head of a bibliography entry. */
const NUMBERED_ENTRY_HEAD =
  /^[\s>*#·•|]*(?:\[(\d{1,4})\]\s*|\((\d{1,4})\)\s*|(\d{1,4})\s*[.)]\s+)/;

/** `Smith, J.` / `Smith, John` — how an author-year entry opens. */
const AUTHOR_ENTRY_START =
  /^[\p{Lu}\p{Lo}][\p{L}'’‐-―−\s-]{1,30},\s*(?:[\p{Lu}]\.|[\p{Lu}][\p{L}]+)/u;

/** Below this the section is not a numbered bibliography. */
const NUMBERED_BIBLIOGRAPHY_MIN_HEADS = 2;

const SENTENCE_END = /[.。．!！?？]["'”’)）\]]*$/;
const CJK_CHARACTER = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** Quoted spans, in the styles a bibliography uses for article titles. */
const QUOTED_TITLE =
  /["“”„«]([^"“”„«»]{6,300})["“”»]|「([^」]{6,300})」|『([^』]{6,300})』/g;

/** Segments that describe the venue rather than the work. */
const VENUE_SEGMENT =
  /(^|\s)(pp?\.|doi:|https?:\/\/|vol\.|no\.|isbn|arxiv preprint)/i;

/** Sentence break that is not the period after an author's initial. */
const TITLE_SEGMENT_BREAK = /(?<=[\p{Ll}\p{Lo}\d)\]”"’])[.?!]\s+/gu;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Drop `[page N]` markers so they never leak into parsed text. */
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

/** Lower-case, diacritic-free form used for every text comparison here. */
function foldText(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trimEnd()}…`;
}

function endsSentence(text: string): boolean {
  return Boolean(text) && SENTENCE_END.test(text);
}

/**
 * Append a wrapped line.
 *
 * PDF extraction keeps the typesetter's line breaks, so a word hyphenated
 * across a break is rejoined, two CJK lines are joined without a gap, and
 * everything else gets the single space the break stood for.
 */
function joinWrappedLines(text: string, line: string): string {
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

// ═══════════════════════════════════════════════════════════
// Marker extraction
// ═══════════════════════════════════════════════════════════

function isCitationNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= CITATION_NUMBER_MAX;
}

function makeNumericMarker(value: number): CitationMarker {
  return {
    kind: "numeric",
    raw: `[${value}]`,
    number: value,
    author: null,
    year: null,
    key: `n:${value}`,
  };
}

/** Expand `12-15` into its members, bounded so `[1-900]` cannot flood. */
function expandRange(from: number, to: number): number[] {
  if (!isCitationNumber(from) || !isCitationNumber(to) || to < from) return [];
  const out: number[] = [];
  for (let value = from; value <= to; value++) {
    out.push(value);
    if (out.length >= CITATION_RANGE_MAX_SPAN) break;
  }
  return out;
}

type BracketGroup = {
  start: number;
  end: number;
  numbers: number[];
  /** A `[12]` that could be one end of a `[12]–[14]` span. */
  single: number | null;
};

function parseNumericBracket(body: string): {
  numbers: number[];
  single: number | null;
} {
  const numbers: number[] = [];
  let single: number | null = null;
  const parts = body.split(/[,;]/);
  for (const part of parts) {
    const text = part.trim();
    if (!text) continue;
    const range = NUMERIC_RANGE.exec(text);
    if (range) {
      numbers.push(...expandRange(Number(range[1]), Number(range[2])));
      single = null;
      continue;
    }
    if (!/^\d{1,4}$/.test(text)) continue;
    const value = Number(text);
    if (!isCitationNumber(value)) continue;
    numbers.push(value);
    single = parts.length === 1 ? value : null;
  }
  return { numbers, single };
}

/**
 * Numbered markers in the order they appear.
 *
 * A bracket carrying anything but digits and separators is not a citation:
 * that rules out `[page 3]`, `[p.12]`, and the bracketed editorial notes a
 * quoted passage collects. A dash *between* two brackets is the `[12]–[14]`
 * span, which reads as a range even though neither bracket holds one.
 */
function extractNumericMarkers(text: string): CitationMarker[] {
  const groups: BracketGroup[] = [];
  const pattern = new RegExp(NUMERIC_BRACKET);
  let match = pattern.exec(text);
  while (match) {
    const body = match[1];
    if (NUMERIC_BRACKET_BODY.test(body) && /\d/.test(body)) {
      const parsed = parseNumericBracket(body);
      if (parsed.numbers.length) {
        groups.push({
          start: match.index,
          end: match.index + match[0].length,
          numbers: parsed.numbers,
          single: parsed.single,
        });
      }
    }
    match = pattern.exec(text);
  }

  const numbers: number[] = [];
  groups.forEach((group, index) => {
    numbers.push(...group.numbers);
    const next = groups[index + 1];
    if (!next || group.single === null || next.single === null) return;
    if (!BRACKET_RANGE_JOINER.test(text.slice(group.end, next.start))) return;
    numbers.push(...expandRange(group.single + 1, next.single - 1));
  });

  return numbers.map(makeNumericMarker);
}

/**
 * First author's surname of one author-year citation.
 *
 * Everything after the first author is dropped, because that is what a
 * bibliography sorts and searches on. A candidate without a single capital
 * (or CJK) letter is a leftover signal word such as `e.g.`, not a name.
 */
function extractFirstAuthorSurname(raw: string): string {
  const stripped = raw.trim().replace(CITATION_SIGNAL_PREFIX, "");
  const head = stripped.split(AUTHOR_TAIL)[0] || "";
  const name = head.replace(/[.\s]+$/, "").trim();
  if (name.length < 2 || name.length > 60) return "";
  if (/\d/.test(name)) return "";
  if (!/^[\p{L}]/u.test(name)) return "";
  if (!/[\p{Lu}\p{Lo}]/u.test(name)) return "";
  return name;
}

function makeAuthorYearMarker(
  author: string,
  year: string,
  raw: string,
): CitationMarker {
  return {
    kind: "author-year",
    raw,
    number: null,
    author,
    year,
    key: `a:${foldText(author)}:${year}`,
  };
}

/**
 * Author-year markers in the order they appear.
 *
 * A parenthesis holding several works separated by semicolons contributes one
 * marker per work. A parenthesis holding only a year belongs to the narrative
 * form `Smith et al. (2024)`, whose author sits in the sentence before it.
 */
function extractAuthorYearMarkers(text: string): CitationMarker[] {
  const markers: CitationMarker[] = [];
  const pattern = new RegExp(PAREN_GROUP);
  let match = pattern.exec(text);
  while (match) {
    const body = match[1];
    if (!YEAR.test(body)) {
      match = pattern.exec(text);
      continue;
    }

    if (YEAR_ONLY.test(body)) {
      const year = YEAR.exec(body)?.[1] || "";
      const before = text.slice(
        Math.max(0, match.index - NARRATIVE_AUTHOR_LOOKBEHIND),
        match.index,
      );
      const narrative = NARRATIVE_AUTHOR.exec(before.trimEnd());
      const author = narrative ? extractFirstAuthorSurname(narrative[1]) : "";
      if (author && year) {
        markers.push(
          makeAuthorYearMarker(author, year, `${narrative?.[1]} (${year})`),
        );
      }
      match = pattern.exec(text);
      continue;
    }

    for (const part of body.split(";")) {
      const chunk = part.trim();
      if (!chunk) continue;
      const yearMatch = YEAR.exec(chunk);
      if (!yearMatch) continue;
      const author = extractFirstAuthorSurname(
        chunk.slice(0, yearMatch.index).replace(/[,\s]+$/, ""),
      );
      if (!author) continue;
      markers.push(makeAuthorYearMarker(author, yearMatch[1], `(${chunk})`));
    }
    match = pattern.exec(text);
  }
  return markers;
}

/**
 * Every citation marker a selected passage contains.
 *
 * Numbered and author-year markers may both appear — a paper switching styles
 * mid-sentence is rare, but a passage quoting another paper is not. Duplicates
 * collapse to one entry, and anything unparseable yields an empty array rather
 * than an error.
 */
export function extractCitationMarkers(text: unknown): CitationMarker[] {
  try {
    const source = collapseWhitespace(stripPageMarkers(normalizeText(text)));
    if (!source) return [];
    const seen = new Set<string>();
    const markers: CitationMarker[] = [];
    for (const marker of [
      ...extractNumericMarkers(source),
      ...extractAuthorYearMarkers(source),
    ]) {
      if (seen.has(marker.key)) continue;
      seen.add(marker.key);
      markers.push(marker);
      if (markers.length >= CITATION_MARKER_MAX_ENTRIES) break;
    }
    return markers;
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// Bibliography location
// ═══════════════════════════════════════════════════════════

function splitLines(text: unknown): string[] {
  return normalizeText(text).replace(/\r\n?/g, "\n").split("\n");
}

/**
 * Line range holding the document's bibliography, end-exclusive.
 *
 * The last `References` heading wins, because an earlier one is usually a
 * table-of-contents entry. A heading whose section turns out to be too short
 * to be a bibliography is skipped in favour of the one before it, which is
 * what makes the table-of-contents case resolve to the real list instead of
 * to nothing.
 */
function locateReferencesSection(
  lines: readonly string[],
): { start: number; end: number } | null {
  const headings: number[] = [];
  lines.forEach((line, index) => {
    const clean = stripPageMarkers(line).trim();
    if (clean && REFERENCE_HEADING.test(clean)) headings.push(index);
  });
  if (!headings.length) return null;

  for (let cursor = headings.length - 1; cursor >= 0; cursor--) {
    const start = headings[cursor] + 1;
    let end = lines.length;
    for (let index = start; index < lines.length; index++) {
      const clean = stripPageMarkers(lines[index]).trim();
      if (!clean || clean.length > REFERENCE_SECTION_END_MAX_LENGTH) continue;
      if (REFERENCE_HEADING.test(clean)) continue;
      if (REFERENCE_SECTION_END.test(clean)) {
        end = index;
        break;
      }
    }
    const length = lines.slice(start, end).join("\n").trim().length;
    if (length >= REFERENCE_SECTION_MIN_LENGTH) return { start, end };
  }
  return null;
}

/** The document's bibliography, as raw lines. */
export function extractReferencesSection(text: unknown): string {
  try {
    const source = normalizeText(text);
    if (!source.trim()) return "";
    const lines = splitLines(source);
    const bounds = locateReferencesSection(lines);
    if (!bounds) return "";
    return lines.slice(bounds.start, bounds.end).join("\n");
  } catch {
    return "";
  }
}

type EntryHead = { number: number; rest: string };

function matchNumberedEntryHead(line: string): EntryHead | null {
  const match = NUMBERED_ENTRY_HEAD.exec(line);
  if (!match) return null;
  const raw = match[1] || match[2] || match[3];
  const value = Number(raw);
  if (!isCitationNumber(value)) return null;
  const rest = line.slice(match[0].length).trim();
  if (!rest) return null;
  return { number: value, rest };
}

type OpenEntry = {
  number: number | null;
  text: string;
  page: number | null;
  lines: number;
};

/**
 * Split a bibliography into its entries.
 *
 * A numbered list is cut on its numbers; anything else is cut on blank lines
 * plus the `Surname, I.` opening an author-year entry uses — but only when the
 * list is not numbered, so a wrapped author list inside `[12] …` is never
 * mistaken for the next entry. An entry stops at the caps either way, so a
 * missing blank line cannot swallow the rest of the section.
 */
export function extractReferenceEntries(text: unknown): ReferenceEntry[] {
  try {
    const lines = splitLines(text);
    const bounds = locateReferencesSection(lines);
    if (!bounds) return [];

    const sectionLines = lines.slice(bounds.start, bounds.end);
    const numberedHeads = sectionLines.reduce(
      (count, line) =>
        count + (matchNumberedEntryHead(stripPageMarkers(line).trim()) ? 1 : 0),
      0,
    );
    const numbered = numberedHeads >= NUMBERED_BIBLIOGRAPHY_MIN_HEADS;

    const entries: ReferenceEntry[] = [];
    let current: OpenEntry | null = null;
    let page: number | null = null;

    const close = () => {
      if (!current) return;
      const entryText = truncate(
        collapseWhitespace(current.text),
        REFERENCE_ENTRY_MAX_LENGTH,
      );
      if (entryText) {
        entries.push({
          number: current.number,
          text: entryText,
          page: current.page,
        });
      }
      current = null;
    };

    // Pages are counted from the top of the document, not from the heading:
    // the marker that names the bibliography's first page usually sits on the
    // page before it, outside the section.
    for (let index = 0; index < bounds.end; index++) {
      const rawLine = lines[index];
      const markerPage = readLinePage(rawLine);
      if (markerPage !== null) page = markerPage;
      if (index < bounds.start) continue;
      if (PAGE_MARKER_ONLY.test(rawLine)) {
        close();
        continue;
      }
      const line = stripPageMarkers(rawLine).trim();
      if (!line) {
        close();
        continue;
      }

      const head = matchNumberedEntryHead(line);
      if (head) {
        close();
        current = { number: head.number, text: head.rest, page, lines: 1 };
        continue;
      }
      if (!numbered && current && endsSentence(current.text)) {
        if (AUTHOR_ENTRY_START.test(line)) {
          close();
          current = { number: null, text: line, page, lines: 1 };
          continue;
        }
      }
      if (
        !current ||
        current.lines >= REFERENCE_ENTRY_MAX_LINES ||
        current.text.length >= REFERENCE_ENTRY_MAX_LENGTH
      ) {
        close();
        current = { number: null, text: line, page, lines: 1 };
        continue;
      }
      current.text = joinWrappedLines(current.text, line);
      current.lines += 1;
    }
    close();
    return entries;
  } catch {
    return [];
  }
}

/**
 * The bibliography entry a marker points at, or null when it is not there.
 *
 * A numbered marker matches on its number. An author-year marker matches on
 * the first author's surname plus the year, preferring the entry whose surname
 * sits nearest the start — that is the entry the bibliography sorted under
 * that name, rather than one that merely cites it in a note.
 */
export function findReferenceForMarker(
  marker: CitationMarker,
  entries: readonly ReferenceEntry[],
): ReferenceEntry | null {
  if (!marker || !Array.isArray(entries) || !entries.length) return null;
  if (marker.kind === "numeric") {
    if (marker.number === null) return null;
    return entries.find((entry) => entry.number === marker.number) || null;
  }
  const author = foldText(marker.author || "");
  const year = marker.year || "";
  if (!author || !year) return null;

  let best: ReferenceEntry | null = null;
  let bestIndex = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const folded = foldText(entry.text);
    if (!folded.includes(year)) continue;
    const index = folded.indexOf(author);
    if (index < 0 || index >= bestIndex) continue;
    best = entry;
    bestIndex = index;
  }
  return best;
}

/**
 * Pair every marker of a passage with the bibliography entry behind it.
 *
 * The bibliography is parsed once for the whole batch. A marker with no entry
 * keeps a null reference rather than dropping out, so the prompt can say the
 * reference list did not carry it instead of silently shortening the list.
 */
export function resolveCitationReferences(
  markers: readonly CitationMarker[],
  fullText: unknown,
): CitationResolution[] {
  const list = Array.isArray(markers) ? markers : [];
  if (!list.length) return [];
  const entries = extractReferenceEntries(fullText);
  return list.map((marker) => ({
    marker,
    reference: findReferenceForMarker(marker, entries),
  }));
}

// ═══════════════════════════════════════════════════════════
// Library matching
// ═══════════════════════════════════════════════════════════

function stripEntryHead(text: string): string {
  const match = NUMBERED_ENTRY_HEAD.exec(text);
  return match ? text.slice(match[0].length) : text;
}

/**
 * Cut the leading author-and-year block off an APA-style entry.
 *
 * `Smith, J., & Jones, A. (2024). Title…` keeps everything after the year's
 * closing bracket, which is exactly where the title starts. An entry without
 * a parenthesised year is left alone for the segment scan to handle.
 */
function stripLeadingAuthorYear(text: string): string {
  const match = /^[^()]{0,200}\((?:19|20)\d{2}[a-z]?\)[.,\s]*/.exec(text);
  return match ? text.slice(match[0].length) : text;
}

function isVenueSegment(segment: string): boolean {
  if (VENUE_SEGMENT.test(segment)) return true;
  const digits = (segment.match(/\d/g) || []).length;
  return digits / Math.max(1, segment.length) > 0.25;
}

function cleanTitleCandidate(value: string): string {
  return collapseWhitespace(value)
    .replace(/^[\s"“”„«»'’,.:;-]+/, "")
    .replace(/[\s"“”„«»'’,.:;]+$/, "");
}

/**
 * Best guess at the title of a work, from its bibliography entry.
 *
 * A quoted span is the answer whenever one exists: every numeric style puts
 * the article title in quotes and nothing else. Otherwise the entry is cut
 * down past the authors and the year, split on sentence boundaries that are
 * not the period after an initial, and the longest surviving segment wins —
 * a title is the longest run of prose an entry carries, once the venue,
 * volume, and page segments are dropped.
 *
 * The result feeds a library search, so a wrong guess costs one query that
 * finds nothing. An entry too short or too numeric to guess from yields "".
 */
export function guessReferenceTitle(entryText: unknown): string {
  try {
    const source = collapseWhitespace(normalizeText(entryText));
    if (!source) return "";

    const quoted: string[] = [];
    const pattern = new RegExp(QUOTED_TITLE);
    let quotedMatch = pattern.exec(source);
    while (quotedMatch) {
      const candidate = cleanTitleCandidate(
        quotedMatch[1] || quotedMatch[2] || quotedMatch[3] || "",
      );
      if (candidate.length >= REFERENCE_TITLE_MIN_LENGTH)
        quoted.push(candidate);
      quotedMatch = pattern.exec(source);
    }
    if (quoted.length) {
      const best = quoted.reduce((a, b) => (b.length > a.length ? b : a));
      return truncate(best, REFERENCE_TITLE_MAX_LENGTH);
    }

    const body = stripLeadingAuthorYear(stripEntryHead(source));
    const segments = body
      .split(TITLE_SEGMENT_BREAK)
      .map(cleanTitleCandidate)
      .filter(
        (segment) =>
          segment.length >= REFERENCE_TITLE_MIN_LENGTH &&
          !isVenueSegment(segment),
      );
    if (!segments.length) return "";
    const best = segments.reduce((a, b) => (b.length > a.length ? b : a));
    return truncate(best, REFERENCE_TITLE_MAX_LENGTH);
  } catch {
    return "";
  }
}

/**
 * Search strings to try for one guessed title, most precise first.
 *
 * The full guess is exact enough that a hit is certainly the right work. PDF
 * extraction mangles long titles often enough — a stray hyphen, a dropped
 * ligature — that a shortened opening is worth a second query when the first
 * one comes back empty.
 */
export function buildLibraryTitleQueries(titleGuess: unknown): string[] {
  const title = cleanTitleCandidate(normalizeText(titleGuess));
  if (title.length < REFERENCE_TITLE_MIN_LENGTH) return [];
  const queries = [title];
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length > LIBRARY_QUERY_MAX_WORDS) {
    // A query ending on `of` or `the` is a prefix of nothing useful, so the
    // trailing function words come off before the query is worth issuing.
    const head = words.slice(0, LIBRARY_QUERY_MAX_WORDS);
    while (head.length > 2 && head[head.length - 1].length < 3) head.pop();
    const short = head.join(" ");
    if (short.length >= REFERENCE_TITLE_MIN_LENGTH && short !== title) {
      queries.push(short);
    }
  }
  return queries;
}

/**
 * How much of a guessed title a library item's title actually covers, 0..1.
 *
 * The panel uses this to reject the loose hits a shortened query can return,
 * so it is deliberately asymmetric: a long library title that contains every
 * word of the guess still scores 1.
 */
export function scoreTitleMatch(candidate: unknown, guess: unknown): number {
  const guessTokens = foldText(collapseWhitespace(normalizeText(guess)))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
  if (!guessTokens.length) return 0;
  const candidateTokens = new Set(
    foldText(collapseWhitespace(normalizeText(candidate)))
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 2),
  );
  if (!candidateTokens.size) return 0;
  const hits = guessTokens.reduce(
    (count, token) => count + (candidateTokens.has(token) ? 1 : 0),
    0,
  );
  return hits / guessTokens.length;
}

// ═══════════════════════════════════════════════════════════
// Prompt
// ═══════════════════════════════════════════════════════════

export type CitationInsightLang = "en-US" | "zh-CN";

/** Explanation copy exists in English and Simplified Chinese only. */
export function resolveCitationInsightLang(
  lang: string | null | undefined,
): CitationInsightLang {
  return String(lang || "").startsWith("zh") ? "zh-CN" : "en-US";
}

const CITATION_INSIGHT_COPY: Record<
  CitationInsightLang,
  {
    heading: string;
    passageLabel: string;
    citationsLabel: string;
    referenceLabel: string;
    referenceMissing: string;
    inLibrary: (title: string) => string;
    pageLabel: (page: number) => string;
    /** Parenthetical appended to an entry, empty when there is nothing to add. */
    notes: (parts: string[]) => string;
    rules: string[];
    pageRule: string;
    noPageRule: string;
  }
> = {
  "en-US": {
    heading:
      "Explain the works cited in the passage I selected from this document.",
    passageLabel: "Selected passage:",
    citationsLabel: "Citations found in the passage:",
    referenceLabel: "Reference list entry:",
    referenceMissing:
      "not found in the reference list — work from the marker and the passage, and say the entry could not be located",
    inLibrary: (title) =>
      `already in the user's Zotero library as “${title}” — say so, and offer it as something they can open`,
    pageLabel: (page) => `printed on page ${page}`,
    notes: (parts) => (parts.length ? ` (${parts.join("; ")})` : ""),
    rules: [
      "- Take the citations in the order listed, one short block each, headed by its marker.",
      "- (a) Say what the cited work is: title, authors, year, and its subject in one sentence.",
      "- (b) Say why the authors reach for it right here, reading the selected passage: supporting evidence, a method being compared against, a tool or dataset being reused, background, a claim being pushed back on, and so on.",
      "- (c) Say how it relates to this paper — what the citation contributes to the argument being made.",
      "- Stay compact: a few sentences per citation, and never restate the reference entry verbatim.",
      "- Say plainly when the reference entry or the surrounding text does not settle something, rather than inventing a title or a purpose.",
    ],
    pageRule:
      "- Cite the page of every key claim as [p.N], taking N from the nearest preceding [page N] marker.",
    noPageRule:
      "- This document carries no page markers, so do not cite page numbers.",
  },
  "zh-CN": {
    heading: "解读我在这篇文档中选中的这段话里引用的文献。",
    passageLabel: "选中片段：",
    citationsLabel: "片段中的引用：",
    referenceLabel: "参考文献原文：",
    referenceMissing:
      "未能在参考文献区段中定位到——只依据标记和选中片段推断，并说明没有找到条目",
    inLibrary: (title) =>
      `这篇在用户的 Zotero 文库中已有，题为《${title}》——请说明这一点，并提示可以直接打开`,
    pageLabel: (page) => `位于第 ${page} 页`,
    notes: (parts) => (parts.length ? `（${parts.join("；")}）` : ""),
    rules: [
      "- 按清单顺序逐条讲，每条一小段，段首写出该引用标记。",
      "- (a) 这篇被引文献是什么：题目、作者、年份，再用一句话说清主题。",
      "- (b) 结合选中片段的上下文，作者在这里引它做什么：支撑论据、对比方法、沿用工具或数据集、背景铺垫、反驳某个说法等等。",
      "- (c) 它与本文的关系——这次引用为作者的论证贡献了什么。",
      "- 保持紧凑：每条几句话即可，不要照抄参考文献原文。",
      "- 参考文献原文或正文交代不清的地方要直说，不要编造题目或用途。",
    ],
    pageRule: "- 关键论断后用 [p.N] 标注页码，N 取自最近的 [page N] 标记。",
    noPageRule: "- 本文档没有页码标记，不要标注页码。",
  },
};

export type BuildCitationInsightPromptOptions = {
  /** The passage the user selected in the reader. */
  selection: string;
  /** Markers paired with their reference entries, in reading order. */
  resolutions: readonly CitationResolution[];
  lang?: string;
  /** Whether the document carries `[page N]` markers to cite from. */
  pageCitations?: boolean;
};

/**
 * Prompt for the "explain the selected citations" action.
 *
 * The document's full text is already the conversation's base context, so the
 * prompt carries only the passage and the reference entries — quoting them
 * back is what keeps the model from reconstructing a bibliography it can only
 * half remember, and it is what makes an unlocated entry visible as such.
 */
export function buildCitationInsightPrompt(
  options: BuildCitationInsightPromptOptions,
): string {
  const resolutions = Array.isArray(options?.resolutions)
    ? options.resolutions
    : [];
  if (!resolutions.length) return "";
  const selection = truncate(
    collapseWhitespace(stripPageMarkers(normalizeText(options.selection))),
    CITATION_SELECTION_MAX_LENGTH,
  );
  if (!selection) return "";
  const copy = CITATION_INSIGHT_COPY[resolveCitationInsightLang(options.lang)];

  const list = resolutions.map((resolution, index) => {
    const lines = [`${index + 1}. ${resolution.marker.raw}`];
    const reference = resolution.reference;
    if (reference) {
      const notes: string[] = [];
      if (reference.page !== null) notes.push(copy.pageLabel(reference.page));
      const libraryTitle = String(resolution.libraryTitle || "").trim();
      if (libraryTitle) notes.push(copy.inLibrary(libraryTitle));
      lines.push(
        `   ${copy.referenceLabel}${reference.text}${copy.notes(notes)}`,
      );
    } else {
      lines.push(`   ${copy.referenceLabel}${copy.referenceMissing}`);
    }
    return lines.join("\n");
  });

  const rules = [
    ...copy.rules,
    options.pageCitations === false ? copy.noPageRule : copy.pageRule,
  ];

  return [
    copy.heading,
    `${copy.passageLabel}\n"""\n${selection}\n"""`,
    `${copy.citationsLabel}\n${list.join("\n")}`,
    rules.join("\n"),
  ].join("\n\n");
}
