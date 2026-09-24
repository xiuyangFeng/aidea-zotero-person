import { expect } from "chai";
import {
  buildSynthesisMatrixPrompt,
  buildSynthesisMatrixAttachedDocumentsNotice,
  buildSynthesisMatrixTitleRule,
  buildSynthesisPaperInput,
  dedupeSynthesisPaperInputs,
  extractSynthesisYear,
  formatSynthesisAuthors,
  isSynthesisMatrixText,
  parseSynthesisMatrix,
  formatSynthesisMatrixNote,
  DEFAULT_SYNTHESIS_DIMENSIONS,
  SYNTHESIS_KEY_TEXT_SAMPLE_MAX_CHARS,
  SYNTHESIS_MATRIX_MIN_PAPERS,
  SYNTHESIS_MATRIX_NOTE_TAG,
  SYNTHESIS_MATRIX_TITLE,
  type SynthesisPaperInput,
} from "../src/utils/synthesisMatrix";

describe("synthesis matrix", function () {
  const samplePapers: SynthesisPaperInput[] = [
    {
      title: "Attention Is All You Need",
      authors: "Vaswani et al.",
      year: 2017,
      abstract:
        "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks...",
      keyTextSample:
        "We propose the Transformer, a model architecture eschewing recurrence and instead relying entirely on an attention mechanism...",
    },
    {
      title: "BERT: Pre-training of Deep Bidirectional Transformers",
      authors: "Devlin et al.",
      year: 2018,
      abstract:
        "We introduce a new language representation model called BERT...",
      keyTextSample:
        "BERT is designed to pre-train deep bidirectional representations from unlabeled text...",
    },
  ];

  it("should have constant tag", function () {
    expect(SYNTHESIS_MATRIX_NOTE_TAG).to.equal("aidea-synthesis-matrix");
  });

  it("builds prompt in English with default dimensions", function () {
    const prompt = buildSynthesisMatrixPrompt({
      papers: samplePapers,
      lang: "en-US",
      focusTopic: "Transformer architectures",
    });

    expect(prompt).to.include("Literature Synthesis Matrix");
    expect(prompt).to.include("Transformer architectures");
    expect(prompt).to.include("Attention Is All You Need");
    expect(prompt).to.include("BERT: Pre-training");
    expect(prompt).to.include(DEFAULT_SYNTHESIS_DIMENSIONS["en-US"][0]);
  });

  it("builds prompt in Chinese with custom dimensions", function () {
    const prompt = buildSynthesisMatrixPrompt({
      papers: samplePapers,
      lang: "zh-CN",
      customDimensions: ["研究问题", "核心创新", "消融实验结果"],
      focusTopic: "模型自注意力机制",
    });

    expect(prompt).to.include("文献横向对比矩阵");
    expect(prompt).to.include("模型自注意力机制");
    expect(prompt).to.include("消融实验结果");
  });

  it("parses markdown table and synthesis insights correctly", function () {
    const markdownResponse = `
Here is the comparison table:

| Dimension | Paper 1 (Transformer) | Paper 2 (BERT) |
| --- | --- | --- |
| Motivation | Replace RNN/CNN with pure attention | Bidirectional pre-training for NLP |
| Architecture | Encoder-Decoder with multi-head attention | Encoder-only masked language model |

### Synthesis & Key Insights
The Transformer revolutionized NLP sequence modeling, while BERT extended it to bidirectional contextual pre-training.
`;

    const parsed = parseSynthesisMatrix(markdownResponse);
    expect(parsed.headers).to.deep.equal([
      "Dimension",
      "Paper 1 (Transformer)",
      "Paper 2 (BERT)",
    ]);
    expect(parsed.rows.length).to.equal(2);
    expect(parsed.rows[0]).to.deep.equal([
      "Motivation",
      "Replace RNN/CNN with pure attention",
      "Bidirectional pre-training for NLP",
    ]);
    expect(parsed.insightsMarkdown).to.include(
      "The Transformer revolutionized NLP",
    );
  });

  it("formats synthesis matrix as a note", function () {
    const parsed = {
      headers: ["Dimension", "Paper A", "Paper B"],
      rows: [["Method", "Method A", "Method B"]],
      insightsMarkdown: "### Key Insights\nBoth are effective.",
    };

    const note = formatSynthesisMatrixNote(parsed, {
      title: "My Synthesis",
      focusTopic: "Attention Models",
      papers: samplePapers,
    });

    expect(note).to.include("# My Synthesis");
    expect(note).to.include("> **Topic**: Attention Models");
    expect(note).to.include(
      "1. **Attention Is All You Need** (Vaswani et al., 2017)",
    );
    expect(note).to.include("| Dimension | Paper A | Paper B |");
    expect(note).to.include("| Method | Method A | Method B |");
    expect(note).to.include("### Key Insights");
  });

  describe("answer title", function () {
    it("recognizes a matrix by its first line", function () {
      expect(
        isSynthesisMatrixText("# Literature Synthesis Matrix\n| a |"),
      ).to.equal(true);
      expect(isSynthesisMatrixText("# 文献横向对比矩阵")).to.equal(true);
      expect(isSynthesisMatrixText("# Reading Card")).to.equal(false);
    });

    it("asks for the title the recognizer looks for", function () {
      for (const lang of ["en-US", "zh-CN"] as const) {
        const rule = buildSynthesisMatrixTitleRule(lang);
        expect(rule).to.include(`# ${SYNTHESIS_MATRIX_TITLE[lang]}`);
        expect(
          isSynthesisMatrixText(`# ${SYNTHESIS_MATRIX_TITLE[lang]}`),
        ).to.equal(true);
      }
    });

    it("tells the model the papers ride along as attached context", function () {
      expect(buildSynthesisMatrixAttachedDocumentsNotice("en-US")).to.include(
        "supplemental document context",
      );
      expect(buildSynthesisMatrixAttachedDocumentsNotice("zh-CN")).to.include(
        "附加文档上下文",
      );
    });

    it("needs at least two papers", function () {
      expect(SYNTHESIS_MATRIX_MIN_PAPERS).to.equal(2);
    });
  });

  describe("paper input assembly", function () {
    it("formats one, two and three authors like a citation", function () {
      expect(formatSynthesisAuthors(["Vaswani"])).to.equal("Vaswani");
      expect(formatSynthesisAuthors(["Vaswani", "Shazeer"])).to.equal(
        "Vaswani & Shazeer",
      );
      expect(formatSynthesisAuthors(["A", "B", "C"])).to.equal("A, B & C");
    });

    it("collapses a longer author list", function () {
      expect(formatSynthesisAuthors(["A", "B", "C", "D", "E"])).to.equal(
        "A, B, C et al.",
      );
    });

    it("ignores blank and missing creator names", function () {
      expect(formatSynthesisAuthors([" ", null, "A", undefined])).to.equal("A");
      expect(formatSynthesisAuthors(null)).to.equal("");
      expect(formatSynthesisAuthors([])).to.equal("");
    });

    it("takes the year out of a Zotero date field", function () {
      expect(extractSynthesisYear("2017-06-12")).to.equal("2017");
      expect(extractSynthesisYear("June 2018")).to.equal("2018");
      expect(extractSynthesisYear("n.d.")).to.equal("");
      expect(extractSynthesisYear(undefined)).to.equal("");
    });

    it("builds an input from raw item fields", function () {
      const input = buildSynthesisPaperInput({
        id: 42,
        title: "  Attention Is  All You Need ",
        creators: ["Vaswani", "Shazeer"],
        date: "2017-06-12",
        abstract: "  An abstract.  ",
        keyTextSample: " A key excerpt. ",
      });
      expect(input).to.deep.equal({
        id: 42,
        title: "Attention Is All You Need",
        authors: "Vaswani & Shazeer",
        year: "2017",
        abstract: "An abstract.",
        keyTextSample: "A key excerpt.",
      });
    });

    it("omits every field it has nothing for", function () {
      expect(buildSynthesisPaperInput({ title: "Only a title" })).to.deep.equal(
        {
          title: "Only a title",
        },
      );
    });

    it("refuses a paper with no title", function () {
      expect(buildSynthesisPaperInput({ title: "   ", id: 7 })).to.equal(null);
      expect(buildSynthesisPaperInput({})).to.equal(null);
    });

    it("clamps a long key excerpt", function () {
      const input = buildSynthesisPaperInput({
        title: "T",
        keyTextSample: "x".repeat(SYNTHESIS_KEY_TEXT_SAMPLE_MAX_CHARS + 500),
      });
      expect(input?.keyTextSample).to.have.length(
        SYNTHESIS_KEY_TEXT_SAMPLE_MAX_CHARS,
      );
    });

    it("drops repeats by id and then by title", function () {
      const deduped = dedupeSynthesisPaperInputs([
        { id: 1, title: "Alpha" },
        { id: 1, title: "Alpha (again)" },
        { title: "  ALPHA  " },
        { id: 2, title: "Beta" },
      ]);
      expect(deduped.map((paper) => paper.title)).to.deep.equal([
        "Alpha",
        "Beta",
      ]);
    });

    it("skips untitled entries while deduping", function () {
      expect(
        dedupeSynthesisPaperInputs([{ title: "" }, { title: "Gamma" }]),
      ).to.deep.equal([{ title: "Gamma" }]);
    });
  });
});
