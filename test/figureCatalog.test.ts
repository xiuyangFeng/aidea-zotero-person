import { assert } from "chai";

import {
  FIGURE_CATALOG_MAX_CAPTION_LENGTH,
  buildFigureExplainPrompt,
  extractFigureCatalog,
  resolveFigureExplainLang,
  type FigureCatalogEntry,
} from "../src/utils/figureCatalog";

function labels(entries: FigureCatalogEntry[]): string[] {
  return entries.map((entry) => entry.label);
}

function find(
  entries: FigureCatalogEntry[],
  label: string,
): FigureCatalogEntry {
  const entry = entries.find((candidate) => candidate.label === label);
  assert.isDefined(entry, `missing ${label}`);
  return entry as FigureCatalogEntry;
}

describe("figure catalog", function () {
  describe("caption extraction", function () {
    it("reads English figure and table captions with their pages", function () {
      const entries = extractFigureCatalog(
        [
          "[page 1]",
          "Introduction",
          "We study contrastive pretraining.",
          "",
          "[page 3]",
          "Figure 1: Overview of the proposed architecture.",
          "",
          "Table 2: Accuracy on ImageNet and CIFAR-10.",
        ].join("\n"),
      );

      assert.deepEqual(labels(entries), ["Figure 1", "Table 2"]);
      assert.deepEqual(entries[0], {
        kind: "figure",
        label: "Figure 1",
        caption: "Overview of the proposed architecture.",
        page: 3,
      });
      assert.deepEqual(entries[1], {
        kind: "table",
        label: "Table 2",
        caption: "Accuracy on ImageNet and CIFAR-10.",
        page: 3,
      });
    });

    it("accepts the Fig./FIGURE/Tab. spellings and separator variants", function () {
      const entries = extractFigureCatalog(
        [
          "[page 2]",
          "Fig. 1. Training curves for every seed.",
          "",
          "FIGURE 2 — Ablation of the projection head.",
          "",
          "Tab. 3 | Hyperparameters used in all runs.",
          "",
          "Figure 4 Latency measured on one A100.",
        ].join("\n"),
      );

      assert.deepEqual(labels(entries), [
        "Figure 1",
        "Figure 2",
        "Figure 4",
        "Table 3",
      ]);
      assert.equal(
        find(entries, "Figure 1").caption,
        "Training curves for every seed.",
      );
      assert.equal(
        find(entries, "Figure 2").caption,
        "Ablation of the projection head.",
      );
      assert.equal(
        find(entries, "Table 3").caption,
        "Hyperparameters used in all runs.",
      );
      assert.equal(
        find(entries, "Figure 4").caption,
        "Latency measured on one A100.",
      );
    });

    it("keeps compound and supplemental numbers", function () {
      const entries = extractFigureCatalog(
        [
          "[page 9]",
          "Figure 3.1: Encoder block in detail.",
          "",
          "Figure S2: Additional qualitative samples.",
          "",
          "Table A1: Dataset statistics.",
        ].join("\n"),
      );

      assert.deepEqual(labels(entries), [
        "Figure 3.1",
        "Figure S2",
        "Table A1",
      ]);
    });

    it("normalizes a lower-case supplemental prefix onto one label", function () {
      const entries = extractFigureCatalog(
        [
          "[page 4]",
          "fig. s2: Extra ablations on the decoder.",
          "",
          "Figure S2: Extra ablations on the decoder, full grid.",
        ].join("\n"),
      );

      assert.deepEqual(labels(entries), ["Figure S2"]);
      assert.equal(
        find(entries, "Figure S2").caption,
        "Extra ablations on the decoder, full grid.",
      );
    });

    it("reads Chinese figure and table captions", function () {
      const entries = extractFigureCatalog(
        [
          "[page 5]",
          "图 1 本文方法的整体框架。",
          "",
          "表 2：不同数据集上的准确率对比",
          "",
          "圖 3 消融实验结果",
        ].join("\n"),
      );

      assert.deepEqual(labels(entries), ["图 1", "圖 3", "表 2"]);
      assert.equal(find(entries, "图 1").kind, "figure");
      assert.equal(find(entries, "表 2").kind, "table");
      assert.equal(find(entries, "表 2").caption, "不同数据集上的准确率对比");
    });

    it("ignores a Chinese in-text reference that has no separator", function () {
      const entries = extractFigureCatalog(
        ["[page 2]", "图1所示为整体流程，其中编码器负责提取特征。"].join("\n"),
      );

      assert.deepEqual(entries, []);
    });

    it("joins a caption that wraps across lines", function () {
      const entries = extractFigureCatalog(
        [
          "[page 7]",
          "Figure 5: Comparison of the proposed sampler against three",
          "baselines on long-horizon planning tasks, averaged over",
          "five seeds.",
          "",
          "The remaining sections discuss limitations.",
        ].join("\n"),
      );

      assert.equal(
        find(entries, "Figure 5").caption,
        "Comparison of the proposed sampler against three baselines on " +
          "long-horizon planning tasks, averaged over five seeds.",
      );
    });

    it("rejoins a word hyphenated across a line break", function () {
      const entries = extractFigureCatalog(
        ["[page 3]", "Figure 2: The encoder archi-", "tecture in detail."].join(
          "\n",
        ),
      );

      assert.equal(
        find(entries, "Figure 2").caption,
        "The encoder architecture in detail.",
      );
    });

    it("stops the caption at the next sentence of body text", function () {
      const entries = extractFigureCatalog(
        [
          "[page 4]",
          "Figure 1: Overview of the pipeline.",
          "We first tokenize the input and then apply the encoder.",
        ].join("\n"),
      );

      assert.equal(
        find(entries, "Figure 1").caption,
        "Overview of the pipeline.",
      );
    });

    it("stops the caption at the next figure marker", function () {
      const entries = extractFigureCatalog(
        [
          "[page 6]",
          "Figure 1: Overview of the pipeline",
          "Figure 2: Detail of the decoder",
        ].join("\n"),
      );

      assert.deepEqual(labels(entries), ["Figure 1", "Figure 2"]);
      assert.equal(
        find(entries, "Figure 1").caption,
        "Overview of the pipeline",
      );
    });

    it("caps a runaway caption at the length limit", function () {
      const filler = "lorem ipsum dolor sit amet consectetur ";
      const entries = extractFigureCatalog(
        ["[page 2]", `Figure 1: ${filler.repeat(40)}`].join("\n"),
      );

      const caption = find(entries, "Figure 1").caption;
      assert.isAtMost(caption.length, FIGURE_CATALOG_MAX_CAPTION_LENGTH);
      assert.isTrue(caption.endsWith("…"));
    });
  });

  describe("deduplication", function () {
    it("prefers the real caption over an in-text reference", function () {
      const entries = extractFigureCatalog(
        [
          "[page 2]",
          "The gains are consistent across every dataset we tried, as we",
          "Figure 3 shows the proposed method outperforming all baselines by a",
          "wide margin on each of the six benchmarks we evaluated.",
          "",
          "[page 5]",
          "Figure 3: Accuracy on six benchmarks.",
        ].join("\n"),
      );

      assert.deepEqual(labels(entries), ["Figure 3"]);
      assert.deepEqual(entries[0], {
        kind: "figure",
        label: "Figure 3",
        caption: "Accuracy on six benchmarks.",
        page: 5,
      });
    });

    it("keeps the longer caption when both look equally caption-like", function () {
      const entries = extractFigureCatalog(
        [
          "[page 1]",
          "Figure 4: Results.",
          "",
          "[page 8]",
          "Figure 4: Results of the ablation across all five components.",
        ].join("\n"),
      );

      assert.deepEqual(labels(entries), ["Figure 4"]);
      assert.equal(
        entries[0].caption,
        "Results of the ablation across all five components.",
      );
      assert.equal(entries[0].page, 8);
    });

    it("merges the Fig./Figure spellings of one figure", function () {
      const entries = extractFigureCatalog(
        [
          "[page 3]",
          "Fig. 7: Loss curves.",
          "",
          "Figure 7: Loss curves for every learning rate we swept.",
        ].join("\n"),
      );

      assert.deepEqual(labels(entries), ["Figure 7"]);
      assert.equal(
        entries[0].caption,
        "Loss curves for every learning rate we swept.",
      );
    });
  });

  describe("ordering", function () {
    it("sorts by page, then numerically by label", function () {
      const entries = extractFigureCatalog(
        [
          "[page 4]",
          "Figure 10: Tenth figure of the paper.",
          "",
          "Figure 9: Ninth figure of the paper.",
          "",
          "Table 1: First table of the paper.",
          "",
          "[page 2]",
          "Figure 1: First figure of the paper.",
        ].join("\n"),
      );

      assert.deepEqual(labels(entries), [
        "Figure 1",
        "Figure 9",
        "Figure 10",
        "Table 1",
      ]);
    });

    it("puts entries without a page last", function () {
      const entries = extractFigureCatalog(
        [
          "Figure 2: Seen before any page marker.",
          "",
          "[page 3]",
          "Figure 1: Seen after the first marker.",
        ].join("\n"),
      );

      assert.deepEqual(labels(entries), ["Figure 1", "Figure 2"]);
      assert.equal(entries[0].page, 3);
      assert.isNull(entries[1].page);
    });
  });

  describe("documents without page markers", function () {
    it("still extracts captions but leaves every page null", function () {
      const entries = extractFigureCatalog(
        [
          "Chapter 2",
          "",
          "Figure 1: A diagram of the reaction pathway.",
          "",
          "Table 1: Reagents and their quantities.",
        ].join("\n"),
      );

      assert.deepEqual(labels(entries), ["Figure 1", "Table 1"]);
      for (const entry of entries) assert.isNull(entry.page);
    });
  });

  describe("malformed input", function () {
    it("returns an empty array instead of throwing", function () {
      assert.deepEqual(extractFigureCatalog(""), []);
      assert.deepEqual(extractFigureCatalog("   \n\n  "), []);
      assert.deepEqual(extractFigureCatalog(null), []);
      assert.deepEqual(extractFigureCatalog(undefined), []);
      assert.deepEqual(extractFigureCatalog(42), []);
      assert.deepEqual(extractFigureCatalog({ text: "Figure 1: x" }), []);
      assert.deepEqual(extractFigureCatalog(" \f\f\f"), []);
    });

    it("ignores prose that merely mentions figures", function () {
      assert.deepEqual(
        extractFigureCatalog(
          [
            "[page 1]",
            "Figures 1 and 2 are discussed later in the text.",
            "See figure captions for details.",
          ].join("\n"),
        ),
        [],
      );
    });

    it("ignores a bare label with no caption text", function () {
      assert.deepEqual(
        extractFigureCatalog(["[page 1]", "Figure 3", ""].join("\n")),
        [],
      );
    });
  });

  describe("explain prompt", function () {
    const entry: FigureCatalogEntry = {
      kind: "figure",
      label: "Figure 3",
      caption: "Accuracy on six benchmarks.",
      page: 5,
    };

    it("resolves the copy language", function () {
      assert.equal(resolveFigureExplainLang("zh-CN"), "zh-CN");
      assert.equal(resolveFigureExplainLang("zh-TW"), "zh-CN");
      assert.equal(resolveFigureExplainLang("ja-JP"), "en-US");
      assert.equal(resolveFigureExplainLang(undefined), "en-US");
    });

    it("names the figure, quotes the caption, and asks for page anchors", function () {
      const prompt = buildFigureExplainPrompt({ entry, lang: "en-US" });
      assert.include(prompt, "Figure 3");
      assert.include(prompt, "Accuracy on six benchmarks.");
      assert.include(prompt, "page 5");
      assert.include(prompt, "[p.N]");
    });

    it("writes Chinese copy for a Chinese panel", function () {
      const prompt = buildFigureExplainPrompt({ entry, lang: "zh-CN" });
      assert.include(prompt, "图注");
      assert.include(prompt, "[p.N]");
      assert.notInclude(prompt, "Caption:");
    });

    it("drops the page rule when the entry has no page", function () {
      const prompt = buildFigureExplainPrompt({
        entry: { ...entry, page: null },
        lang: "en-US",
      });
      assert.notInclude(prompt, "[p.N]");
      assert.include(prompt, "no page markers");
    });

    it("returns an empty string for an unusable entry", function () {
      assert.equal(
        buildFigureExplainPrompt({
          entry: { kind: "figure", label: "", caption: "", page: null },
        }),
        "",
      );
    });
  });
});
