/**
 * Formula Breakdown — deep mathematical and physical interpretation of equations.
 *
 * Helps researchers dissect complex LaTeX equations by generating structured
 * symbol-by-symbol tables, tensor/matrix dimensions, physical intuitions, and
 * underlying mathematical assumptions.
 */

export type FormulaBreakdownLang = "en-US" | "zh-CN";

export function resolveFormulaBreakdownLang(
  lang: string | null | undefined,
): FormulaBreakdownLang {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

export interface BuildFormulaBreakdownPromptOptions {
  formula: string;
  contextPassage?: string;
  lang?: string;
}

/**
 * Extracts potential LaTeX formulas from raw text.
 */
export function extractFormulas(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];

  // 1. Extract block equations first ($$...$$, \[...\], \begin{...}...\end{...})
  const blockPatterns = [
    /\$\$([\s\S]+?)\$\$/g,
    /\\\[([\s\S]+?)\\\]/g,
    /\\begin\{(?:equation|align|gather|multline)\*?\}[\s\S]+?\\end\{(?:equation|align|gather|multline)\*?\}/g,
  ];

  let remaining = text;
  for (const pat of blockPatterns) {
    remaining = remaining.replace(pat, (_match, group) => {
      const formula = (group || _match).trim();
      if (formula.length > 1 && !found.includes(formula)) {
        found.push(formula);
      }
      return " ";
    });
  }

  // 2. Extract inline formulas ($...$, \(...\))
  const inlinePatterns = [/\$([^$\n]+?)\$/g, /\\\(([\s\S]+?)\\\)/g];

  for (const pat of inlinePatterns) {
    remaining = remaining.replace(pat, (_match, group) => {
      const formula = (group || _match).trim();
      if (formula.length > 1 && !found.includes(formula)) {
        found.push(formula);
      }
      return " ";
    });
  }

  // 3. If no delimiters found, check if the whole input looks like LaTeX
  if (found.length === 0 && text.trim().length > 0) {
    if (/[_\\^+\-*=<>(){}/]/.test(text)) {
      found.push(text.trim());
    }
  }

  return found;
}

/**
 * Builds a prompt for dissecting a complex mathematical equation.
 */
export function buildFormulaBreakdownPrompt(
  options: BuildFormulaBreakdownPromptOptions,
): string {
  const lang = resolveFormulaBreakdownLang(options.lang);
  const formula = options.formula.trim();
  const context = options.contextPassage
    ? `\n\n**Surrounding Context**:\n"""\n${options.contextPassage.trim()}\n"""`
    : "";

  if (lang === "zh-CN") {
    const contextZh = options.contextPassage
      ? `\n\n**公式所在论文上下文**：\n"""\n${options.contextPassage.trim()}\n"""`
      : "";
    return [
      "作为资深数学家与顶级学术论文评审专家，请对以下数学公式进行深度、严谨的结构化拆解与直觉解释。",
      "",
      "**待解析公式**：",
      `$$${formula}$$${contextZh}`,
      "",
      "## 输出结构规范：",
      "1. **【核心直觉与物理/统计意义 (Intuition & Purpose)】**：一句话概括此公式的核心目标和物理/几何直觉。",
      "2. **【符号与变量拆解表 (Symbol Breakdown Table)】**：以 Markdown 表格逐行解析公式中的每一个变量、算子、下标与常数：",
      "   | 符号 (Symbol) | 数学/物理含义 (Meaning) | 维度/数据类型 (Dimension/Type) | 上下文作用 (Role) |",
      "3. **【分步计算与推导脉络 (Step-by-step Mechanics)】**：拆解公式各组成部分（如求和项、惩罚项、归一化常数等）如何协同运作。",
      "4. **【核心假设与适用前提 (Assumptions & Constraints)】**：列出该公式成立所需的关键数学假设或边界约束。",
    ].join("\n");
  }

  return [
    "As an expert mathematician and academic research reviewer, please provide a rigorous, structured breakdown and intuition for the following mathematical equation.",
    "",
    "**Target Formula**:",
    `$$${formula}$$${context}`,
    "",
    "## Output Requirements:",
    "1. **【Core Intuition & Purpose】**: Summarize in 1-2 sentences what this equation achieves and its physical/geometric intuition.",
    "2. **【Symbol Breakdown Table】**: A Markdown table detailing every variable, operator, subscript, and parameter:",
    "   | Symbol | Meaning | Dimension / Type | Contextual Role |",
    "3. **【Step-by-step Mechanics】**: Explain how sub-expressions (e.g. normalization, penalty terms, loss gradients) combine.",
    "4. **【Assumptions & Constraints】**: Key mathematical conditions, distributions, or boundary constraints required.",
  ].join("\n");
}
