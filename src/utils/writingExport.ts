/**
 * Writing export — turn an answer's page anchors into real citations.
 *
 * A multi-paper answer attributes its claims with `[p.12]` / `[S2 p.12]`
 * anchors. Those are provenance markers, not citations: pasting them into a
 * manuscript leaves the reader with nothing to look up. This module rewrites
 * every anchor it can place into an in-text citation and appends the reference
 * list for the works it used, so the answer can be dropped into a draft.
 *
 * The output is a draft, not typeset bibliography. Producing real CSL output
 * means running Zotero's citation processor over a style file, which is the
 * job of the Word/LaTeX integration the author will use anyway. What is worth
 * automating is the mapping — anchor to item — because only the plugin knows
 * which paper `S2` was.
 *
 * Everything here is pure string handling apart from
 * `getWritingCitationStylePreference`, which reads its preference defensively
 * so the module stays usable without a Zotero runtime. Resolving anchors to
 * Zotero items lives in `modules/contextPanel/writingExport`.
 */

import { config } from "../../package.json";
import {
  createPageAnchorPattern,
  normalizePageAnchor,
  type PageAnchor,
} from "./pageAnchors";

/**
 * Language-neutral tag attached to every exported draft.
 *
 * Deliberately not localized, for the same reason as the glossary tag: one tag
 * keeps a single Zotero saved search covering drafts exported in either UI
 * language.
 */
export const WRITING_DRAFT_NOTE_TAG = "aidea-writing-draft";

/** Preference choosing between citation keys and author-year citations. */
export const WRITING_CITATION_STYLE_PREF_KEY = "writingExport.citationStyle";

/** What the user asked for; `auto` defers to what the library can support. */
export type WritingCitationStylePreference = "auto" | "citekey" | "author-year";

/** What a draft is actually rendered in, once `auto` has been resolved. */
export type WritingCitationStyle = "citekey" | "author-year";

export const WRITING_CITATION_STYLE_PREFERENCES: readonly WritingCitationStylePreference[] =
  ["auto", "citekey", "author-year"];

/** Zotero creator, narrowed to the fields a citation needs. */
export type WritingCreator = {
  firstName?: string;
  lastName?: string;
  /** Zotero's single-field mode (1): the whole name sits in `lastName`. */
  fieldMode?: number;
};

/** One cited work, denormalized out of Zotero before any formatting runs. */
export type WritingSource = {
  /** Stable identity used to fold repeat citations into one reference. */
  id: string;
  /** Better BibTeX key, or Zotero's own citation key when it carries one. */
  citationKey?: string;
  creators?: readonly WritingCreator[];
  title?: string;
  /** Raw Zotero date field; the year is extracted from it. */
  date?: string;
  /** Journal, book, proceedings or publisher — whichever resolved first. */
  publication?: string;
};

/** Resolver handed in by the panel; null means the anchor could not be placed. */
export type WritingSourceResolver = (
  anchor: PageAnchor,
) => WritingSource | null;

/** A work that made it into the reference list. */
export type WritingReference = {
  source: WritingSource;
  /** How many anchors in the answer pointed at this work. */
  citationCount: number;
};

/** An anchor that stayed in the text because nothing resolved it. */
export type WritingUnresolvedAnchor = {
  /** Verbatim anchor token, for example `[S3 p.12]`. */
  raw: string;
  count: number;
};

export type BuildWritingDraftOptions = {
  /** Assistant answer to rewrite. */
  text: string;
  resolveSource: WritingSourceResolver;
  style: WritingCitationStyle;
  lang?: string;
  /** Timestamp line under the heading; omitted when empty. */
  generatedAt?: string;
};

export type WritingDraftResult = {
  /** Full note body: heading, rewritten answer, references, warnings. */
  markdown: string;
  /** Rewritten answer on its own, without heading or reference list. */
  body: string;
  /** Cited works, ordered the way the reference list prints them. */
  references: WritingReference[];
  unresolved: WritingUnresolvedAnchor[];
  /** Total anchors that were rewritten into citations. */
  resolvedAnchorCount: number;
  /** Total anchors left in place because they could not be resolved. */
  unresolvedAnchorCount: number;
};

type WritingExportLang = "en-US" | "zh-CN";

const CJK_PATTERN =
  /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/;

