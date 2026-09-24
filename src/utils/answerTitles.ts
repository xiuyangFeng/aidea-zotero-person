/**
 * Answer titles — the first line that says what a generated answer is.
 *
 * Several built-in actions drive the ordinary chat path: the panel assembles a
 * prompt, drops it into the composer, and the answer comes back as a normal
 * assistant message. Nothing in the message store records which action produced
 * it, and adding a per-message flag would need a schema migration for something
 * the answer can simply state itself. So every such action asks the model for a
 * fixed title line and recognises that line again when the answer is saved as a
 * note.
 *
 * This module holds the two halves of that contract: the instruction that asks
 * for the title, and the recogniser that reads it back. Both are pure string
 * handling and unit-tested without a Zotero runtime. `utils/readingCard.ts`
 * predates it and keeps its own copy of the same idea.
 */

/** How many leading non-empty lines may precede the title before we give up. */
export const ANSWER_TITLE_SCAN_LINES = 5;

/** Fenced-code openers/closers, which some models wrap whole answers in. */
const CODE_FENCE_PATTERN = /^[ \t]{0,3}(?:`{3,}|~{3,})/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the heading pattern that recognises one answer kind.
 *
 * Accepts one to three hashes so a model that promotes the title to `#` or
 * demotes it to `###` is still recognised, tolerates a bold wrapper and an
 * `AIdea` prefix, and allows a trailing suffix such as
 * `# Critical Review: Attention Is All You Need`.
 */
export function buildAnswerTitlePattern(variants: readonly string[]): RegExp {
  const alternatives = variants
    .map((variant) => String(variant || "").trim())
    .filter(Boolean)
    .map(escapeRegExp);
  if (!alternatives.length) {
    // A pattern that can never match is safer than one that matches anything.
    return /(?!)/;
  }
  return new RegExp(
    `^[ \\t]{0,3}#{1,3}[ \\t]*(?:\\*\\*)?[ \\t]*(?:aidea[ \\t]*[-–—:：]?[ \\t]*)?(?:${alternatives.join(
      "|",
    )})`,
    "i",
  );
}

/**
 * Whether an assistant message opens with the given answer title.
 *
 * A wrapping code fence is not content, so it never consumes a scan slot.
 */
export function hasLeadingAnswerTitle(text: unknown, pattern: RegExp): boolean {
  const source = typeof text === "string" ? text : "";
  if (!source.trim()) return false;
  let scanned = 0;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (CODE_FENCE_PATTERN.test(line)) continue;
    if (pattern.test(line)) return true;
    scanned += 1;
    if (scanned >= ANSWER_TITLE_SCAN_LINES) break;
  }
  return false;
}

/**
 * The prompt block that asks for the title line.
 *
 * Returned without leading or trailing blank lines so callers can join it to
 * the rest of the prompt with a blank line of their own.
 */
export function buildAnswerTitleRule(
  title: string,
  lang: "en-US" | "zh-CN",
): string {
  const normalized = String(title || "").trim();
  if (!normalized) return "";
  if (lang === "zh-CN") {
    return [
      "## 输出格式要求：",
      `- 回答的第一行必须是标题行 \`# ${normalized}\`，它之前不要输出任何内容。`,
    ].join("\n");
  }
  return [
    "## Output Format Requirement:",
    `- The answer MUST start with the title line \`# ${normalized}\`, with nothing before it.`,
  ].join("\n");
}
