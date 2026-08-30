/**
 * Suggested questions — the follow-ups an answer hands back to the reader.
 *
 * The hardest moment in a chat panel is the one right after the first answer
 * lands: the assistant is there, the paper is loaded, and the reader has no
 * idea what is worth asking. So an answer is allowed to propose its own
 * follow-ups. The model appends them to the very end of its message behind a
 * fixed marker line, and the panel turns them into clickable chips under the
 * bubble.
 *
 * Two decisions shape everything here:
 *
 * - **The questions ride along with the answer.** No second request, no second
 *   round trip, no extra cost. The price is that the marker travels inside the
 *   message text, which is why stripping it is unconditional (below).
 * - **The chips are derived at render time, never stored.** Chat messages are
 *   persisted through a fixed SQL schema, so anything per-message would need a
 *   store migration. Parsing the block out of the message text on every render
 *   means a reloaded conversation shows the same chips for free.
 *
 * `stripSuggestedQuestions` runs whether or not the feature is enabled: a
 * conversation recorded while it was on must never start showing raw
 * `===QUESTIONS===` text just because the user turned it off. Only the chips
 * are gated.
 *
 * Everything in this module is pure string handling apart from
 * `isSuggestedQuestionsEnabled`, which reads its preference defensively so the
 * module stays usable without a Zotero runtime.
 */

import { config } from "../../package.json";

/** Preference gating the model instruction and the rendered chips. */
export const SUGGESTED_QUESTIONS_PREF_KEY = "suggestedQuestions.enabled";

/**
 * Line that opens the question block.
 *
 * Chosen to be three things at once: absent from prose in any language a
 * briefing is written in, inert under Markdown (a setext heading needs a line
 * of nothing but `=`, so a line with letters in it stays a paragraph), and
 * cheap to recognise from a prefix while it is still streaming in.
 */
export const SUGGESTED_QUESTIONS_MARKER = "===QUESTIONS===";

/** Chips past the fifth stop being a menu and start being a wall. */
export const SUGGESTED_QUESTIONS_MAX = 5;

/**
 * Longest line still treated as a question.
 *
 * The instruction asks for ~25 words; this bound only exists to drop the case
 * where a model keeps writing prose after the marker instead of stopping, so
 * it sits far above a well-formed question rather than near it.
 */
export const SUGGESTED_QUESTION_MAX_CHARS = 200;

/** Shortest line still treated as a question. */
const SUGGESTED_QUESTION_MIN_CHARS = 2;

/**
 * The marker line as the model may actually write it.
 *
 * Tolerates the ways models decorate a literal they were told to emit: extra
 * `=`, spaces inside, a promotion to a heading, and bold. Anything else is not
 * the marker and is left in the body, where the reader can see what went wrong.
 */
