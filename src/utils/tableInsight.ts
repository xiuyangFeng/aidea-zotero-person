/**
 * Table Insight — experimental table analysis and ablation study synthesis.
 *
 * Extracts key baseline performance deltas, ranks the impact of individual
 * architectural components in ablation studies, and highlights edge cases
 * where the proposed method underperforms or reaches parity.
 */

export type TableInsightLang = "en-US" | "zh-CN";

export function resolveTableInsightLang(
  lang: string | null | undefined,
): TableInsightLang {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

export interface BuildTableInsightPromptOptions {
  tableContent: string;
  tableCaption?: string;
  paperContext?: string;
  lang?: string;
}

/**
 * Builds a prompt for synthesizing experimental tables and ablation studies.
 */
export function buildTableInsightPrompt(
  options: BuildTableInsightPromptOptions,
): string {
  const lang = resolveTableInsightLang(options.lang);
  const table = options.tableContent.trim();
  const caption = options.tableCaption
    ? `\n**Table Caption**: ${options.tableCaption.trim()}`
    : "";
  const context = options.paperContext
    ? `\n**Context / Task Description**:\n"""\n${options.paperContext.trim()}\n"""`
    : "";

  if (lang === "zh-CN") {
    return [
      "作为顶级机器学习与实验评估专家，请对以下学术论文中的实验/消融数据表格进行深度提炼与客观分析。",
      "",
      `**待分析表格**：${caption}`,
      "```text",
      table,
      "```",
      context,
      "",
      "## 提炼与分析要求：",
      "1. **【核心胜出基准与提升幅度 (Key Wins & Deltas)】**：",
      "   - 列出论文方法（Ours）在哪些关键数据集/主指标上取得了最大胜出；",
      "   - 具体量化相比 SOTA / 主要 Baseline 的绝对提升值和相对百分比提升。",
      "2. **【消融实验组件贡献排序 (Ablation Impact Ranking)】**（若是消融表）：",
      "   - 按照组件对最终性能的贡献度降序排列（哪一个模块去掉后掉点最多、哪一个模块最具性价比）。",
      "3. **【持平、短板与异常表现 (Limitations & Parity Cases)】**：",
      "   - 客观指出在哪些子集、评测维度或资源消耗（如参数量/推理延迟）上本方法未能超越 Baseline 或提升微弱。",
      "4. **【核心实验结论总结 (Takeaway for Researchers)】**：用 2 句话总结该实验为后续研究带来的核心启发。",
    ].join("\n");
  }

  return [
    "As an expert machine learning and experimental empirical evaluator, please provide a rigorous, objective synthesis of the following experimental or ablation table.",
    "",
    `**Target Table**: ${caption}`,
    "```text",
    table,
    "```",
    context,
    "",
    "## Synthesis Requirements:",
    "1. **【Key Baseline Wins & Relative Deltas】**:",
    "   - Highlight where the proposed method ('Ours') achieves its largest gains over primary baselines and prior SOTA;",
    "   - Quantify both absolute deltas and relative percentage improvements across key metrics.",
    "2. **【Ablation Component Impact Ranking】** (if applicable):",
    "   - Rank modules/components by their marginal utility (which component causes the largest performance drop when removed).",
    "3. **【Parity Cases, Trade-offs & Limitations】**:",
    "   - Objectively identify where the method shows negligible gains, underperforms, or introduces trade-offs (e.g. latency, memory footprint).",
    "4. **【Key Experimental Takeaway】**: A concise 2-sentence summary of empirical lessons for practitioners.",
  ].join("\n");
}
