/**
 * Reading cards — a fixed-field structured close-reading summary.
 *
 * The card is produced by the normal chat path: the panel assembles a prompt
 * here, drops it into the composer, and the answer comes back as an ordinary
 * assistant message. What makes it a *card* is the shape of that answer — a
 * stable title line followed by a fixed list of level-two headings — so the
 * result stays comparable across papers and searchable once it is written
 * back as a Zotero note.
 *
 * Everything in this module is pure string handling. Reading preferences,
 * resolving the document, and writing the note all live in the panel modules;
 * keeping the prompt assembly and the card recogniser here lets both stay
 * testable without a Zotero runtime.
 */

import { hasPageMarkers } from "./pageAnchors";

/**
 * Language-neutral tag attached to every note saved from a reading card.
 *
 * Deliberately not localized: a library can hold papers read in either UI
 * language, and one tag keeps a single Zotero saved search covering all of
 * them.
 */
export const READING_CARD_NOTE_TAG = "aidea-reading-card";

/** Preference holding the user's template override (empty = built-in). */
export const READING_CARD_TEMPLATE_PREF_KEY = "readingCard.template";
/** Preference holding the user's research focus (empty = not stated). */
export const READING_CARD_FOCUS_PREF_KEY = "readingCard.researchFocus";

/** Token the built-in template uses to mark where the field list belongs. */
export const READING_CARD_FIELDS_PLACEHOLDER = "{{FIELDS}}";

/** Upper bound on a custom field list, so one card cannot become a survey. */
export const READING_CARD_MAX_FIELDS = 12;
/** Research focus is a hint, not a document; keep it short. */
export const READING_CARD_FOCUS_MAX_CHARS = 300;

export type ReadingCardLang = "en-US" | "zh-CN";

/**
 * Card copy exists in English and Simplified Chinese only. Other panel
 * languages fall back to English, matching how the shortcut prompt files
 * resolve.
 */
