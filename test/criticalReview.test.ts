import { expect } from "chai";
import {
  buildCriticalReviewAttachedDocumentNotice,
  buildCriticalReviewPrompt,
  buildCriticalReviewTitleRule,
  isCriticalReviewText,
  resolveCriticalReviewLang,
  CRITICAL_REVIEW_NOTE_TAG,
  CRITICAL_REVIEW_TITLE,
} from "../src/utils/criticalReview";

describe("critical review", function () {
  it("has correct note tag", function () {
    expect(CRITICAL_REVIEW_NOTE_TAG).to.equal("aidea-critical-review");
  });

  it("resolves language correctly", function () {
    expect(resolveCriticalReviewLang("zh-CN")).to.equal("zh-CN");
    expect(resolveCriticalReviewLang("en-US")).to.equal("en-US");
  });

  it("builds prompt in English", function () {
    const prompt = buildCriticalReviewPrompt({
      paperTitle: "A Novel Fast Optimizer",
      paperContent:
        "We evaluated our optimizer on synthetic quadric functions.",
      focusSection: "Experimental Evaluation",
      lang: "en-US",
    });

    expect(prompt).to.include("Critical Peer Review & Flaw Detection");
    expect(prompt).to.include("Methodological & Empirical Vulnerabilities");
    expect(prompt).to.include("**Focus Section**: Experimental Evaluation");
    expect(prompt).to.include("A Novel Fast Optimizer");
  });

  it("builds prompt in Chinese", function () {
    const prompt = buildCriticalReviewPrompt({
      paperTitle: "快速优化器",
      paperContent: "我们在合成函数上进行了测试。",
      lang: "zh-CN",
    });

    expect(prompt).to.include("学术审辩与盲点探测");
    expect(prompt).to.include("Baseline 选取的充分性与公平性");
    expect(prompt).to.include("隐藏假设与理论边界");
  });

  describe("answer title", function () {
    it("recognizes a whole-document review by its first line", function () {
      expect(isCriticalReviewText("# Critical Review\n\nBody")).to.equal(true);
      expect(isCriticalReviewText("# 批判性评审\n\n正文")).to.equal(true);
      expect(isCriticalReviewText("## **Critical Peer Review**")).to.equal(
        true,
      );
    });

    it("does not claim other answers", function () {
      expect(isCriticalReviewText("# Reading Card")).to.equal(false);
      expect(
        isCriticalReviewText("Some prose about a critical review"),
      ).to.equal(false);
      expect(isCriticalReviewText("")).to.equal(false);
    });

    it("asks for the title the recognizer looks for", function () {
      for (const lang of ["en-US", "zh-CN"] as const) {
        const rule = buildCriticalReviewTitleRule(lang);
        expect(rule).to.include(`# ${CRITICAL_REVIEW_TITLE[lang]}`);
        expect(
          isCriticalReviewText(`# ${CRITICAL_REVIEW_TITLE[lang]}`),
        ).to.equal(true);
      }
    });

    it("names the attached document instead of pasting it", function () {
      expect(buildCriticalReviewAttachedDocumentNotice("en-US")).to.include(
        "document context",
      );
      expect(buildCriticalReviewAttachedDocumentNotice("zh-CN")).to.include(
        "文档上下文",
      );
    });
  });
});
