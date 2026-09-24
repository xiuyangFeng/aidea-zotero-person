import { expect } from "chai";
import {
  buildPolishingPrompt,
  buildPolishingTitleRule,
  computeWordDiff,
  isPolishingAnswerText,
  renderDiffHtml,
  splitPolishingAnswer,
  tokenizeForDiff,
  POLISHING_TITLE,
} from "../src/utils/academicPolishing";

describe("academic polishing & diff", function () {
  it("builds prompt in English for academic-tone mode", function () {
    const prompt = buildPolishingPrompt({
      text: "We did a lot of experiments and it shows our method is super good.",
      mode: "academic-tone",
      lang: "en-US",
    });

    expect(prompt).to.include("academic-tone");
    expect(prompt).to.include("Enhance academic formality");
    expect(prompt).to.include("We did a lot of experiments");
  });

  it("builds prompt in Chinese for conciseness mode", function () {
    const prompt = buildPolishingPrompt({
      text: "通过大量的实验证明，我们的方法在各个方面都取得了非常显著的优越表现。",
      mode: "conciseness",
      lang: "zh-CN",
    });

    expect(prompt).to.include("conciseness");
    expect(prompt).to.include("精简压缩篇幅");
  });

  it("tokenizes sentences properly into words, punctuation, and spaces", function () {
    const tokens = tokenizeForDiff("Hello, world! 这是一个测试。");
    expect(tokens).to.include("Hello");
    expect(tokens).to.include(",");
    expect(tokens).to.include(" ");
    expect(tokens).to.include("world");
    expect(tokens).to.include("!");
  });

  it("computes word-level diff correctly", function () {
    const orig = "We propose a simple and fast approach.";
    const rev = "We present an efficient and robust method.";

    const diffs = computeWordDiff(orig, rev);
    expect(diffs.length).to.be.greaterThan(0);

    const deletes = diffs.filter((d) => d.type === "delete").map((d) => d.text);
    const inserts = diffs.filter((d) => d.type === "insert").map((d) => d.text);

    expect(deletes.join(" ")).to.include("propose");
    expect(inserts.join(" ")).to.include("present");
  });

  it("renders diff into highlighted HTML", function () {
    const diffs = [
      { type: "equal" as const, text: "We " },
      { type: "delete" as const, text: "propose" },
      { type: "insert" as const, text: "present" },
      { type: "equal" as const, text: " a method." },
    ];

    const html = renderDiffHtml(diffs);
    expect(html).to.include('<del class="diff-del"');
    expect(html).to.include('<ins class="diff-ins"');
    expect(html).to.include("present");
    expect(html).to.include("propose");
  });

  describe("answer title", function () {
    it("recognizes a polishing answer by its first line", function () {
      expect(isPolishingAnswerText("# Academic Polishing\n\nText")).to.equal(
        true,
      );
      expect(isPolishingAnswerText("# 学术润色\n\n正文")).to.equal(true);
      expect(isPolishingAnswerText("# Reading Card")).to.equal(false);
      expect(isPolishingAnswerText("We polished the text.")).to.equal(false);
    });

    it("asks for the title the recognizer looks for", function () {
      for (const lang of ["en-US", "zh-CN"] as const) {
        const rule = buildPolishingTitleRule(lang);
        expect(rule).to.include(`# ${POLISHING_TITLE[lang]}`);
        expect(isPolishingAnswerText(`# ${POLISHING_TITLE[lang]}`)).to.equal(
          true,
        );
      }
    });
  });

  describe("splitPolishingAnswer", function () {
    it("splits an English answer at the Key Revisions heading", function () {
      const answer = [
        "# Academic Polishing",
        "",
        "The proposed optimizer converges rapidly.",
        "It also generalizes.",
        "",
        "## Key Revisions & Rationale",
        '- Replaced "super good".',
      ].join("\n");
      const split = splitPolishingAnswer(answer);
      expect(split.revised).to.equal(
        "The proposed optimizer converges rapidly.\nIt also generalizes.",
      );
      expect(split.notes).to.equal(
        '## Key Revisions & Rationale\n- Replaced "super good".',
      );
    });

    it("splits a Chinese answer at a bold 主要修改要点 heading", function () {
      const answer = [
        "# 学术润色",
        "",
        "本文提出的优化器在凸目标上收敛迅速。",
        "",
        "**主要修改要点**",
        "1. 将口语化表述替换为学术表述。",
      ].join("\n");
      const split = splitPolishingAnswer(answer);
      expect(split.revised).to.equal("本文提出的优化器在凸目标上收敛迅速。");
      expect(split.notes).to.include("主要修改要点");
    });

    it("unwraps a code fence around the whole answer", function () {
      const answer = [
        "```markdown",
        "# Academic Polishing",
        "",
        "Revised body line.",
        "",
        "### Key Revisions",
        "- one",
        "```",
      ].join("\n");
      expect(splitPolishingAnswer(answer).revised).to.equal(
        "Revised body line.",
      );
    });

    it("unwraps a code fence around the revised text alone", function () {
      const answer = [
        "# Academic Polishing",
        "```text",
        "Revised body line.",
        "```",
        "## Key Revisions",
        "- one",
      ].join("\n");
      expect(splitPolishingAnswer(answer).revised).to.equal(
        "Revised body line.",
      );
    });

    it("keeps the whole body when there is no revisions section", function () {
      const split = splitPolishingAnswer(
        "# Academic Polishing\n\nJust the revised text.",
      );
      expect(split.revised).to.equal("Just the revised text.");
      expect(split.notes).to.equal("");
    });

    it("does not end the revised text on a passing mention", function () {
      const answer = [
        "# Academic Polishing",
        "",
        "This section explains our key revisions to the sampler.",
        "",
        "## Key Revisions",
        "- one",
      ].join("\n");
      const split = splitPolishingAnswer(answer);
      expect(split.revised).to.equal(
        "This section explains our key revisions to the sampler.",
      );
      expect(split.notes).to.equal("## Key Revisions\n- one");
    });

    it("works on an answer with no title line", function () {
      expect(splitPolishingAnswer("Plain revised text.").revised).to.equal(
        "Plain revised text.",
      );
    });

    it("returns empty halves for empty or non-string input", function () {
      expect(splitPolishingAnswer("")).to.deep.equal({
        revised: "",
        notes: "",
      });
      expect(splitPolishingAnswer(null)).to.deep.equal({
        revised: "",
        notes: "",
      });
    });
  });
});
