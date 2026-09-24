import { expect } from "chai";

import {
  buildAnswerTitlePattern,
  buildAnswerTitleRule,
  hasLeadingAnswerTitle,
} from "../src/utils/answerTitles";

const pattern = buildAnswerTitlePattern(["Critical Review", "批判性评审"]);

describe("answer titles", function () {
  it("recognizes a plain title line", function () {
    expect(
      hasLeadingAnswerTitle("# Critical Review\n\nBody", pattern),
    ).to.equal(true);
    expect(hasLeadingAnswerTitle("# 批判性评审\n\n正文", pattern)).to.equal(
      true,
    );
  });

  it("tolerates hash levels, bold wrappers, an AIdea prefix and a suffix", function () {
    expect(hasLeadingAnswerTitle("### Critical Review", pattern)).to.equal(
      true,
    );
    expect(hasLeadingAnswerTitle("## **Critical Review**", pattern)).to.equal(
      true,
    );
    expect(
      hasLeadingAnswerTitle("# AIdea — Critical Review", pattern),
    ).to.equal(true);
    expect(
      hasLeadingAnswerTitle("# Critical Review: Attention", pattern),
    ).to.equal(true);
  });

  it("looks past a wrapping code fence without spending a scan slot", function () {
    const fenced = ["```markdown", "# Critical Review", "body"].join("\n");
    expect(hasLeadingAnswerTitle(fenced, pattern)).to.equal(true);
  });

  it("gives up after the first few content lines", function () {
    const buried = [
      "one",
      "two",
      "three",
      "four",
      "five",
      "# Critical Review",
    ].join("\n");
    expect(hasLeadingAnswerTitle(buried, pattern)).to.equal(false);
  });

  it("rejects an unmarked heading and non-string input", function () {
    expect(hasLeadingAnswerTitle("# Reading Card", pattern)).to.equal(false);
    expect(hasLeadingAnswerTitle("Critical Review", pattern)).to.equal(false);
    expect(hasLeadingAnswerTitle("", pattern)).to.equal(false);
    expect(hasLeadingAnswerTitle(null, pattern)).to.equal(false);
    expect(hasLeadingAnswerTitle(42, pattern)).to.equal(false);
  });

  it("never matches when there is no variant to match", function () {
    const empty = buildAnswerTitlePattern(["", "   "]);
    expect(hasLeadingAnswerTitle("# anything", empty)).to.equal(false);
  });

  it("escapes regex metacharacters in a title", function () {
    const dotted = buildAnswerTitlePattern(["A.B"]);
    expect(hasLeadingAnswerTitle("# A.B", dotted)).to.equal(true);
    expect(hasLeadingAnswerTitle("# AxB", dotted)).to.equal(false);
  });

  it("builds a title rule naming the exact line, in both languages", function () {
    expect(buildAnswerTitleRule("Critical Review", "en-US")).to.include(
      "`# Critical Review`",
    );
    expect(buildAnswerTitleRule("批判性评审", "zh-CN")).to.include(
      "`# 批判性评审`",
    );
    expect(buildAnswerTitleRule("  ", "en-US")).to.equal("");
  });
});
