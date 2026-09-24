/**
 * Highlight Digest — synthesis of user-made annotations, highlights, and margin notes.
 *
 * Scans all user annotations (highlights, underlines, notes) across a document,
 * organizes them chronologically and semantically (e.g. key claims, methods, doubts),
 * and synthesizes a coherent, personalized reading summary note.
 */

import {
  buildAnswerTitlePattern,
  buildAnswerTitleRule,
  hasLeadingAnswerTitle,
} from "./answerTitles";

export const HIGHLIGHT_DIGEST_NOTE_TAG = "aidea-highlight-digest";

export type HighlightDigestLang = "en-US" | "zh-CN";

export function resolveHighlightDigestLang(
  lang: string | null | undefined,
): HighlightDigestLang {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

export interface HighlightAnnotation {
  text: string;
  comment?: string;
  color?: string;
  page?: number;
  type?: "highlight" | "underline" | "note";
}

export interface BuildHighlightDigestPromptOptions {
  paperTitle: string;
  annotations: readonly HighlightAnnotation[];
  lang?: string;
}

/**
 * Normalizes and sorts annotations by page number.
 */
export function sortAndGroupAnnotations(
  annotations: readonly HighlightAnnotation[],
): HighlightAnnotation[] {
  return [...annotations]
    .filter((a) => a && (a.text?.trim() || a.comment?.trim()))
    .sort((a, b) => (a.page || 0) - (b.page || 0));
}

/**
 * Formats annotations into a readable text block for LLM prompt context.
 */
export function formatAnnotationsForPrompt(
  annotations: readonly HighlightAnnotation[],
): string {
  const sorted = sortAndGroupAnnotations(annotations);
  return sorted
    .map((a, idx) => {
      const pageStr = a.page ? `[p.${a.page}] ` : "";
      const textPart = a.text ? `"${a.text.trim()}"` : "";
      const commentPart = a.comment
        ? `\n   → User Note: ${a.comment.trim()}`
        : "";
      const colorPart = a.color ? ` (Tag: ${a.color})` : "";
      return `${idx + 1}. ${pageStr}${textPart}${colorPart}${commentPart}`;
    })
    .join("\n\n");
}

/**
 * Builds a prompt for synthesizing user highlights into a structured reading digest.
 */
export function buildHighlightDigestPrompt(
  options: BuildHighlightDigestPromptOptions,
): string {
  const lang = resolveHighlightDigestLang(options.lang);
  const formattedHighlights = formatAnnotationsForPrompt(options.annotations);

  if (lang === "zh-CN") {
    return [
      `作为学术伴读专家，请根据读者在论文《${options.paperTitle}》中标记的全部划线高亮与边注，生成一份条理清晰、逻辑连贯的【读者专属精读笔记合辑】。`,
      "",
      `## 读者的高亮与批注列表（共 ${options.annotations.length} 条）：`,
      formattedHighlights,
      "",
      "## 笔记合辑组织要求：",
      "1. **【读者关注脉络综述 (Reading Focus Overview)】**：简要概括读者在阅读此文时的核心关注点（如关注新算法设计、特定实验指标还是对比 baseline）。",
      "2. **【结构化精读心得 (Structured Synthesis)】**：",
      "   - 不要简单罗列高亮，而是将零散的批注按论文逻辑（动机 → 核心创新 → 实验验证 → 疑问与思考）重新组织为流畅的段落；",
      "   - 引用具体高亮时，保留对应的 `[p.N]` 页码标记；",
      "   - 如果读者留有便签疑问（User Note），针对读者的疑问给出清晰解答与探讨。",
      "3. **【遗留思考与后续行动 (Open Questions & Next Steps)】**：提炼出读者需进一步跟进的文献或验证方向。",
    ].join("\n");
  }

  return [
    `As an academic reading research assistant, please synthesize all the user's highlights and notes from the paper "${options.paperTitle}" into a coherent, structured 【Personalized Reading Digest】 note.`,
    "",
    `## User Annotations & Highlights (${options.annotations.length} items):`,
    formattedHighlights,
    "",
    "## Digest Synthesis Requirements:",
    "1. **【Reading Focus Overview】**: A 2-sentence summary of what aspects of the paper the reader paid the most attention to.",
    "2. **【Structured Synthesis of Highlights】**:",
    "   - Do not merely list highlights; synthesize disjointed notes into a coherent narrative following the paper's logical flow (Motivation → Key Innovation → Empirical Evidence → Inquiries);",
    "   - Retain exact `[p.N]` page references from original annotations;",
    "   - Directly address and elaborate on any custom comments/questions left by the user.",
    "3. **【Open Questions & Action Items】**: Outline lingering questions or recommended follow-up experiments/papers.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Answer title — what makes a digest recognisable once it is written back
// ---------------------------------------------------------------------------

/** Title line a highlight digest must open with. */
export const HIGHLIGHT_DIGEST_TITLE: Record<HighlightDigestLang, string> = {
  "en-US": "Highlight Digest",
  "zh-CN": "标注精读合辑",
};

const HIGHLIGHT_DIGEST_TITLE_PATTERN = buildAnswerTitlePattern([
  "Highlight Digest",
  "Reading Digest",
  "标注精读合辑",
  "標註精讀合輯",
]);

/** Whether an assistant message is a highlight digest. */
export function isHighlightDigestText(text: unknown): boolean {
  return hasLeadingAnswerTitle(text, HIGHLIGHT_DIGEST_TITLE_PATTERN);
}

/** The prompt block asking the digest to open with its title line. */
export function buildHighlightDigestTitleRule(lang?: string | null): string {
  const resolved = resolveHighlightDigestLang(lang);
  return buildAnswerTitleRule(HIGHLIGHT_DIGEST_TITLE[resolved], resolved);
}

// ---------------------------------------------------------------------------
// Mapping Zotero annotation records onto digest input
// ---------------------------------------------------------------------------

/**
 * One annotation as the panel reads it off Zotero.
 *
 * Structurally the `AnnotationRecord` of `utils/annotationContext.ts`, restated
 * loosely so this module stays free of that dependency and can be tested with
 * plain objects.
 */
export type HighlightDigestSourceRecord = {
  type?: string | null;
  text?: string | null;
  comment?: string | null;
  /** Reader-facing page label; often a printed page number, sometimes roman. */
  pageLabel?: string | null;
  /** Zero-based physical page, absent outside PDFs. */
  pageIndex?: number | null;
  color?: string | null;
};

const DIGEST_ANNOTATION_TYPES = new Set(["highlight", "underline", "note"]);

/**
 * Page number for one annotation.
 *
 * The reader's own page label wins when it is a plain number, because that is
 * what the reader shows and what a `[p.N]` citation should point at. A label
 * that is not a number (roman front matter, "cover") has no useful numeric
 * form, so the physical page index is used instead.
 */
function resolveAnnotationPage(
  record: HighlightDigestSourceRecord,
): number | undefined {
  const label = String(record.pageLabel ?? "").trim();
  if (/^\d+$/.test(label)) {
    const parsed = Number.parseInt(label, 10);
    if (parsed > 0) return parsed;
  }
  // `Number(null)` is 0, so a missing index has to be rejected before the
  // numeric check or every unpaged annotation would claim page 1.
  const rawIndex = record.pageIndex;
  if (rawIndex === null || rawIndex === undefined) return undefined;
  const index = Number(rawIndex);
  if (Number.isFinite(index) && index >= 0) return Math.floor(index) + 1;
  return undefined;
}

/**
 * Map the panel's annotation records onto digest input.
 *
 * Records with neither a marked passage nor a comment carry nothing to
 * synthesise and are dropped, which is also what tells the caller the digest
 * has no material and the plain summary template should run instead.
 */
export function toHighlightAnnotations(
  records: readonly HighlightDigestSourceRecord[] | null | undefined,
): HighlightAnnotation[] {
  const out: HighlightAnnotation[] = [];
  for (const record of records || []) {
    if (!record) continue;
    const text = String(record.text ?? "").trim();
    const comment = String(record.comment ?? "").trim();
    if (!text && !comment) continue;
    const annotation: HighlightAnnotation = { text };
    if (comment) annotation.comment = comment;
    const color = String(record.color ?? "").trim();
    if (color) annotation.color = color;
    const page = resolveAnnotationPage(record);
    if (page !== undefined) annotation.page = page;
    const type = String(record.type ?? "").trim();
    if (DIGEST_ANNOTATION_TYPES.has(type)) {
      annotation.type = type as HighlightAnnotation["type"];
    }
    out.push(annotation);
  }
  return out;
}