export function resolveReadingCardLang(
  lang: string | null | undefined,
): ReadingCardLang {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

/** Title line the card must open with; also the recogniser's anchor. */
export const READING_CARD_TITLE: Record<ReadingCardLang, string> = {
  "en-US": "Reading Card",
  "zh-CN": "精读卡片",
};

export const DEFAULT_READING_CARD_FIELDS: Record<
  ReadingCardLang,
  readonly string[]
> = {
  "en-US": [
    "Research Question",
    "Method",
    "Data and Setup",
    "Key Findings",
    "Limitations",
    "Relevance to My Research",
  ],
  "zh-CN": [
    "研究问题",
    "方法",
    "数据/实验设置",
    "核心结论",
    "局限",
    "与我的研究的关联",
  ],
};

/**
 * Heading line that opens a card.
 *
 * Accepts one to three hashes so a model that promotes the card to `#` or
 * demotes it to `###` is still recognised, tolerates an `AIdea` prefix, and
 * allows a trailing suffix such as `# Reading Card: Attention Is All You Need`.
 */
const READING_CARD_TITLE_PATTERN =
  /^[ \t]{0,3}#{1,3}[ \t]*(?:\*\*)?[ \t]*(?:aidea[ \t]*[-–—:：]?[ \t]*)?(?:reading[ \t]+card|精读卡片|精讀卡片)/i;

/** Fenced-code openers/closers, which some models wrap whole answers in. */
const CODE_FENCE_PATTERN = /^[ \t]{0,3}(?:`{3,}|~{3,})/;

/** How many leading non-empty lines may precede the title before we give up. */
const READING_CARD_TITLE_SCAN_LINES = 5;

/**
 * Whether an assistant message is a reading card.
 *
 * Recognition is content-based on purpose: chat messages are persisted through
 * a fixed SQL schema, so a per-message flag would need a store migration for
 * something the card's own title line already states. `buildReadingCardPrompt`
 * always asks for that title line, including for fully custom templates, so
 * the marker does not depend on what the user put in the template.
 */
export function isReadingCardText(text: unknown): boolean {
  const source = typeof text === "string" ? text : "";
  if (!source.trim()) return false;
  let scanned = 0;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // A wrapping code fence is not content; it must not consume a scan slot.
    if (CODE_FENCE_PATTERN.test(line)) continue;
    if (READING_CARD_TITLE_PATTERN.test(line)) return true;
    scanned += 1;
    if (scanned >= READING_CARD_TITLE_SCAN_LINES) break;
  }
  return false;
}

/**
 * Split a one-line field list into field names.
 *
 * Both Latin and CJK separators are accepted because the setting is typed in
 * whichever language the user thinks in. Leading `#` marks are stripped so a
 * list pasted out of a card still works.
 */
export function parseReadingCardFieldList(raw: unknown): string[] {
  const source = typeof raw === "string" ? raw : "";
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const part of source.split(/[,，、;；|]/)) {
    const field = part.replace(/^[\s#>*-]+/, "").trim();
    if (!field) continue;
    const key = field.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push(field);
    if (fields.length >= READING_CARD_MAX_FIELDS) break;
  }
  return fields;
}

export type ReadingCardTemplateMode = "builtin" | "fields" | "custom";

export type ReadingCardTemplate = {
  mode: ReadingCardTemplateMode;
  /** Prompt body before the field list is substituted. */
  template: string;
  /** Field names, already resolved to either defaults or the user's list. */
  fields: string[];
};

export type ResolveReadingCardTemplateOptions = {
  /** Text of the bundled `reading-card.txt` for the active language. */
  builtinTemplate: string;
  /** Raw value of the template preference; empty means "use the built-in". */
  customTemplate?: string;
  lang?: string;
};

/**
 * Decide what the user's template preference means.
 *
 * The rule is deliberately structural rather than heuristic, so the settings
 * hint can state it in one sentence:
 *   - empty            → built-in template, built-in fields;
 *   - exactly one line → built-in template, that line parsed as the fields;
 *   - several lines    → the text replaces the template body wholesale.
 */
export function resolveReadingCardTemplate(
  options: ResolveReadingCardTemplateOptions,
): ReadingCardTemplate {
  const lang = resolveReadingCardLang(options.lang);
  const defaults = [...DEFAULT_READING_CARD_FIELDS[lang]];
  const builtinTemplate = String(options.builtinTemplate || "").trim();
  const custom = String(options.customTemplate || "").trim();
  if (!custom) {
    return { mode: "builtin", template: builtinTemplate, fields: defaults };
  }
  if (/\r?\n/.test(custom)) {
    return { mode: "custom", template: custom, fields: defaults };
  }
  const fields = parseReadingCardFieldList(custom);
  // An unparsable one-liner (punctuation only) must not empty the card.
  if (!fields.length) {
    return { mode: "builtin", template: builtinTemplate, fields: defaults };
  }
  return { mode: "fields", template: builtinTemplate, fields };
}

export function formatReadingCardFieldsBlock(
  fields: readonly string[],
): string {
  return fields
    .map((field) => `## ${String(field || "").trim()}`)
    .filter((line) => line.length > 3)
    .join("\n");
}

export type ResolveReadingCardPageCitationsOptions = {
  /** Document adapter kind, for example `pdf` or `epub`. */
  documentKind?: string | null;
  /** Mirror of `isPageAnchorsEnabled()`; the card follows the same switch. */
  pageAnchorsEnabled?: boolean;
  /** Already-extracted context text, when the panel has it cached. */
  contextSample?: string;
};

/**
 * Whether the card may ask for `[p.N]` citations.
 *
 * Only the PDF adapter injects `[page N]` markers, so an EPUB has no page to
 * cite and the requirement is relaxed rather than answered with invented
 * numbers. When extracted text is already at hand, `hasPageMarkers` decides,
 * which also covers a PDF whose extraction produced no page breaks.
 */
export function resolveReadingCardPageCitations(
  options: ResolveReadingCardPageCitationsOptions = {},
): boolean {
  if (options.pageAnchorsEnabled === false) return false;
  const kind = String(options.documentKind || "").trim();
  if (kind && kind !== "pdf") return false;
  const sample = String(options.contextSample || "");
  // Absent evidence, keep the citation rule: a PDF should not silently lose
  // its provenance just because its text has not been extracted yet.
  if (!sample.trim()) return true;
  return hasPageMarkers(sample);
}

/** Collapse a free-text focus into a single short line. */
export function normalizeReadingCardFocus(raw: unknown): string {
  const source = typeof raw === "string" ? raw : "";
  const collapsed = source.replace(/\s+/g, " ").trim();
  return collapsed.length > READING_CARD_FOCUS_MAX_CHARS
    ? collapsed.slice(0, READING_CARD_FOCUS_MAX_CHARS).trim()
    : collapsed;
}

type ReadingCardCopy = {
  titleRule: (title: string) => string;
  focusRule: (focus: string) => string;
  noFocusRule: string;
  pageRule: string;
  noPageRule: string;
};

const READING_CARD_COPY: Record<ReadingCardLang, ReadingCardCopy> = {
  "en-US": {
    titleRule: (title) =>
      `Open the answer with the single line "# ${title}" and put nothing above it.`,
    focusRule: (focus) =>
      `My research focus: ${focus}\nUse the last heading to tie the document to that focus: what it supports, what it complicates, and what I could reuse.`,
    noFocusRule:
      "I have not stated a research focus, so use the last heading for the follow-up questions this document makes worth pursuing.",
    pageRule:
      "Cite the page of every key claim, number, and quotation inline as [p.N], right where the claim is made. Leave the citation out rather than guessing a page.",
    noPageRule:
      "This document carries no page numbers, so do not write [p.N] citations. Quote a short locating phrase from the text instead.",
  },
  "zh-CN": {
    titleRule: (title) =>
      `回答的第一行必须是“# ${title}”，其上不要有任何内容。`,
    focusRule: (focus) =>
      `我的研究方向：${focus}\n在最后一个字段中把这篇文献与该方向联系起来：它支持了什么、动摇了什么、哪些可以被我复用。`,
    noFocusRule:
      "我没有提供研究方向，因此最后一个字段改写“值得关注的延伸问题”：从这篇文献出发值得继续追问的问题。",
    pageRule:
      "每个关键论断、数字和引文都要在原地用 [p.N] 标注页码；无法确定页码时宁可省略，不要猜。",
    noPageRule:
      "这份文档没有页码，因此不要使用 [p.N] 页码引用，改为引用原文中一小段可定位的措辞。",
  },
};

export type BuildReadingCardPromptOptions =
  ResolveReadingCardTemplateOptions & {
    /** Raw research-focus preference; empty switches the last field over. */
    researchFocus?: string;
    /** Result of `resolveReadingCardPageCitations`; defaults to true. */
    pageCitations?: boolean;
  };

/**
 * Assemble the prompt sent for a reading card.
 *
 * The template supplies the field skeleton and the house rules; the three
 * lines appended here are the ones that must hold whatever the user did to
 * the template — the title line the recogniser looks for, what the last field
 * should contain, and whether pages may be cited.
 */
export function buildReadingCardPrompt(
  options: BuildReadingCardPromptOptions,
): string {
  const lang = resolveReadingCardLang(options.lang);
  const copy = READING_CARD_COPY[lang];
  const resolved = resolveReadingCardTemplate(options);
  const fieldsBlock = formatReadingCardFieldsBlock(resolved.fields);

  let body = resolved.template;
  if (body.includes(READING_CARD_FIELDS_PLACEHOLDER)) {
    body = body.split(READING_CARD_FIELDS_PLACEHOLDER).join(fieldsBlock);
  } else if (resolved.mode !== "custom") {
    // The bundled file always carries the placeholder; appending only covers
    // a truncated or hand-edited copy of it.
    body = body ? `${body}\n\n${fieldsBlock}` : fieldsBlock;
  }

  const focus = normalizeReadingCardFocus(options.researchFocus);
  const rules = [
    copy.titleRule(READING_CARD_TITLE[lang]),
    focus ? copy.focusRule(focus) : copy.noFocusRule,
    options.pageCitations === false ? copy.noPageRule : copy.pageRule,
  ];

  return [body.trim(), rules.join("\n")].filter(Boolean).join("\n\n").trim();
}
