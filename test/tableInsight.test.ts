import { expect } from "chai";
import {
  buildTableInsightPrompt,
  resolveTableInsightLang,
} from "../src/utils/tableInsight";

describe("table insight", function () {
  it("resolves language correctly", function () {
    expect(resolveTableInsightLang("zh-CN")).to.equal("zh-CN");
    expect(resolveTableInsightLang("en-US")).to.equal("en-US");
  });

  it("builds prompt in English with table caption and context", function () {
    const tableStr = `
| Model | ImageNet Top-1 | Parameters | FLOPs |
| --- | --- | --- | --- |
| ResNet-50 | 76.1% | 25.6M | 4.1B |
| Ours-S | 82.4% | 24.2M | 3.8B |
`;

    const prompt = buildTableInsightPrompt({
      tableContent: tableStr,
      tableCaption: "Table 1: Comparison with state-of-the-art vision models.",
      paperContext: "Image classification benchmarks",
      lang: "en-US",
    });

    expect(prompt).to.include("Key Baseline Wins & Relative Deltas");
    expect(prompt).to.include("Table 1: Comparison with state-of-the-art");
    expect(prompt).to.include("ResNet-50");
    expect(prompt).to.include("Ours-S");
  });

  it("builds prompt in Chinese for ablation analysis", function () {
    const prompt = buildTableInsightPrompt({
      tableContent:
        "| Component Removed | BLEU Score |\n| None (Full) | 38.4 |\n| - Multi-head Attention | 31.2 |\n| - Positional Encoding | 14.5 |",
      tableCaption: "表 2: 消融实验分析",
      lang: "zh-CN",
    });

    expect(prompt).to.include("核心胜出基准与提升幅度");
    expect(prompt).to.include("消融实验组件贡献排序");
    expect(prompt).to.include("表 2: 消融实验分析");
  });
});
