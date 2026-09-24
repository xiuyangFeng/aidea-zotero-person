/**
 * Critical Review — peer-reviewer perspective and flaw detection.
 *
 * Adopts a rigorous, constructive "Reviewer 2" mindset to scrutinize papers
 * for hidden assumptions, potential experimental data leakage, baseline fairness,
 * boundary failure modes, and unaddressed edge cases.
 */

import {
  buildAnswerTitlePattern,
  buildAnswerTitleRule,
  hasLeadingAnswerTitle,
} from "./answerTitles";

export const CRITICAL_REVIEW_NOTE_TAG = "aidea-critical-review";

export type CriticalReviewLang = "en-US" | "zh-CN";

export function resolveCriticalReviewLang(
  lang: string | null | undefined,
): CriticalReviewLang {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

export interface BuildCriticalReviewPromptOptions {
  paperTitle: string;
  paperContent: string;
  focusSection?: string;
  lang?: string;
}

/**
 * Builds a prompt for critical peer-review inspection.
 */
export function buildCriticalReviewPrompt(
  options: BuildCriticalReviewPromptOptions,
): string {
  const lang = resolveCriticalReviewLang(options.lang);
  const focus = options.focusSection
    ? `\n**Focus Section**: ${options.focusSection.trim()}`
    : "";

  if (lang === "zh-CN") {
    return [
      `作为顶级国际学术期刊/会议的资深领域主席（Area Chair）与极具批判精神的审稿人（Reviewer 2），请对论文《${options.paperTitle}》进行严谨、深刻且客观的【学术审辩与盲点探测】。${focus}`,
      "",
      "**待评审论文内容/片段**：",
      "```text",
      options.paperContent.trim().slice(0, 8000),
      "```",
      "",
      "## 批判性评审维度要求：",
      "1. **【核心论据与实验设计隐患 (Methodological & Empirical Vulnerabilities)】**：",
      "   - 是否存在潜在的训练/测试集数据泄露（Data Contamination）风险？",
      "   - 评估指标是否全面？是否存在选择性报告结果（Cherry-picking）的嫌疑？",
      "2. **【Baseline 选取的充分性与公平性 (Baseline Fairness)】**：",
      "   - 对比的 Baseline 是否为最新且调优充分的 SOTA，还是过时的弱模型？",
      "   - 计算预算（Compute Budget）、参数量与训练轮数是否对等？",
      "3. **【隐藏假设与理论边界 (Hidden Assumptions & Failure Modes)】**：",
      "   - 该方法的理论成立依赖哪些严苛假设？在什么极端场景或数据分布下可能彻底失效？",
      "4. **【审稿人质疑问题清单 (Major Reviewer Inquiries)】**：",
      "   - 列出 3~4 个直击要害、最需要作者正面澄清的核心质疑问题；",
      "   - 建议作者必须补充哪些验证实验以增强说服力。",
    ].join("\n");
  }

  return [
    `As a senior Area Chair and rigorous peer reviewer for top-tier academic venues, please conduct an incisive, constructive 【Critical Peer Review & Flaw Detection】 for the paper "${options.paperTitle}".${focus}`,
    "",
    "**Paper Text / Excerpt**:",
    "```text",
    options.paperContent.trim().slice(0, 8000),
    "```",
    "",
    "## Critical Review Requirements:",
    "1. **【Methodological & Empirical Vulnerabilities】**:",
    "   - Are there risks of train/test data contamination or lookahead bias?",
    "   - Are evaluation metrics comprehensive, or is there suspicion of selective reporting / cherry-picking?",
    "2. **【Baseline Adequacy & Fairness】**:",
    "   - Are baselines modern, competitive, and properly tuned, or outdated strawmen?",
    "   - Are compute budgets, parameter scales, and training schedules fairly matched?",
    "3. **【Hidden Assumptions & Failure Modes】**:",
    "   - What unstated assumptions does the theory rely on? Under what real-world distributions might it fail catastrophically?",
    "4. **【Actionable Reviewer Questions & Missing Experiments】**:",
    "   - Formulate 3-4 sharp, piercing questions the authors must address in rebuttal;",
    "   - Detail the essential control/stress experiments the authors should add.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Answer title — what makes a review recognisable once it is written back
// ---------------------------------------------------------------------------

/**
 * Title line a whole-document review must open with.
 *
 * Deliberately not the same string as the prompt's section headings: it is the
 * one marker `isCriticalReviewText` looks for when "Save as note" decides
 * whether to tag the note `aidea-critical-review`.
 */
export const CRITICAL_REVIEW_TITLE: Record<CriticalReviewLang, string> = {
  "en-US": "Critical Review",
  "zh-CN": "批判性评审",
};

const CRITICAL_REVIEW_TITLE_PATTERN = buildAnswerTitlePattern([
  "Critical Review",
  "Critical Peer Review",
  "批判性评审",
  "批判性評審",
]);

/** Whether an assistant message is a whole-document critical review. */
export function isCriticalReviewText(text: unknown): boolean {
  return hasLeadingAnswerTitle(text, CRITICAL_REVIEW_TITLE_PATTERN);
}

/** The prompt block asking the review to open with its title line. */
export function buildCriticalReviewTitleRule(lang?: string | null): string {
  const resolved = resolveCriticalReviewLang(lang);
  return buildAnswerTitleRule(CRITICAL_REVIEW_TITLE[resolved], resolved);
}

/**
 * Stand-in for `paperContent` when the document travels as context instead.
 *
 * A whole-document review is sent through the ordinary chat path, so the paper
 * is already attached as document context and pasting it into the prompt as
 * well would double the request for no gain. The placeholder keeps the
 * prompt's "paper text" block meaningful by saying where the text actually is.
 */
export function buildCriticalReviewAttachedDocumentNotice(
  lang?: string | null,
): string {
  return resolveCriticalReviewLang(lang) === "zh-CN"
    ? "【论文全文已作为文档上下文随本次请求附上。请直接基于附带的完整文档进行评审，不要把这段占位说明当作论文内容。】"
    : "[The full paper text is attached to this request as document context. Review the attached document itself; this block is only a placeholder, not the paper.]";
}
