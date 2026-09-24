import { expect } from "chai";

import {
  buildReadingActionPrompt,
  isReadingActionKind,
  READING_ACTION_KINDS,
  type ReadingActionKind,
} from "../src/modules/contextPanel/readingActions";
import { CAPSULE_ACTIONS } from "../src/utils/quickCapsule";

const PASSAGE =
  "While existing benchmark suites offer comprehensive evaluations across standard vision domains, their reliance on homogeneous distribution assumptions prevents rigorous stress-testing against catastrophic covariate shifts.";

describe("reading actions", function () {
  describe("kinds", function () {
    it("covers exactly the quick-capsule kinds", function () {
      expect([...READING_ACTION_KINDS].sort()).to.deep.equal(
        Object.keys(CAPSULE_ACTIONS).sort(),
      );
    });

    it("recognizes its own kinds and rejects anything else", function () {
      for (const kind of READING_ACTION_KINDS) {
        expect(isReadingActionKind(kind)).to.equal(true);
      }
      expect(isReadingActionKind("summarize")).to.equal(false);
      expect(isReadingActionKind(null)).to.equal(false);
      expect(isReadingActionKind(3)).to.equal(false);
    });
  });

  describe("buildReadingActionPrompt", function () {
    it("returns a non-empty prompt containing the passage for every kind", function () {
      for (const kind of READING_ACTION_KINDS) {
        // A concept card is written for a term, so it gets one rather than the
        // whole passage; every other kind quotes what was selected.
        const selectedText = kind === "concept" ? "covariate shift" : PASSAGE;
        const needle =
          kind === "concept"
            ? "covariate shift"
            : "catastrophic covariate shifts";
        for (const lang of ["en-US", "zh-CN"]) {
          const prompt = buildReadingActionPrompt(kind, {
            selectedText,
            lang,
            paperTitle: "Robust Vision Benchmarks",
          });
          expect(prompt, `${kind}/${lang}`).to.be.a("string").and.not.equal("");
          expect(prompt, `${kind}/${lang}`).to.include(needle);
        }
      }
    });

    it("returns an empty prompt for an empty selection", function () {
      for (const kind of READING_ACTION_KINDS) {
        expect(
          buildReadingActionPrompt(kind, { selectedText: "   " }),
        ).to.equal("");
      }
    });

    it("writes the explain prompt in the panel language and caps its length", function () {
      const english = buildReadingActionPrompt("explain", {
        selectedText: PASSAGE,
        lang: "en-US",
      });
      expect(english).to.include("plain language");
      expect(english).to.include("under 200 words");

      const chinese = buildReadingActionPrompt("explain", {
        selectedText: PASSAGE,
        lang: "zh-CN",
      });
      expect(chinese).to.include("大白话");
      expect(chinese).to.include("300 字以内");
    });

    it("names the paper in the explain prompt only when one is known", function () {
      const withTitle = buildReadingActionPrompt("explain", {
        selectedText: PASSAGE,
        lang: "en-US",
        paperTitle: "Robust Vision Benchmarks",
      });
      expect(withTitle).to.include("Robust Vision Benchmarks");

      const withoutTitle = buildReadingActionPrompt("explain", {
        selectedText: PASSAGE,
        lang: "en-US",
      });
      expect(withoutTitle).to.not.include("From the paper");
    });

    it("treats anything but zh as English", function () {
      for (const lang of ["", "en", "ja-JP", "fr-FR", undefined]) {
        const prompt = buildReadingActionPrompt("explain", {
          selectedText: PASSAGE,
          lang,
        });
        expect(prompt, String(lang)).to.include("plain language");
      }
      expect(
        buildReadingActionPrompt("explain", {
          selectedText: PASSAGE,
          lang: "zh-TW",
        }),
      ).to.include("大白话");
    });

    it("sends the equation as the subject and the sentence as context", function () {
      const selection =
        "we minimize the objective $\\mathcal{L} = \\sum_i \\|x_i - \\hat{x}_i\\|^2$ over the batch";
      const prompt = buildReadingActionPrompt("formula", {
        selectedText: selection,
        lang: "en-US",
      });
      expect(prompt).to.include("\\mathcal{L}");
      expect(prompt).to.include("Surrounding Context");
      expect(prompt).to.include("over the batch");
    });

    it("does not add a context block when the selection is only the formula", function () {
      const prompt = buildReadingActionPrompt("formula", {
        selectedText: "E = mc^2",
        lang: "en-US",
      });
      expect(prompt).to.include("E = mc^2");
      expect(prompt).to.not.include("Surrounding Context");
    });

    it("routes an algorithm block through the walkthrough builder", function () {
      const selection =
        "Algorithm 1: Policy Gradient\nInput: learning rate alpha\nfor each step do\n  update policy\nreturn policy";
      const prompt = buildReadingActionPrompt("algorithm", {
        selectedText: selection,
        lang: "en-US",
      });
      expect(prompt).to.include("Algorithm Walkthrough");
      expect(prompt).to.include("update policy");
    });

    it("names the passage rather than a paper when no title is known", function () {
      const prompt = buildReadingActionPrompt("review", {
        selectedText: PASSAGE,
        lang: "en-US",
      });
      expect(prompt).to.include("Critical Peer Review");
      const chinese = buildReadingActionPrompt("review", {
        selectedText: PASSAGE,
        lang: "zh-CN",
      });
      expect(chinese).to.include("选中片段");
    });

    it("uses the configured target language for the translate fallback", function () {
      const prompt = buildReadingActionPrompt("translate", {
        selectedText: PASSAGE,
        lang: "en-US",
        targetLanguage: "Japanese",
      });
      expect(prompt).to.include("into Japanese");
      const fallback = buildReadingActionPrompt("translate", {
        selectedText: PASSAGE,
        lang: "zh-CN",
      });
      expect(fallback).to.include("简体中文");
    });

    it("declines a concept card for a passage that is not a term", function () {
      const longPassage = `${PASSAGE} ${PASSAGE} ${PASSAGE}`;
      const prompt = buildReadingActionPrompt("concept" as ReadingActionKind, {
        selectedText: longPassage,
        lang: "en-US",
      });
      expect(prompt).to.equal("");
    });

    it("builds a concept card prompt for a short term", function () {
      const prompt = buildReadingActionPrompt("concept", {
        selectedText: "covariate shift",
        lang: "en-US",
      });
      expect(prompt).to.include("covariate shift");
      expect(prompt).to.include("concept card");
    });
  });
});
