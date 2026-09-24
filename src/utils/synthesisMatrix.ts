/**
 * Synthesis matrix — cross-paper comparative analysis and literature review tables.
 *
 * Comparing multiple papers is a core task in academic research. This module
 * provides structured prompt construction for multi-paper comparison, parses
 * returned matrix tables, and formats the result into a clean, searchable Zotero note.
 *
 * Everything here is pure string handling and testable without a Zotero runtime.
 */

import {
  buildAnswerTitlePattern,
  buildAnswerTitleRule,
  hasLeadingAnswerTitle,
} from "./answerTitles";

export const SYNTHESIS_MATRIX_NOTE_TAG = "aidea-synthesis-matrix";

export type SynthesisMatrixLang = "en-US" | "zh-CN";

export function resolveSynthesisMatrixLang(
  lang: string | null | undefined,
): SynthesisMatrixLang {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

export type SynthesisPaperInput = {
  id?: string | number;
  title: string;
  authors?: string;
  year?: string | number;
  abstract?: string;
  keyTextSample?: string;
};

export const DEFAULT_SYNTHESIS_DIMENSIONS: Record<
  SynthesisMatrixLang,
  readonly string[]
> = {
  "en-US": [
    "Research Question / Motivation",
    "Methodology & Architecture",
    "Datasets & Setup",
    "Key Metrics & Benchmarks",
    "Conclusions & Limitations",
  ],
  "zh-CN": [
    "核心研究问题 / 动机",
    "核心方法 / 技术架构",
    "数据集与实验设置",
    "核心指标表现与对比",
    "主要结论与局限性",
  ],
};

export const SYNTHESIS_MATRIX_TITLE: Record<SynthesisMatrixLang, string> = {
  "en-US": "Literature Synthesis Matrix",
  "zh-CN": "文献横向对比矩阵",
};

export interface BuildSynthesisMatrixPromptOptions {
  papers: readonly SynthesisPaperInput[];
  lang?: string;
  customDimensions?: readonly string[];
  focusTopic?: string;
}

/**
 * Builds a prompt for comparative synthesis across 2 or more papers.
 */
export function buildSynthesisMatrixPrompt(
  options: BuildSynthesisMatrixPromptOptions,
): string {
  const lang = resolveSynthesisMatrixLang(options.lang);
  const title = SYNTHESIS_MATRIX_TITLE[lang];
  const dimensions =
    options.customDimensions && options.customDimensions.length > 0
      ? options.customDimensions
      : DEFAULT_SYNTHESIS_DIMENSIONS[lang];

  const focus = String(options.focusTopic || "").trim();

  const paperBlocks = options.papers.map((p, idx) => {
    const authorStr = p.authors ? ` (${p.authors}, ${p.year || "n.d."})` : "";
    const abstractStr = p.abstract ? `\nAbstract: ${p.abstract.trim()}` : "";
    const sampleStr = p.keyTextSample
      ? `\nKey Excerpt:\n${p.keyTextSample.trim().slice(0, 1500)}`
      : "";
    return `### Paper ${idx + 1}: ${p.title}${authorStr}${abstractStr}${sampleStr}`;
  });

  if (lang === "zh-CN") {
    const focusLine = focus ? `\n\n**研究焦点 / 关注主题**：${focus}` : "";
    return [
      `请基于以下 ${options.papers.length} 篇文献的内容，进行系统性的横向对比分析，并生成一篇结构化的【${title}】。${focusLine}`,
      "",
      "## 待对比文献：",
      paperBlocks.join("\n\n"),
      "",
      "## 输出要求：",
      "1. 必须首先以 Markdown 表格输出对比矩阵，每一行对应一个维度，每一列对应一篇文献：",
      `   - 必须包含的对比维度：${dimensions.join("、")}`,
      "2. 表格各单元格应保持紧凑、精准，突出核心异同点与技术差异。",
      "3. 在表格下方，提供一段【综合分析与研究洞察 (Synthesis & Insights)】：",
      "   - 各方法之间的演进脉络或互补性",
      "   - 当前领域的共同瓶颈与未来潜在突破方向",
    ].join("\n");
  }

  const focusLine = focus ? `\n\n**Research Focus / Topic**:\n${focus}` : "";
  return [
    `Please perform a rigorous cross-paper comparative analysis on the following ${options.papers.length} papers and generate a structured 【${title}】.${focusLine}`,
    "",
    "## Papers to Compare:",
    paperBlocks.join("\n\n"),
    "",
    "## Output Requirements:",
    "1. First, provide a Markdown comparison table where each row represents a comparison dimension and each column represents a paper:",
    `   - Mandatory Dimensions: ${dimensions.join(", ")}`,
    "2. Keep table cells concise, precise, and highlighting key distinctions.",
    "3. Below the table, provide a 【Synthesis & Key Insights】 section covering:",
    "   - Methodological evolution and trade-offs among the papers",
    "   - Common limitations and promising future research directions",
  ].join("\n");
}

export interface ParsedSynthesisMatrix {
  headers: string[];
  rows: string[][];
  insightsMarkdown: string;
}

/**
 * Parses markdown table and accompanying synthesis prose from an LLM response.
 */
export function parseSynthesisMatrix(content: string): ParsedSynthesisMatrix {
  const text = String(content || "").trim();
  if (!text) {
    return { headers: [], rows: [], insightsMarkdown: "" };
  }

  const lines = text.split(/\r?\n/);
  const tableLines: string[] = [];
  const afterTableLines: string[] = [];
  let foundTable = false;
  let finishedTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!finishedTable) {
        foundTable = true;
        tableLines.push(trimmed);
        continue;
      }
    } else if (foundTable) {
      finishedTable = true;
    }

    if (finishedTable) {
      afterTableLines.push(line);
    }
  }

  if (tableLines.length < 2) {
    return { headers: [], rows: [], insightsMarkdown: text };
  }

  const splitRow = (rowLine: string) =>
    rowLine
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());

  const headers = splitRow(tableLines[0]);
  const rows: string[][] = [];

  for (let i = 1; i < tableLines.length; i++) {
    // Skip separator row (e.g. |---|---|)
    if (/^\|[\s\-:|]+\|$/.test(tableLines[i])) continue;
    rows.push(splitRow(tableLines[i]));
  }

  return {
    headers,
    rows,
    insightsMarkdown: afterTableLines.join("\n").trim(),
  };
}