const YEAR_PATTERN = /\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/;

function collapse(value: unknown): string {
  if (typeof value !== "string") return "";
  return (
    value
      // eslint-disable-next-line no-control-regex -- strips unsafe stored characters
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function isCjkName(value: string): boolean {
  return CJK_PATTERN.test(value);
}

/**
 * Draft copy exists in English and Simplified Chinese only; other panel
 * languages fall back to English, matching how the glossary export resolves.
 */
export function resolveWritingExportLang(
  lang: string | null | undefined,
): WritingExportLang {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

type WritingExportCopy = {
  heading: string;
  subtitle: (timestamp: string) => string;
  disclaimer: string;
  referencesHeading: string;
  unresolvedHeading: string;
  unresolvedIntro: string;
  unresolvedCount: (count: number) => string;
  noDate: string;
  untitled: string;
  unknownAuthor: string;
};

const WRITING_EXPORT_COPY: Record<WritingExportLang, WritingExportCopy> = {
  "en-US": {
    heading: "# Writing draft",
    subtitle: (timestamp) => `Exported by AIdea — ${timestamp}`,
    disclaimer:
      "In-text citations and the reference list below are a draft. Typeset the final version with Zotero's word processor plugin or BibTeX.",
    referencesHeading: "## References",
    unresolvedHeading: "## Unresolved citations",
    unresolvedIntro:
      "These anchors could not be matched to a Zotero item and were left in the text unchanged:",
    unresolvedCount: (count) => `${count} occurrence${count === 1 ? "" : "s"}`,
    noDate: "n.d.",
    untitled: "Untitled",
    unknownAuthor: "Unknown",
  },
  "zh-CN": {
    heading: "# 写作草稿",
    subtitle: (timestamp) => `由 AIdea 导出 — ${timestamp}`,
    disclaimer:
      "文中引用与文末参考文献表均为草稿，正式排版请在 Word/LaTeX 中使用 Zotero 插件或 BibTeX 完成。",
    referencesHeading: "## 参考文献",
    unresolvedHeading: "## 未能解析的引用",
    unresolvedIntro: "以下锚点没能对应到 Zotero 条目，正文中已按原样保留：",
    unresolvedCount: (count) => `${count} 处`,
    noDate: "无日期",
    untitled: "无标题",
    unknownAuthor: "佚名",
  },
};

/** Normalize a stored or user-supplied style value; unknown falls back to auto. */
export function normalizeWritingCitationStylePreference(
  value: unknown,
): WritingCitationStylePreference {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "citekey") return "citekey";
  if (normalized === "author-year") return "author-year";
  return "auto";
}

/**
 * Preferred citation style. Defaults to `auto`, including when no Zotero
 * runtime is available.
 */
export function getWritingCitationStylePreference(): WritingCitationStylePreference {
  try {
    const prefs = (globalThis as { Zotero?: { Prefs?: { get?: unknown } } })
      .Zotero?.Prefs;
    if (typeof prefs?.get !== "function") return "auto";
    const value = (prefs.get as (key: string, global?: boolean) => unknown)(
      `${config.prefsPrefix}.${WRITING_CITATION_STYLE_PREF_KEY}`,
      true,
    );
    return normalizeWritingCitationStylePreference(value);
  } catch {
    return "auto";
  }
}

/**
 * Decide how a draft cites.
 *
 * `auto` follows Better BibTeX: with it installed the author almost certainly
 * writes in pandoc or LaTeX, where `[@key]` is what compiles. Without it there
 * are no stable keys to cite, so author-year is the only honest choice. An
 * explicit preference is obeyed either way; a work missing a key still degrades
 * to author-year at render time rather than emitting `[@]`.
 */
export function resolveWritingCitationStyle(
  preference: WritingCitationStylePreference,
  hasBetterBibTeX: boolean,
): WritingCitationStyle {
  if (preference === "citekey") return "citekey";
  if (preference === "author-year") return "author-year";
  return hasBetterBibTeX ? "citekey" : "author-year";
}

/** Four-digit publication year taken from a Zotero date field. */
export function extractPublicationYear(value: unknown): string {
  const text = collapse(value);
  if (!text) return "";
  return text.match(YEAR_PATTERN)?.[0] || "";
}

/**
 * Name used in an in-text citation.
 *
 * Western citations name the author by surname alone; a Chinese one names the
 * whole person, because a bare 张 identifies nobody. Single-field creators
 * ("Ministry of Health") carry their whole name in `lastName`, which is also
 * the right thing to print.
 */
export function formatCreatorSurname(
  creator: WritingCreator | null | undefined,
): string {
  const lastName = collapse(creator?.lastName);
  const firstName = collapse(creator?.firstName);
  if (!lastName) return firstName;
  if (Number(creator?.fieldMode) === 1 || !firstName) return lastName;
  return isCjkName(lastName) ? `${lastName}${firstName}` : lastName;
}

function toInitials(firstName: string): string {
  return firstName
    .split(/[\s.]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}.`)
    .join(" ");
}

/** Full name as a reference list prints it, for example `Smith, J. R.`. */
export function formatCreatorReferenceName(
  creator: WritingCreator | null | undefined,
): string {
  const lastName = collapse(creator?.lastName);
  const firstName = collapse(creator?.firstName);
  if (!lastName) return firstName;
  if (Number(creator?.fieldMode) === 1 || !firstName) return lastName;
  // A Chinese name is written surname-first with nothing between the parts;
  // initialising it would destroy the given name.
  if (isCjkName(lastName)) return `${lastName}${firstName}`;
  const initials = toInitials(firstName);
  return initials ? `${lastName}, ${initials}` : lastName;
}

/**
 * Author label for an in-text citation.
 *
 * Follows the convention every author-year style shares: one name alone, two
 * names joined, three or more abbreviated after the first. Chinese names take
 * the Chinese abbreviation instead of a Latin one.
 */
export function formatInTextAuthors(
  creators: readonly WritingCreator[] | null | undefined,
): string {
  const names = (creators || [])
    .map((creator) => formatCreatorSurname(creator))
    .filter(Boolean);
  if (!names.length) return "";
  const cjk = isCjkName(names[0]);
  if (names.length === 1) return names[0];
  if (names.length === 2) {
    return cjk ? `${names[0]}、${names[1]}` : `${names[0]} & ${names[1]}`;
  }
  return cjk ? `${names[0]} 等` : `${names[0]} et al.`;
}

/**
 * Author list for a reference entry, with every creator spelled out.
 *
 * The punctuation follows the names rather than the export language: a Chinese
 * reference reads `张伟、李娜` whatever the panel is set to, and an English one
 * keeps its serial ampersand even in a Chinese draft.
 */
export function formatReferenceAuthors(
  creators: readonly WritingCreator[] | null | undefined,
): string {
  const names = (creators || [])
    .map((creator) => formatCreatorReferenceName(creator))
    .filter(Boolean);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (isCjkName(names[0])) return names.join("、");
  if (names.length === 2) return names.join(" & ");
  return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

/** Page locator kept inside the citation, for example `p. 12` / `pp. 12-14`. */
export function formatCitationLocator(anchor: PageAnchor): string {
  if (!Number.isFinite(anchor?.page) || anchor.page <= 0) return "";
  return anchor.endPage
    ? `pp. ${anchor.page}-${anchor.endPage}`
    : `p. ${anchor.page}`;
}

type CitationSlot = { source: WritingSource; anchor: PageAnchor };

function hasCitationKey(source: WritingSource): boolean {
  return Boolean(collapse(source.citationKey));
}

/**
 * Render one bracket of citations.
 *
 * Citation keys are all-or-nothing per bracket: mixing `[@a; (Smith, 2024)]`
 * produces something neither pandoc nor a human parses, so a bracket with any
 * keyless work falls back to author-year for all of it.
 */
export function formatCitationGroup(
  slots: readonly CitationSlot[],
  style: WritingCitationStyle,
  lang?: string,
): string {
  const copy = WRITING_EXPORT_COPY[resolveWritingExportLang(lang)];
  const unique: CitationSlot[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    const key = `${slot.source.id}|${formatCitationLocator(slot.anchor)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(slot);
  }
  if (!unique.length) return "";

  if (
    style === "citekey" &&
    unique.every((slot) => hasCitationKey(slot.source))
  ) {
    const parts = unique.map((slot) => {
      const locator = formatCitationLocator(slot.anchor);
      const key = collapse(slot.source.citationKey);
      return locator ? `@${key}, ${locator}` : `@${key}`;
    });
    return `[${parts.join("; ")}]`;
  }

  const parts = unique.map((slot) => {
    const authors =
      formatInTextAuthors(slot.source.creators) ||
      collapse(slot.source.title) ||
      copy.unknownAuthor;
    const year = extractPublicationYear(slot.source.date) || copy.noDate;
    const locator = formatCitationLocator(slot.anchor);
    return locator ? `${authors}, ${year}, ${locator}` : `${authors}, ${year}`;
  });
  return `(${parts.join("; ")})`;
}

type AnchorMatch = {
  raw: string;
  start: number;
  end: number;
  anchor: PageAnchor | null;
};

function collectAnchorMatches(text: string): AnchorMatch[] {
  const matches: AnchorMatch[] = [];
  const pattern = createPageAnchorPattern();
  let match = pattern.exec(text);
  while (match) {
    matches.push({
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
      anchor: normalizePageAnchor({
        sourceId: match[1],
        page: match[2],
        endPage: match[3],
      }),
    });
    match = pattern.exec(text);
  }
  return matches;
}

/**
 * Rewrite every resolvable anchor into a citation.
 *
 * Anchors that sit side by side describe one claim drawn from several papers,
 * so they collapse into a single bracket. An anchor nothing resolves is copied
 * through untouched — dropping it would silently erase the only provenance the
 * answer had.
 */
function rewriteAnchors(
  text: string,
  resolveSource: WritingSourceResolver,
  style: WritingCitationStyle,
  lang: string | undefined,
): {
  body: string;
  cited: Map<string, WritingReference>;
  unresolved: Map<string, WritingUnresolvedAnchor>;
  resolvedAnchorCount: number;
  unresolvedAnchorCount: number;
} {
  const source = String(text || "");
  const matches = collectAnchorMatches(source);
  const cited = new Map<string, WritingReference>();
  const unresolved = new Map<string, WritingUnresolvedAnchor>();
  let resolvedAnchorCount = 0;
  let unresolvedAnchorCount = 0;

  const resolved = matches.map((match) => {
    let slotSource: WritingSource | null = null;
    if (match.anchor) {
      try {
        slotSource = resolveSource(match.anchor) || null;
      } catch {
        slotSource = null;
      }
    }
    if (slotSource && !collapse(slotSource.id)) slotSource = null;
    return { ...match, source: slotSource };
  });

  let out = "";
  let cursor = 0;
  let index = 0;
  while (index < resolved.length) {
    const current = resolved[index];
    if (!current.anchor || !current.source) {
      unresolvedAnchorCount += 1;
      const entry = unresolved.get(current.raw);
      if (entry) entry.count += 1;
      else unresolved.set(current.raw, { raw: current.raw, count: 1 });
      index += 1;
      continue;
    }

    let last = index;
    const slots: CitationSlot[] = [
      { source: current.source, anchor: current.anchor },
    ];
    while (last + 1 < resolved.length) {
      const next = resolved[last + 1];
      if (!next.anchor || !next.source) break;
      // Only inline spacing may separate anchors that describe one claim; a
      // line break means the next anchor belongs to the next sentence.
      if (!/^[ \t]*$/.test(source.slice(resolved[last].end, next.start))) break;
      slots.push({ source: next.source, anchor: next.anchor });
      last += 1;
    }

    out += source.slice(cursor, current.start);
    out += formatCitationGroup(slots, style, lang);
    cursor = resolved[last].end;

    for (const slot of slots) {
      resolvedAnchorCount += 1;
      const existing = cited.get(slot.source.id);
      if (existing) existing.citationCount += 1;
      else cited.set(slot.source.id, { source: slot.source, citationCount: 1 });
    }
    index = last + 1;
  }
  out += source.slice(cursor);

  return {
    body: out,
    cited,
    unresolved,
    resolvedAnchorCount,
    unresolvedAnchorCount,
  };
}

function referenceSortKey(source: WritingSource): string {
  const first = (source.creators || []).find((creator) =>
    formatCreatorSurname(creator),
  );
  return formatCreatorSurname(first) || collapse(source.title);
}

/**
 * Order the reference list the way a reader scans it.
 *
 * `Intl.Collator` sorts Chinese by pinyin wherever ICU data is available,
 * which is what "alphabetical" means for a mixed reference list; the plain
 * comparison is only a fallback for environments without it.
 */
export function sortWritingReferences(
  references: readonly WritingReference[],
  lang?: string,
): WritingReference[] {
  const locale =
    resolveWritingExportLang(lang) === "zh-CN" ? "zh-Hans-CN" : "en";
  let compare: (a: string, b: string) => number;
  try {
    const collator = new Intl.Collator(locale, {
      numeric: true,
      sensitivity: "base",
    });
    compare = (a, b) => collator.compare(a, b);
  } catch {
    compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  }
  return [...references].sort((a, b) => {
    const byAuthor = compare(
      referenceSortKey(a.source),
      referenceSortKey(b.source),
    );
    if (byAuthor !== 0) return byAuthor;
    const byYear = compare(
      extractPublicationYear(a.source.date),
      extractPublicationYear(b.source.date),
    );
    if (byYear !== 0) return byYear;
    return compare(collapse(a.source.title), collapse(b.source.title));
  });
}

function endSentence(value: string): string {
  const text = collapse(value);
  if (!text) return "";
  return /[.。!?！？]$/.test(text) ? text : `${text}.`;
}

/**
 * One reference entry: author, year, title, container.
 *
 * Deliberately not CSL. A draft only has to identify the work well enough for
 * the author to recognise it and for a word processor to replace it later, and
 * every field here comes straight from Zotero without a style file.
 */
export function formatReferenceEntry(
  source: WritingSource,
  style: WritingCitationStyle,
  lang?: string,
): string {
  const copy = WRITING_EXPORT_COPY[resolveWritingExportLang(lang)];
  const authors = formatReferenceAuthors(source.creators);
  const year = extractPublicationYear(source.date) || copy.noDate;
  const title = collapse(source.title) || copy.untitled;
  const publication = collapse(source.publication);
  const citationKey = collapse(source.citationKey);

  const segments: string[] = [];
  if (style === "citekey" && citationKey) segments.push(`[@${citationKey}]`);
  if (authors) segments.push(endSentence(authors));
  segments.push(`(${year}).`);
  segments.push(endSentence(title));
  if (publication) segments.push(endSentence(publication));
  return segments.join(" ");
}

/**
 * Turn one assistant answer into a citable draft.
 *
 * The answer's prose is untouched apart from the anchors; the reference list
 * and the unresolved-anchor warning are appended so nothing about the mapping
 * stays implicit.
 */
export function buildWritingDraft(
  options: BuildWritingDraftOptions,
): WritingDraftResult {
  const lang = options.lang;
  const copy = WRITING_EXPORT_COPY[resolveWritingExportLang(lang)];
  const rewritten = rewriteAnchors(
    options.text,
    options.resolveSource,
    options.style,
    lang,
  );
  const body = rewritten.body.trim();
  const references = sortWritingReferences([...rewritten.cited.values()], lang);
  const unresolved = [...rewritten.unresolved.values()];

  if (!body) {
    return {
      markdown: "",
      body: "",
      references,
      unresolved,
      resolvedAnchorCount: rewritten.resolvedAnchorCount,
      unresolvedAnchorCount: rewritten.unresolvedAnchorCount,
    };
  }

  const timestamp = collapse(options.generatedAt);
  const lines: string[] = [copy.heading, ""];
  if (timestamp) lines.push(copy.subtitle(timestamp), "");
  lines.push(copy.disclaimer, "", body, "");

  if (references.length) {
    lines.push(copy.referencesHeading, "");
    for (const reference of references) {
      lines.push(
        `- ${formatReferenceEntry(reference.source, options.style, lang)}`,
      );
    }
    lines.push("");
  }

  if (unresolved.length) {
    lines.push(copy.unresolvedHeading, "", copy.unresolvedIntro, "");
    for (const entry of unresolved) {
      lines.push(`- \`${entry.raw}\` — ${copy.unresolvedCount(entry.count)}`);
    }
    lines.push("");
  }

  return {
    markdown: lines.join("\n"),
    body,
    references,
    unresolved,
    resolvedAnchorCount: rewritten.resolvedAnchorCount,
    unresolvedAnchorCount: rewritten.unresolvedAnchorCount,
  };
}
