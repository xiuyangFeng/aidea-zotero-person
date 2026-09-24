import { expect } from "chai";
import {
  buildSentenceDissectorPrompt,
  resolveSentenceDissectorLang,
} from "../src/utils/sentenceDissector";

describe("sentence dissector", function () {
  it("resolves language correctly", function () {
    expect(resolveSentenceDissectorLang("zh-CN")).to.equal("zh-CN");
    expect(resolveSentenceDissectorLang("zh")).to.equal("zh-CN");
    expect(resolveSentenceDissectorLang("en-US")).to.equal("en-US");
    expect(resolveSentenceDissectorLang(null)).to.equal("en-US");
  });

  it("builds prompt in English with context", function () {
    const prompt = buildSentenceDissectorPrompt({
      sentence:
        "Although previous approaches have demonstrated promising results under constrained laboratory settings, their inability to generalize to out-of-distribution real-world scenarios poses a formidable challenge.",
      contextPassage: "We study generalization in deep reinforcement learning.",
      lang: "en-US",
    });

    expect(prompt).to.include("Core SVO Backbone");
    expect(prompt).to.include("Hierarchical Clause Breakdown");
    expect(prompt).to.include("Although previous approaches");
    expect(prompt).to.include(
      "We study generalization in deep reinforcement learning",
    );
  });

  it("builds prompt in Chinese", function () {
    const prompt = buildSentenceDissectorPrompt({
      sentence:
        "Notwithstanding the substantial progress achieved in recent years, critical vulnerabilities remain largely unaddressed.",
      lang: "zh-CN",
    });

    expect(prompt).to.include("语法骨架与逻辑层级解构");
    expect(prompt).to.include("核心主干");
    expect(prompt).to.include("修饰与嵌套从句层级拆解");
  });
});
