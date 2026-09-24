/**
 * Academic Writing & Polishing — dedicated prompts and word-level diff rendering.
 *
 * Provides structured prompts for specialized academic editing modes (academic tone,
 * conciseness, coherence, reviewer rebuttal) and an LCS-based word-level diff
 * engine for side-by-side or inline visual feedback.
 */

import {
  buildAnswerTitlePattern,
  buildAnswerTitleRule,
  hasLeadingAnswerTitle,
} from "./answerTitles";

export type PolishingMode =
  "academic-tone" | "conciseness" | "clarity-coherence" | "reviewer-response";

export type PolishingLang = "en-US" | "zh-CN";

export function resolvePolishingLang(
  lang: string | null | undefined,
): PolishingLang {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

export interface BuildPolishingPromptOptions {
  text: string;
  mode: PolishingMode;
  lang?: string;
  targetLang?: "en" | "zh";
  additionalInstructions?: string;
}

const MODE_DESCRIPTIONS: Record<
  PolishingLang,
  Record<PolishingMode, string>
> = {
  "en-US": {
    "academic-tone":
      "Enhance academic formality, precision, and objectivity; eliminate colloquialisms and hyperbolic claims.",
    conciseness:
      "Shorten and tighten the text by 15-30% without losing critical arguments, data, or nuances.",
    "clarity-coherence":
      "Improve logical flow, paragraph transitions, argumentation structure, and readability.",
    "reviewer-response":
      "Draft a respectful, rigorous, and point-by-point author rebuttal to reviewer feedback.",
  },
  "zh-CN": {
    "academic-tone": "提升学术规范度与严谨性，消除口语化表述与主观夸大修辞。",
    conciseness:
      "在保留核心论点与关键细节的前提下，精简压缩篇幅 15%~30%（适合超页限制）。",
    "clarity-coherence": "强化行文逻辑链条、句间过渡与段落连贯性。",
    "reviewer-response":
      "根据审稿人意见生成专业、礼貌、有理有据的逐条 Rebuttal 答复草稿。",
  },
};

/**
 * Builds prompt for the selected academic polishing mode.
 */
export function buildPolishingPrompt(
  options: BuildPolishingPromptOptions,
): string {
  const lang = resolvePolishingLang(options.lang);
  const modeDesc = MODE_DESCRIPTIONS[lang][options.mode];
  const custom = String(options.additionalInstructions || "").trim();
  const customBlock = custom ? `\n\nAdditional Instructions: ${custom}` : "";

  if (lang === "zh-CN") {
    return [
      `作为顶级国际学术期刊与会议的资深同行评审与英语润色专家，请对以下学术文本进行专业修改。`,
      "",
      `**修改目标与模式**：【${options.mode}】— ${modeDesc}${customBlock}`,
      "",
      "**待处理文本**：",
      "```text",
      options.text.trim(),
      "```",
      "",
      "**输出规范**：",
      "1. 必须首先直接输出修改后的完整学术文本（不带多余套话）。",
      "2. 在下方附上【主要修改要点说明 (Key Revisions)】，列出主要词汇替换、逻辑重组及理据。",
    ].join("\n");
  }

  return [
    `As a senior journal peer reviewer and academic writing editor, please refine the following academic text.`,
    "",
    `**Editing Goal & Mode**: 【${options.mode}】— ${modeDesc}${customBlock}`,
    "",
    "**Input Text**:",
    "```text",
    options.text.trim(),
    "```",
    "",
    "**Output Requirements**:",
    "1. First, provide the complete revised academic text directly without conversational filler.",
    "2. Follow with a 【Key Revisions & Rationale】 section explaining significant lexical, structural, and stylistic improvements.",
  ].join("\n");
}

export type DiffSpanType = "equal" | "insert" | "delete";

export interface DiffSpan {
  type: DiffSpanType;
  text: string;
}

/**
 * Tokenize string into words, whitespace, and punctuation for granular diffing.
 */
export function tokenizeForDiff(text: string): string[] {
  if (!text) return [];
  // Match words, sequences of CJK characters, whitespace, or punctuation
  const tokens: string[] = [];
  const regex = /([\p{L}\p{N}]+|[\s]+|[^\p{L}\p{N}\s])/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

/**
 * Computes word-level diff using Longest Common Subsequence (LCS).
 */
export function computeWordDiff(original: string, revised: string): DiffSpan[] {
  const origTokens = tokenizeForDiff(original);
  const revTokens = tokenizeForDiff(revised);

  const n = origTokens.length;
  const m = revTokens.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ type: "insert", text: revised }];
  if (m === 0) return [{ type: "delete", text: original }];

  // LCS DP Matrix
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (origTokens[i] === revTokens[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to build raw diff
  const rawSpans: DiffSpan[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origTokens[i - 1] === revTokens[j - 1]) {
      rawSpans.push({ type: "equal", text: origTokens[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawSpans.push({ type: "insert", text: revTokens[j - 1] });
      j--;
    } else if (i > 0) {
      rawSpans.push({ type: "delete", text: origTokens[i - 1] });
      i--;
    }
  }

  rawSpans.reverse();

  // Merge contiguous spans of the same type
  const merged: DiffSpan[] = [];
  for (const span of rawSpans) {
    if (merged.length > 0 && merged[merged.length - 1].type === span.type) {
      merged[merged.length - 1].text += span.text;
    } else {
      merged.push({ ...span });
    }
  }

  return merged;
}

/**
 * Renders diff spans into highlighted HTML string.
 */
export function renderDiffHtml(diffs: readonly DiffSpan[]): string {
  return diffs
    .map((span) => {
      const escaped = span.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      if (span.type === "insert") {
        return `<ins class="diff-ins" style="background-color: #d4edda; color: #155724; text-decoration: none;">${escaped}</ins>`;
      }
      if (span.type === "delete") {
        return `<del class="diff-del" style="background-color: #f8d7da; color: #721c24; text-decoration: line-through;">${escaped}</del>`;
      }
      return escaped;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Answer title and revised/notes split
// ---------------------------------------------------------------------------

/** Title line a polishing answer must open with. */
export const POLISHING_TITLE: Record<PolishingLang, string> = {
  "en-US": "Academic Polishing",
  "zh-CN": "学术润色",
};

const POLISHING_TITLE_PATTERN = buildAnswerTitlePattern([
  "Academic Polishing",
  "Academic Polish",
  "学术润色",
  "學術潤色",
]);

/**
 * Whether an assistant message answers a polishing request.
 *
 * The panel shows the "Show changes" toggle only on such answers, so this has
 * to be deterministic: `buildPolishingTitleRule` asks for the title line, and
 * this reads it back. Nothing else about a polished paragraph is recognisable.
 */
export function isPolishingAnswerText(text: unknown): boolean {
  return hasLeadingAnswerTitle(text, POLISHING_TITLE_PATTERN);
}

/** The prompt block asking the answer to open with its title line. */
export function buildPolishingTitleRule(lang?: string | null): string {
  const resolved = resolvePolishingLang(lang);
  return buildAnswerTitleRule(POLISHING_TITLE[resolved], resolved);
}

/**
 * Headings that open the rationale section the prompt asks for.
 *
 * Matched only on a line that already looks like a heading (a `#` run, a bold
 * line, a 【…】 label, or a numbered bold item), so a sentence that merely
 * mentions "key revisions" inside the revised text cannot end it early.
 */
const POLISHING_REVISIONS_HEADING_PATTERNS: readonly RegExp[] = [
  /key\s+revisions/i,
  /revisions?\s*(?:&|and)\s*rationale/i,
  /主要修改(?:要点|要點)/,
  /修改(?:要点|要點|说明|說明)/,
];

function isPolishingRevisionsHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const headingLike =
    /^#{1,6}\s*\S/.test(trimmed) ||
    /^\*\*[^*]+\*\*[\s:：]*$/.test(trimmed) ||
    /^[-*]\s*\*\*[^*]+\*\*/.test(trimmed) ||
    /^\d+[.、)]\s*\*\*/.test(trimmed) ||
    /^【[^】]+】/.test(trimmed);
  if (!headingLike) return false;
  return POLISHING_REVISIONS_HEADING_PATTERNS.some((pattern) =>
    pattern.test(trimmed),
  );
}

const FENCE_LINE_PATTERN = /^[ \t]{0,3}(?:`{3,}|~{3,})/;

/** Drop a code fence that wraps the whole block, keeping its content. */
function stripWrappingCodeFence(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  if (end - start < 2) return lines.slice(start, end);
  if (
    FENCE_LINE_PATTERN.test(lines[start]) &&
    FENCE_LINE_PATTERN.test(lines[end - 1])
  ) {
    return lines.slice(start + 1, end - 1);
  }
  return lines.slice(start, end);
}

export type PolishingAnswerSplit = {
  /** The rewritten text, without the title line or a wrapping code fence. */
  revised: string;
  /** The rationale section, from its heading on. Empty when absent. */
  notes: string;
};

/**
 * Split a polishing answer into the revised text and the rationale.
 *
 * The prompt asks for the revised text first and a "Key Revisions" section
 * after it, so the split is that heading. The revised half is what the word
 * diff is computed against, which is why the title line and any wrapping code
 * fence are removed: neither is part of the rewrite.
 */
export function splitPolishingAnswer(markdown: unknown): PolishingAnswerSplit {
  const source = typeof markdown === "string" ? markdown : "";
  if (!source.trim()) return { revised: "", notes: "" };

  // A model that fenced the whole answer hides both the title and the
  // heading, so the outer fence comes off before anything else is read.
  let lines = stripWrappingCodeFence(source.split(/\r?\n/));

  let start = 0;
  while (start < lines.length && !lines[start].trim()) start += 1;
  if (start < lines.length && POLISHING_TITLE_PATTERN.test(lines[start])) {
    start += 1;
  }
  lines = lines.slice(start);

  let splitAt = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (isPolishingRevisionsHeading(lines[index])) {
      splitAt = index;
      break;
    }
  }

  const revisedLines = splitAt === -1 ? lines : lines.slice(0, splitAt);
  const notesLines = splitAt === -1 ? [] : lines.slice(splitAt);
  return {
    revised: stripWrappingCodeFence(revisedLines).join("\n").trim(),
    notes: notesLines.join("\n").trim(),
  };
}
