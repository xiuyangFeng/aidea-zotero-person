import { expect } from "chai";
import {
  buildHighlightDigestPrompt,
  buildHighlightDigestTitleRule,
  isHighlightDigestText,
  sortAndGroupAnnotations,
  formatAnnotationsForPrompt,
  toHighlightAnnotations,
  HIGHLIGHT_DIGEST_NOTE_TAG,
  HIGHLIGHT_DIGEST_TITLE,
  type HighlightAnnotation,
} from "../src/utils/highlightDigest";

describe("highlight digest", function () {
  const sampleAnnotations: HighlightAnnotation[] = [
    {
      text: "Our method achieves 85% accuracy.",
      comment: "How does this compare to Baseline X?",
      page: 6,
      color: "yellow",
    },
    {
      text: "We introduce a novel self-attention variant.",
      page: 2,
      color: "green",
    },
  ];

  it("has correct note tag", function () {
    expect(HIGHLIGHT_DIGEST_NOTE_TAG).to.equal("aidea-highlight-digest");
  });

  it("sorts annotations by page number", function () {
    const sorted = sortAndGroupAnnotations(sampleAnnotations);
    expect(sorted[0].page).to.equal(2);
    expect(sorted[1].page).to.equal(6);
  });

  it("formats annotations for prompt correctly", function () {
    const formatted = formatAnnotationsForPrompt(sampleAnnotations);
    expect(formatted).to.include("[p.2]");
    expect(formatted).to.include("[p.6]");
    expect(formatted).to.include("How does this compare to Baseline X?");
  });

  it("builds prompt in English and Chinese", function () {
    const promptEn = buildHighlightDigestPrompt({
      paperTitle: "Transformer Models",
      annotations: sampleAnnotations,
      lang: "en-US",
    });
    expect(promptEn).to.include("Personalized Reading Digest");
    expect(promptEn).to.include("Transformer Models");

    const promptZh = buildHighlightDigestPrompt({
      paperTitle: "注意力机制",
      annotations: sampleAnnotations,
      lang: "zh-CN",
    });
    expect(promptZh).to.include("读者专属精读笔记合辑");
    expect(promptZh).to.include("注意力机制");
  });

  describe("answer title", function () {
    it("recognizes a digest by its first line", function () {
      expect(isHighlightDigestText("# Highlight Digest\n\nBody")).to.equal(
        true,
      );
      expect(isHighlightDigestText("# 标注精读合辑\n\n正文")).to.equal(true);
      expect(isHighlightDigestText("# Reading Card")).to.equal(false);
    });

    it("asks for the title the recognizer looks for", function () {
      for (const lang of ["en-US", "zh-CN"] as const) {
        const rule = buildHighlightDigestTitleRule(lang);
        expect(rule).to.include(`# ${HIGHLIGHT_DIGEST_TITLE[lang]}`);
        expect(
          isHighlightDigestText(`# ${HIGHLIGHT_DIGEST_TITLE[lang]}`),
        ).to.equal(true);
      }
    });
  });

  describe("toHighlightAnnotations", function () {
    it("maps a Zotero annotation record onto digest input", function () {
      expect(
        toHighlightAnnotations([
          {
            type: "highlight",
            text: " Marked passage. ",
            comment: " My question? ",
            pageLabel: "7",
            pageIndex: 9,
            color: "#ffd400",
          },
        ]),
      ).to.deep.equal([
        {
          text: "Marked passage.",
          comment: "My question?",
          color: "#ffd400",
          page: 7,
          type: "highlight",
        },
      ]);
    });

    it("falls back to the physical page when the label is not a number", function () {
      const [mapped] = toHighlightAnnotations([
        { type: "note", text: "x", pageLabel: "iv", pageIndex: 3 },
      ]);
      expect(mapped.page).to.equal(4);
    });

    it("leaves the page out when there is none", function () {
      const [mapped] = toHighlightAnnotations([
        { type: "underline", text: "x", pageLabel: "", pageIndex: null },
      ]);
      expect(mapped).to.deep.equal({ text: "x", type: "underline" });
    });

    it("keeps a standalone comment with no marked passage", function () {
      expect(
        toHighlightAnnotations([{ type: "note", text: "", comment: "Idea" }]),
      ).to.deep.equal([{ text: "", comment: "Idea", type: "note" }]);
    });

    it("drops records with neither passage nor comment", function () {
      expect(
        toHighlightAnnotations([
          { type: "highlight", text: "   ", comment: "" },
          null as never,
        ]),
      ).to.deep.equal([]);
      expect(toHighlightAnnotations(null)).to.deep.equal([]);
    });

    it("ignores an annotation type the digest does not model", function () {
      const [mapped] = toHighlightAnnotations([{ type: "image", text: "x" }]);
      expect(mapped).to.deep.equal({ text: "x" });
    });
  });
});
