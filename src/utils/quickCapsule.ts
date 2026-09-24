/**
 * Quick-Action Capsule — inline floating actions and adaptive context recommendation.
 *
 * Provides action definitions and an intelligent feature detector that analyzes
 * selected text (e.g. formula, algorithm, long sentence, term, table) to
 * dynamically prioritize and surface the most relevant reading action.
 */

export type CapsuleActionKind =
  | "translate"
  | "dissect"
  | "explain"
  | "concept"
  | "formula"
  | "algorithm"
  | "table"
  | "review";

export type QuickCapsuleLang = "en-US" | "zh-CN";

export interface CapsuleActionDefinition {
  kind: CapsuleActionKind;
  icon: string;
  label: Record<QuickCapsuleLang, string>;
  description: Record<QuickCapsuleLang, string>;
}

export const CAPSULE_ACTIONS: Record<
  CapsuleActionKind,
  CapsuleActionDefinition
> = {
  translate: {
    kind: "translate",
    icon: "🔤",
    label: { "en-US": "Translate", "zh-CN": "翻译" },
    description: {
      "en-US": "Fast, context-aware academic translation",
      "zh-CN": "语境感知的高质量学术翻译",
    },
  },
  dissect: {
    kind: "dissect",
    icon: "🌿",
    label: { "en-US": "Dissect", "zh-CN": "长难句解构" },
    description: {
      "en-US": "Deconstruct grammatical backbone & nested clauses",
      "zh-CN": "拆解语法主谓宾主干与从句嵌套",
    },
  },
  explain: {
    kind: "explain",
    icon: "💡",
    label: { "en-US": "Explain", "zh-CN": "通俗简释" },
    description: {
      "en-US": "Plain-language intuitive explanation",
      "zh-CN": "一句话大白话直觉解释",
    },
  },
  concept: {
    kind: "concept",
    icon: "🏷️",
    label: { "en-US": "Save Concept", "zh-CN": "术语卡片" },
    description: {
      "en-US": "Extract definition into cross-paper glossary",
      "zh-CN": "抽取术语定义存入跨文献词典",
    },
  },
  formula: {
    kind: "formula",
    icon: "📐",
    label: { "en-US": "Formula", "zh-CN": "公式拆解" },
    description: {
      "en-US": "Symbol breakdown, tensor dimensions, and intuition",
      "zh-CN": "符号表格、张量维度与物理直觉",
    },
  },
  algorithm: {
    kind: "algorithm",
    icon: "⚙️",
    label: { "en-US": "Step Trace", "zh-CN": "算法推导" },
    description: {
      "en-US": "Step-by-step trace with toy examples",
      "zh-CN": "玩具样例步进跟踪与状态变化",
    },
  },
  table: {
    kind: "table",
    icon: "📊",
    label: { "en-US": "Table Insight", "zh-CN": "实验提炼" },
    description: {
      "en-US": "Baseline wins, ablation impacts, and trade-offs",
      "zh-CN": "Baseline胜出幅度与消融贡献排序",
    },
  },
  review: {
    kind: "review",
    icon: "🧐",
    label: { "en-US": "Critique", "zh-CN": "审辩质疑" },
    description: {
      "en-US": "Peer-reviewer flaw detection & hidden assumptions",
      "zh-CN": "审稿人视角探测漏洞与隐藏假设",
    },
  },
};

export type TextFeatureProfile = {
  isFormula: boolean;
  isAlgorithm: boolean;
  isTable: boolean;
  isLongSentence: boolean;
  isShortTerm: boolean;
};

/**
 * Detects structural and linguistic features of the selected text.
 */
export function detectTextFeatures(text: string): TextFeatureProfile {
  const clean = String(text || "").trim();
  const wordCount = clean.split(/\s+/).filter(Boolean).length;

  const isFormula =
    /\$|\$\$|\\sigma|\\nabla|\\mathcal|\\frac|\\sum|\\int|\\begin\{equation\}|\^2|_i/i.test(
      clean,
    );

  const isAlgorithm =
    /(?:algorithm\s+\d+|input\s*:|output\s*:|while\s+|for\s+each|return\s+|\\begin\{algorithmic\})/i.test(
      clean,
    ) && clean.includes("\n");

  const isTable =
    clean.startsWith("|") && clean.includes("\n") && clean.includes("|");

  const isLongSentence =
    wordCount >= 20 || (clean.length >= 100 && /[;:,]/.test(clean));

  const isShortTerm =
    wordCount >= 1 && wordCount <= 5 && !clean.includes("\n") && !isFormula;

  return {
    isFormula,
    isAlgorithm,
    isTable,
    isLongSentence,
    isShortTerm,
  };
}

/**
 * Recommends an ordered list of capsule actions tailored to the selection.
 */
export function recommendCapsuleActions(text: string): CapsuleActionKind[] {
  const features = detectTextFeatures(text);
  const actions: CapsuleActionKind[] = [];

  if (features.isFormula) {
    actions.push("formula", "explain", "translate");
  } else if (features.isAlgorithm) {
    actions.push("algorithm", "explain", "review");
  } else if (features.isTable) {
    actions.push("table", "review", "explain");
  } else if (features.isLongSentence) {
    actions.push("dissect", "translate", "explain", "review");
  } else if (features.isShortTerm) {
    actions.push("concept", "explain", "translate");
  } else {
    actions.push("translate", "explain", "dissect", "concept");
  }

  // Append remaining actions for completeness
  const allKinds: CapsuleActionKind[] = [
    "translate",
    "explain",
    "dissect",
    "concept",
    "formula",
    "algorithm",
    "table",
    "review",
  ];

  for (const k of allKinds) {
    if (!actions.includes(k)) {
      actions.push(k);
    }
  }

  return actions;
}