const SUGGESTED_QUESTIONS_MARKER_PATTERN =
  /^[ \t]{0,3}(?:#{1,6}[ \t]*)?(?:\*\*|__)?[ \t]*={3,}[ \t]*QUESTIONS[ \t]*={3,}[ \t]*(?:\*\*|__)?[ \t]*$/i;

/** Fenced-code openers/closers, which some models wrap the block in. */
const CODE_FENCE_PATTERN = /^[ \t]{0,3}(?:`{3,}|~{3,})/;

/**
 * Bullet or numbering the instruction asked models to omit and they added
 * anyway.
 *
 * Latin bullets and `1.` / `1)` numbering must be followed by a space, so
 * `**bold**` keeps its emphasis for the unwrapper below and a question opening
 * with a figure such as "1.2M pairs?" keeps its number. CJK enumeration and
 * parenthesised numbers are unambiguous enough to match without one.
 */
const LIST_MARKER_PATTERN =
  /^(?:[-*+•·][ \t]+|\d{1,2}[.)][ \t]+|\d{1,2}[、．][ \t]*|[（(]\d{1,2}[)）][ \t]*)/;

/** Wrapping emphasis or quotes around a whole question. */
const WRAPPED_QUESTION_PATTERNS: readonly RegExp[] = [
  /^\*\*([\s\S]+)\*\*$/,
  /^__([\s\S]+)__$/,
  /^\*([\s\S]+)\*$/,
  /^"([\s\S]+)"$/,
  /^'([\s\S]+)'$/,
  /^“([\s\S]+)”$/,
  /^「([\s\S]+)」$/,
];

/** `Q:` / `Q1.` / `问:` prefixes a model may label its questions with. */
const QUESTION_LABEL_PATTERN = /^(?:q|问题?)[ \t]*\d{0,2}[ \t]*[:：.、)]\s*/i;

export type SuggestedQuestionsLang = "en-US" | "zh-CN";

/**
 * Instruction copy exists in English and Simplified Chinese only, matching how
 * the shortcut prompt files resolve. Other panel languages fall back to
 * English; the instruction itself pins the question language to the answer's,
 * so a briefing written in a third language still gets questions in it.
 */
export function resolveSuggestedQuestionsLang(
  lang: string | null | undefined,
): SuggestedQuestionsLang {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

export type SuggestedQuestionsSplit = {
  /** The answer with the question block removed. */
  body: string;
  /** Parsed questions, capped at `SUGGESTED_QUESTIONS_MAX`. */
  questions: string[];
};

function toSource(text: unknown): string {
  return typeof text === "string" ? text : "";
}

/** Reduce one raw line to the question it carries, or "" when it is not one. */
function normalizeQuestionLine(rawLine: string): string {
  let line = rawLine.trim();
  if (!line) return "";
  line = line.replace(LIST_MARKER_PATTERN, "").trim();
  line = line.replace(QUESTION_LABEL_PATTERN, "").trim();
  // Emphasis can nest ("**"Question?"**"), so unwrap until nothing peels off.
  for (let pass = 0; pass < 3; pass++) {
    let unwrapped = line;
    for (const pattern of WRAPPED_QUESTION_PATTERNS) {
      const match = unwrapped.match(pattern);
      if (match) unwrapped = match[1].trim();
    }
    if (unwrapped === line) break;
    line = unwrapped;
  }
  if (line.length < SUGGESTED_QUESTION_MIN_CHARS) return "";
  if (line.length > SUGGESTED_QUESTION_MAX_CHARS) return "";
  return line;
}

/**
 * Split an assistant message into its visible body and its follow-up questions.
 *
 * A message without the marker is returned untouched, which is the common case
 * and must stay free: every assistant render goes through here.
 *
 * The block is defined as "the marker line and everything after it", so a
 * malformed block — no questions, only blank lines, a stray code fence — still
 * disappears from the body and simply yields no chips. Half a block is never
 * shown to the reader.
 */
export function splitSuggestedQuestions(
  text: unknown,
): SuggestedQuestionsSplit {
  const source = toSource(text);
  if (!source || source.indexOf("=") < 0) {
    return { body: source, questions: [] };
  }

  const lines = source.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) =>
    SUGGESTED_QUESTIONS_MARKER_PATTERN.test(line),
  );
  if (markerIndex < 0) return { body: source, questions: [] };

  const body = lines.slice(0, markerIndex).join("\n").replace(/\s+$/, "");

  const questions: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of lines.slice(markerIndex + 1)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    // A closing marker and a wrapping fence are structure, not questions.
    if (SUGGESTED_QUESTIONS_MARKER_PATTERN.test(trimmed)) continue;
    if (CODE_FENCE_PATTERN.test(trimmed)) continue;
    const question = normalizeQuestionLine(trimmed);
    if (!question) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(question);
    if (questions.length >= SUGGESTED_QUESTIONS_MAX) break;
  }

  return { body, questions };
}

/** The follow-up questions an answer proposes; empty when it proposes none. */
export function parseSuggestedQuestions(text: unknown): string[] {
  return splitSuggestedQuestions(text).questions;
}

/** The answer as the reader should see it, with the block removed. */
export function stripSuggestedQuestions(text: unknown): string {
  return splitSuggestedQuestions(text).body;
}

/**
 * Whether a trailing fragment is the marker line arriving one token at a time.
 *
 * Only fragments that already start with `=` count, so ordinary prose is never
 * hidden; the worst case is a paragraph that genuinely begins with `=` blinking
 * out for the one frame before its next character disproves the prefix.
 */
function isPartialSuggestedQuestionsMarker(line: string): boolean {
  const candidate = line.trim().replace(/^[#*_ \t]+/, "");
  if (!candidate || candidate[0] !== "=") return false;
  return SUGGESTED_QUESTIONS_MARKER.startsWith(candidate.toUpperCase());
}

/**
 * Body to render mid-stream, hiding the block before it is even complete.
 *
 * The alternative — render the raw text while streaming and convert at the end
 * — makes the marker and every question flash into the bubble and then vanish,
 * reflowing the whole tail of the answer. Because the block is always last,
 * hiding the trailing partial marker line is enough to avoid that, and it costs
 * one string comparison per patch.
 */
export function stripStreamingSuggestedQuestions(text: unknown): string {
  const source = toSource(text);
  if (!source) return source;
  const split = splitSuggestedQuestions(source);
  if (split.body !== source) return split.body;

  const lastBreak = source.lastIndexOf("\n");
  const tail = lastBreak < 0 ? source : source.slice(lastBreak + 1);
  if (!isPartialSuggestedQuestionsMarker(tail)) return source;
  return lastBreak < 0 ? "" : source.slice(0, lastBreak).replace(/\s+$/, "");
}

type SuggestedQuestionsCopy = {
  instruction: readonly string[];
};

const SUGGESTED_QUESTIONS_COPY: Record<
  SuggestedQuestionsLang,
  SuggestedQuestionsCopy
> = {
  "en-US": {
    instruction: [
      "After the answer is finished, append a follow-up block as the very last thing you write:",
      `- Put the line ${SUGGESTED_QUESTIONS_MARKER} on its own, with nothing else on that line.`,
      "- Under it write 3 to 5 questions, one per line, with no numbering, bullets, or quotation marks.",
      "- Every question must be about this document in particular: a method choice, the data or setup, how far a conclusion actually reaches, or how it differs from the related work it cites. Do not ask anything that would fit any paper.",
      "- Ask what a reader would genuinely want answered next, not what the document already answers.",
      "- Keep each question under 25 words and write them in the same language as the answer above.",
      "- Write nothing after the last question.",
    ],
  },
  "zh-CN": {
    instruction: [
      "正文写完之后，在回答的最末尾追加一个追问区块：",
      `- 单独一行写 ${SUGGESTED_QUESTIONS_MARKER}，该行不要有任何其他内容。`,
      "- 其下每行写一个问题，共 3-5 个，不要编号、不要项目符号、不要引号。",
      "- 每个问题都必须针对这篇文档本身：方法选择、数据与实验设置、结论的适用边界、与它引用的相关工作有何不同等；不要写换一篇论文也成立的通用问题。",
      "- 问读者接下来真正想知道的东西，不要问文档里已经答过的。",
      "- 每个问题不超过 25 字，语言与上面的正文保持一致。",
      "- 最后一个问题之后不要再写任何内容。",
    ],
  },
};

/**
 * The block of prompt text that asks for follow-up questions.
 *
 * Returned as one string so callers can drop it into a template slot or append
 * it to their own rules without knowing how it is worded.
 */
export function buildSuggestedQuestionsInstruction(
  lang?: string | null,
): string {
  return SUGGESTED_QUESTIONS_COPY[
    resolveSuggestedQuestionsLang(lang)
  ].instruction.join("\n");
}

/**
 * Whether answers should propose follow-up questions.
 * Defaults to enabled, including when no Zotero runtime is available.
 */
export function isSuggestedQuestionsEnabled(): boolean {
  try {
    const prefs = (globalThis as { Zotero?: { Prefs?: { get?: unknown } } })
      .Zotero?.Prefs;
    if (typeof prefs?.get !== "function") return true;
    const value = (prefs.get as (key: string, global?: boolean) => unknown)(
      `${config.prefsPrefix}.${SUGGESTED_QUESTIONS_PREF_KEY}`,
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
