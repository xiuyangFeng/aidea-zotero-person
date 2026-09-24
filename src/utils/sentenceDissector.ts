/**
 * Sentence Dissector — grammatical skeleton extraction and hierarchical clause breakdown.
 *
 * Designed for complex academic long sentences (multi-level nested clauses,
 * participle modifiers, inversions). Deconstructs the core Subject-Verb-Object
 * backbone, visualizes clause dependencies with indentations, and provides
 * an idiomatic academic translation.
 */

export type SentenceDissectorLang = "en-US" | "zh-CN";

export function resolveSentenceDissectorLang(
  lang: string | null | undefined,
): SentenceDissectorLang {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

export interface BuildSentenceDissectorPromptOptions {
  sentence: string;
  contextPassage?: string;
  lang?: string;
}

/**
 * Builds a prompt for decomposing complex academic sentences.
 */
export function buildSentenceDissectorPrompt(
  options: BuildSentenceDissectorPromptOptions,
): string {
  const lang = resolveSentenceDissectorLang(options.lang);
  const sentence = options.sentence.trim();
  const context = options.contextPassage
    ? `\n\n**Surrounding Context**:\n"""\n${options.contextPassage.trim()}\n"""`
    : "";

  if (lang === "zh-CN") {
    const contextZh = options.contextPassage
      ? `\n\n**上下文背景**：\n"""\n${options.contextPassage.trim()}\n"""`
      : "";
    return [
      "作为资深英语语言学专家与学术论文评审，请对以下学术长难句进行清晰的【语法骨架与逻辑层级解构】。",
      "",
      "**待解构长难句**：",
      `"""\n${sentence}\n"""${contextZh}`,
      "",
      "## 输出结构规范：",
      "1. **【核心主干 (Core SVO Backbone)】**：直接提取句子的最核心骨架（主语 + 谓语动词 + 宾语/表语），剔除所有修饰语。",
      "2. **【修饰与嵌套从句层级拆解 (Hierarchical Clause Breakdown)】**：",
      "   - 用层级缩进列表（或表格）标注每个从句、分词短语、介词短语修饰的是哪一部分（如定语修饰主语、伴随状语修饰主句动作等）。",
      "3. **【学术地道通俗意译 (Idiomatic Academic Translation)】**：",
      "   - 给出符合中文思维习惯与学术严谨性的流畅意译，消除翻译腔。",
      "4. **【核心难词与短语点拨 (Key Vocab & Collocations)】**：简要列出 1~3 个关键学术用语的精准含义与搭配用法。",
    ].join("\n");
  }

  return [
    "As an expert in English linguistics and academic writing, please perform a rigorous 【Grammatical Skeleton & Clause Decomposition】 on the following complex academic sentence.",
    "",
    "**Target Sentence**:",
    `"""\n${sentence}\n"""${context}`,
    "",
    "## Output Requirements:",
    "1. **【Core SVO Backbone】**: Extract the primary grammatical backbone (Subject + Main Verb + Object/Complement), stripping all nested modifiers.",
    "2. **【Hierarchical Clause Breakdown】**: A structured hierarchical list showing subordinate clauses, participle phrases, and what each element modifies.",
    "3. **【Idiomatic Paraphrase & Clarification】**: An exceptionally clear, accessible academic paraphrase in plain language.",
    "4. **【Key Academic Vocabulary & Idioms】**: 1-3 essential academic collocations or terms explained in context.",
  ].join("\n");
}