/**
 * Format the synthesis matrix result into a clean Markdown note body.
 */
export function formatSynthesisMatrixNote(
  parsed: ParsedSynthesisMatrix,
  meta?: {
    title?: string;
    focusTopic?: string;
    papers?: SynthesisPaperInput[];
  },
): string {
  const lines: string[] = [];
  const mainTitle = meta?.title || "Literature Synthesis Matrix";
  lines.push(`# ${mainTitle}\n`);

  if (meta?.focusTopic) {
    lines.push(`> **Topic**: ${meta.focusTopic}\n`);
  }

  if (meta?.papers && meta.papers.length > 0) {
    lines.push("### Included Papers");
    meta.papers.forEach((p, idx) => {
      const author = p.authors ? ` (${p.authors}, ${p.year || "n.d."})` : "";
      lines.push(`${idx + 1}. **${p.title}**${author}`);
    });
    lines.push("");
  }

  if (parsed.headers.length > 0) {
    lines.push(`| ${parsed.headers.join(" | ")} |`);
    lines.push(`| ${parsed.headers.map(() => "---").join(" | ")} |`);
    for (const row of parsed.rows) {
      lines.push(`| ${row.join(" | ")} |`);
    }
    lines.push("");
  }

  if (parsed.insightsMarkdown) {
    lines.push(parsed.insightsMarkdown);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Answer title — what makes a matrix recognisable once it is written back
// ---------------------------------------------------------------------------

/** Fewest papers a comparison can be built from. */
export const SYNTHESIS_MATRIX_MIN_PAPERS = 2;

const SYNTHESIS_MATRIX_TITLE_PATTERN = buildAnswerTitlePattern([
  "Literature Synthesis Matrix",
  "Synthesis Matrix",
  "文献横向对比矩阵",
  "文獻橫向對比矩陣",
]);

/** Whether an assistant message is a synthesis matrix. */
export function isSynthesisMatrixText(text: unknown): boolean {
  return hasLeadingAnswerTitle(text, SYNTHESIS_MATRIX_TITLE_PATTERN);
}

/** The prompt block asking the matrix to open with its title line. */
export function buildSynthesisMatrixTitleRule(lang?: string | null): string {
  const resolved = resolveSynthesisMatrixLang(lang);
  return buildAnswerTitleRule(SYNTHESIS_MATRIX_TITLE[resolved], resolved);
}

/**
 * Reminder that the papers themselves ride along as document context.
 *
 * The prompt lists only titles, authors, and abstracts; the pinned papers'
 * extracted text reaches the model through the ordinary supplemental-context
 * path, so the model has to be told to read it instead of answering from the
 * metadata alone.
 */
export function buildSynthesisMatrixAttachedDocumentsNotice(
  lang?: string | null,
): string {
  return resolveSynthesisMatrixLang(lang) === "zh-CN"
    ? "**重要**：上述文献的正文已作为附加文档上下文随本次请求提供。请以附带的文档正文为准填写矩阵，metadata（标题/作者/摘要）只用于对齐编号，不要仅凭摘要作答。"
    : "**Important**: The full text of each paper above is attached to this request as supplemental document context. Fill the matrix from that attached text; the metadata (title/authors/abstract) is only there to identify which paper is which, so do not answer from the abstracts alone.";
}

// ---------------------------------------------------------------------------
// Paper input assembly (pure)
// ---------------------------------------------------------------------------

/** Raw fields as they come off a Zotero item, before normalisation. */
export type SynthesisPaperFields = {
  id?: string | number | null;
  title?: string | null;
  /** Creator display names, in Zotero's own order. */
  creators?: readonly (string | null | undefined)[] | null;
  /** Zotero's `date` field; only the year is kept. */
  date?: string | null;
  abstract?: string | null;
  keyTextSample?: string | null;
};

/** Longest key excerpt carried per paper, so several still fit one request. */
export const SYNTHESIS_KEY_TEXT_SAMPLE_MAX_CHARS = 1200;
/** Abstracts are metadata, not content; a long one is still clamped. */
export const SYNTHESIS_ABSTRACT_MAX_CHARS = 1500;

/**
 * Creator names as one author string.
 *
 * One name stands alone, two or three are joined the way a citation does, and
 * a longer list collapses to the first three plus `et al.` — the matrix header
 * has one column per paper, so the label has to stay short.
 */
export function formatSynthesisAuthors(
  creators: readonly (string | null | undefined)[] | null | undefined,
): string {
  const names = (creators || [])
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} & ${names[2]}`;
  return `${names.slice(0, 3).join(", ")} et al.`;
}

/** First four-digit year in a Zotero date field, or an empty string. */
export function extractSynthesisYear(
  date: string | number | null | undefined,
): string {
  const match = String(date ?? "").match(/\b(1\d{3}|20\d{2}|21\d{2})\b/);
  return match ? match[1] : "";
}

/**
 * Turn one paper's raw fields into a prompt input.
 *
 * Returns null without a title: an unnamed column would make the matrix
 * unreadable, and a paper Zotero cannot name is almost always a broken entry.
 */
export function buildSynthesisPaperInput(
  fields: SynthesisPaperFields,
): SynthesisPaperInput | null {
  const title = String(fields.title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return null;
  const authors = formatSynthesisAuthors(fields.creators);
  const year = extractSynthesisYear(fields.date);
  const abstract = String(fields.abstract || "")
    .trim()
    .slice(0, SYNTHESIS_ABSTRACT_MAX_CHARS);
  const keyTextSample = String(fields.keyTextSample || "")
    .trim()
    .slice(0, SYNTHESIS_KEY_TEXT_SAMPLE_MAX_CHARS);
  const input: SynthesisPaperInput = { title };
  if (fields.id !== null && fields.id !== undefined && fields.id !== "") {
    input.id = fields.id;
  }
  if (authors) input.authors = authors;
  if (year) input.year = year;
  if (abstract) input.abstract = abstract;
  if (keyTextSample) input.keyTextSample = keyTextSample;
  return input;
}

/**
 * Drop repeats, keeping the first occurrence.
 *
 * The panel's own document is very often also pinned as paper context, so the
 * two sources overlap by default. Identity is the Zotero id when both entries
 * carry one, and the normalised title otherwise.
 */
export function dedupeSynthesisPaperInputs(
  papers: readonly SynthesisPaperInput[],
): SynthesisPaperInput[] {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const out: SynthesisPaperInput[] = [];
  for (const paper of papers) {
    if (!paper?.title?.trim()) continue;
    const id =
      paper.id === null || paper.id === undefined ? "" : String(paper.id);
    const titleKey = paper.title.replace(/\s+/g, " ").trim().toLowerCase();
    if (id && seenIds.has(id)) continue;
    if (seenTitles.has(titleKey)) continue;
    if (id) seenIds.add(id);
    seenTitles.add(titleKey);
    out.push(paper);
  }
  return out;
}
