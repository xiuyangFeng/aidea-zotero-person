/**
 * Algorithm Walkthrough — step-by-step pseudocode tracing and toy example derivation.
 *
 * Turns complex, abstract algorithm pseudocodes into intuitive, step-by-step
 * walkthroughs with concrete miniature data inputs (Toy Examples), tracking
 * variable states, loop iterations, tensor shapes, and boundary conditions.
 */

export type AlgorithmWalkthroughLang = "en-US" | "zh-CN";

export function resolveAlgorithmWalkthroughLang(
  lang: string | null | undefined,
): AlgorithmWalkthroughLang {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

export interface BuildAlgorithmWalkthroughPromptOptions {
  algorithmText: string;
  paperContext?: string;
  lang?: string;
}

const ALGORITHM_PATTERNS = [
  /(?:Algorithm\s+\d+[:.]?[\s\S]+?(?=(?:Algorithm\s+\d+|References|Figure\s+\d+|\n\n\n|$)))/gi,
  /\\begin\{algorithmic\}[\s\S]+?\\end\{algorithmic\}/g,
];

/**
 * Extracts algorithm blocks from document text.
 */
export function extractAlgorithms(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];

  for (const pattern of ALGORITHM_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const algo = match[0].trim();
      if (algo.length > 20 && !found.includes(algo)) {
        found.push(algo);
      }
    }
  }

  if (
    found.length === 0 &&
    (text.includes("Input:") ||
      text.includes("Output:") ||
      text.includes("for each") ||
      text.includes("while "))
  ) {
    if (text.trim().length > 10) {
      found.push(text.trim());
    }
  }

  return found;
}

/**
 * Builds a prompt for stepping through an algorithm with a toy example.
 */
export function buildAlgorithmWalkthroughPrompt(
  options: BuildAlgorithmWalkthroughPromptOptions,
): string {
  const lang = resolveAlgorithmWalkthroughLang(options.lang);
  const code = options.algorithmText.trim();
  const context = options.paperContext
    ? `\n\n**Paper Context**:\n"""\n${options.paperContext.trim()}\n"""`
    : "";

  if (lang === "zh-CN") {
    const contextZh = options.paperContext
      ? `\n\n**论文相关上下文**：\n"""\n${options.paperContext.trim()}\n"""`
      : "";
    return [
      "作为顶级算法专家与计算机科学导师，请对以下论文中的算法伪代码进行生动、严谨且易懂的【步进推导与玩具样例剖析】。",
      "",
      "**待推导算法伪代码**：",
      "```text",
      code,
      "```",
      contextZh,
      "",
      "## 输出要求：",
      "1. **【核心设计直觉 (High-Level Purpose)】**：用 2~3 句话说明该算法旨在解决什么核心计算瓶颈，其设计直觉是什么。",
      "2. **【微型数据玩具样例跟踪 (Toy Example Step-by-Step Trace)】**：",
      "   - 构造一组极其简单具体的迷你输入（如 3 个元素的数组或 2x2 小矩阵）；",
      "   - 以表格或清晰的分步编号，详细跟踪每一轮循环/迭代中各个关键变量、指针或张量形状的变化过程，直至产出最终输出。",
      "3. **【关键控制流与技巧剖析 (Key Mechanics & Tricks)】**：解释伪代码中最精妙的一两处逻辑（如特定剪枝条件、温度退火、正则约束等）。",
      "4. **【时空复杂度与边界陷阱 (Complexity & Edge Cases)】**：分析时间/空间复杂度，并指出在工程落地时容易踩坑的边界情况（如除零、死循环、显存暴涨等）。",
    ].join("\n");
  }

  return [
    "As an expert computer scientist and algorithm educator, please provide an intuitive, step-by-step 【Algorithm Walkthrough & Toy Example Trace】 for the following paper pseudocode.",
    "",
    "**Target Algorithm Pseudocode**:",
    "```text",
    code,
    "```",
    context,
    "",
    "## Output Requirements:",
    "1. **【High-Level Purpose & Intuition】**: 2-3 sentences explaining what problem this algorithm solves and the core intuition behind it.",
    "2. **【Toy Example Step-by-Step Trace】**:",
    "   - Construct a concrete, miniature toy input (e.g. 3-element vector or 2x2 matrix);",
    "   - Trace every iteration step-by-step showing exact variable state transitions, intermediate shapes, and the final return value.",
    "3. **【Key Mechanisms & Nuances】**: Explain the most critical algorithmic tricks (e.g. early stopping, temperature scaling, momentum update).",
    "4. **【Complexity & Engineering Edge Cases】**: Detail time/space complexity and potential real-world failure modes / edge cases.",
  ].join("\n");
}
