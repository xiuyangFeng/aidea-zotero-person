import { expect } from "chai";
import {
  extractFormulas,
  buildFormulaBreakdownPrompt,
} from "../src/utils/formulaBreakdown";

describe("formula breakdown", function () {
  it("extracts inline and block LaTeX equations", function () {
    const text =
      "Consider the attention formula: $$\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$$ and $E = mc^2$.";
    const formulas = extractFormulas(text);

    expect(formulas.length).to.equal(2);
    expect(formulas).to.include("E = mc^2");
    expect(formulas[0]).to.include("\\text{Attention}");
  });

  it("extracts raw math expression when no delimiters are used", function () {
    const raw =
      "\\mathcal{L}_{\\text{total}} = \\lambda_1 \\mathcal{L}_{\\text{CE}} + \\lambda_2 \\mathcal{L}_{\\text{reg}}";
    const formulas = extractFormulas(raw);

    expect(formulas.length).to.equal(1);
    expect(formulas[0]).to.include("\\mathcal{L}_{\\text{total}}");
  });

  it("builds formula prompt in English", function () {
    const prompt = buildFormulaBreakdownPrompt({
      formula: "f(x) = \\sigma(W x + b)",
      contextPassage:
        "We apply a linear projection followed by a sigmoid activation.",
      lang: "en-US",
    });

    expect(prompt).to.include("f(x) = \\sigma(W x + b)");
    expect(prompt).to.include("Symbol Breakdown Table");
    expect(prompt).to.include("Core Intuition & Purpose");
  });

  it("builds formula prompt in Chinese", function () {
    const prompt = buildFormulaBreakdownPrompt({
      formula: "\\nabla_{\\theta} J(\\theta)",
      lang: "zh-CN",
    });

    expect(prompt).to.include("\\nabla_{\\theta} J(\\theta)");
    expect(prompt).to.include("符号与变量拆解表");
    expect(prompt).to.include("核心直觉与物理/统计意义");
  });
});
