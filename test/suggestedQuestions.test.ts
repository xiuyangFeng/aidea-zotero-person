import { assert } from "chai";
import { readFileSync } from "node:fs";

import {
  SUGGESTED_QUESTIONS_MARKER,
  SUGGESTED_QUESTIONS_MAX,
  SUGGESTED_QUESTION_MAX_CHARS,
  SUGGESTED_QUESTIONS_PREF_KEY,
  buildSuggestedQuestionsInstruction,
  isSuggestedQuestionsEnabled,
  parseSuggestedQuestions,
  resolveSuggestedQuestionsLang,
  splitSuggestedQuestions,
  stripStreamingSuggestedQuestions,
  stripSuggestedQuestions,
} from "../src/utils/suggestedQuestions";
import {
  PAPER_BRIEFING_QUESTIONS_PLACEHOLDER,
  buildPaperBriefingPrompt,
} from "../src/utils/autoBriefing";

/** A briefing body that must survive stripping character for character. */
const BODY = [
  "# Paper Briefing",
  "",
  "## TL;DR",
  "The authors train a retriever on synthetic pairs [p.3].",
  "",
  "## Method",
  "- Two-stage: retrieve, then rerank",
  "- Trained on 1.2M pairs",
].join("\n");

const withBlock = (...lines: string[]) =>
  [BODY, "", SUGGESTED_QUESTIONS_MARKER, ...lines].join("\n");

/** A briefing template that still reserves the question slot. */
const TEMPLATE = [
  "Write a briefing.",
  "",
  "## TL;DR",
  "",
  PAPER_BRIEFING_QUESTIONS_PLACEHOLDER,
].join("\n");

describe("suggested questions", function () {
  describe("marker", function () {
    it("is a line Markdown renders as ordinary text", function () {
      // A setext heading needs a line of nothing but "="; letters in the
      // middle keep this a paragraph, so an unstripped marker degrades to
      // visible text rather than to a giant heading.
      assert.equal(SUGGESTED_QUESTIONS_MARKER, "===QUESTIONS===");
      assert.notMatch(SUGGESTED_QUESTIONS_MARKER, /^=+$/);
      assert.equal(SUGGESTED_QUESTIONS_PREF_KEY, "suggestedQuestions.enabled");
    });
  });

  describe("parsing", function () {
    it("splits a well-formed answer into body and questions", function () {
      const split = splitSuggestedQuestions(
        withBlock(
          "Why train the retriever on synthetic pairs?",
          "How far does the 1.2M figure generalize?",
          "What does reranking add over retrieval alone?",
        ),
      );
      assert.equal(split.body, BODY);
      assert.deepEqual(split.questions, [
        "Why train the retriever on synthetic pairs?",
        "How far does the 1.2M figure generalize?",
        "What does reranking add over retrieval alone?",
      ]);
    });

    it("leaves an answer without a block completely untouched", function () {
      const answer = `${BODY}\n\nOne more paragraph.\n`;
      const split = splitSuggestedQuestions(answer);
      assert.equal(split.body, answer);
      assert.deepEqual(split.questions, []);
    });

    it("never mistakes a setext heading or an equation for the marker", function () {
      const answer = [
        "Results",
        "=======",
        "",
        "We observe that `a === b` holds, and that x = 1.",
        "",
        "== Not a marker ==",
      ].join("\n");
      const split = splitSuggestedQuestions(answer);
      assert.equal(split.body, answer);
      assert.deepEqual(split.questions, []);
    });

    it("returns no questions for input that is not a string", function () {
      for (const value of [null, undefined, 42, {}, []]) {
        const split = splitSuggestedQuestions(value);
        assert.equal(split.body, "");
        assert.deepEqual(split.questions, []);
      }
    });

    it("still removes a block that carries nothing usable", function () {
      // Malformed is not the same as absent: the marker must disappear from
      // the body either way, or the reader sees the raw token.
      for (const tail of [
        [] as string[],
        ["", "   ", ""],
        ["```", "```"],
        ["-"],
      ]) {
        const split = splitSuggestedQuestions(withBlock(...tail));
        assert.equal(split.body, BODY);
        assert.deepEqual(split.questions, []);
      }
    });

    it("skips blank lines between questions", function () {
      const split = splitSuggestedQuestions(
        withBlock("First question?", "", "  ", "Second question?", ""),
      );
      assert.deepEqual(split.questions, [
        "First question?",
        "Second question?",
      ]);
    });

    it("caps the block at five questions", function () {
      const split = splitSuggestedQuestions(
        withBlock(
          "Question one?",
          "Question two?",
          "Question three?",
          "Question four?",
          "Question five?",
          "Question six?",
          "Question seven?",
        ),
      );
      assert.equal(split.questions.length, SUGGESTED_QUESTIONS_MAX);
      assert.deepEqual(split.questions, [
        "Question one?",
        "Question two?",
        "Question three?",
        "Question four?",
        "Question five?",
      ]);
    });

    it("strips the bullets, numbering, labels and quotes it asked models to omit", function () {
      const split = splitSuggestedQuestions(
        withBlock(
          "- Bulleted question?",
          "2. Numbered question?",
          "**Bold question?**",
          '"Quoted question?"',
          "Q: Labelled question?",
        ),
      );
      assert.deepEqual(split.questions, [
        "Bulleted question?",
        "Numbered question?",
        "Bold question?",
        "Quoted question?",
        "Labelled question?",
      ]);
    });

    it("handles Chinese punctuation and full-width numbering", function () {
      const split = splitSuggestedQuestions(
        withBlock(
          "1、合成数据为什么够用？",
          "（2）1.2M 这个数字怎么来的？",
          "「重排序带来了什么？」",
        ),
      );
      assert.deepEqual(split.questions, [
        "合成数据为什么够用？",
        "1.2M 这个数字怎么来的？",
        "重排序带来了什么？",
      ]);
    });

    it("drops duplicates so one question never fills the row", function () {
      const split = splitSuggestedQuestions(
        withBlock(
          "Why synthetic pairs?",
          "why synthetic pairs?",
          "- Why synthetic pairs?",
          "What about recall?",
        ),
      );
      assert.deepEqual(split.questions, [
        "Why synthetic pairs?",
        "What about recall?",
      ]);
    });

    it("drops prose a model kept writing instead of stopping", function () {
      const prose = `A${"b".repeat(SUGGESTED_QUESTION_MAX_CHARS)}`;
      const split = splitSuggestedQuestions(
        withBlock("A real question?", prose, "Another real question?"),
      );
      assert.deepEqual(split.questions, [
        "A real question?",
        "Another real question?",
      ]);
    });

    it("accepts the ways a model decorates the marker line", function () {
      for (const marker of [
        "===QUESTIONS===",
        "  ===QUESTIONS===  ",
        "=== QUESTIONS ===",
        "=====QUESTIONS=====",
        "===questions===",
        "**===QUESTIONS===**",
        "## ===QUESTIONS===",
      ]) {
        const split = splitSuggestedQuestions(
          [BODY, "", marker, "Does this parse?"].join("\n"),
        );
        assert.equal(split.body, BODY, marker);
        assert.deepEqual(split.questions, ["Does this parse?"], marker);
      }
    });

    it("treats a repeated marker as a closing fence, not a question", function () {
      const split = splitSuggestedQuestions(
        withBlock("Only question?", SUGGESTED_QUESTIONS_MARKER),
      );
      assert.deepEqual(split.questions, ["Only question?"]);
    });

    it("exposes the same result through the convenience helpers", function () {
      const answer = withBlock("Sole question?");
      assert.equal(stripSuggestedQuestions(answer), BODY);
      assert.deepEqual(parseSuggestedQuestions(answer), ["Sole question?"]);
      assert.equal(stripSuggestedQuestions(BODY), BODY);
      assert.deepEqual(parseSuggestedQuestions(BODY), []);
    });
  });

  describe("streaming", function () {
    it("hides the marker line while it is still arriving", function () {
      for (const partial of [
        "=",
        "==",
        "===",
        "===Q",
        "===QUEST",
        "===QUESTIONS",
        "===QUESTIONS==",
      ]) {
        assert.equal(
          stripStreamingSuggestedQuestions(`${BODY}\n\n${partial}`),
          BODY,
          partial,
        );
      }
    });

    it("hides the finished block and its questions too", function () {
      assert.equal(
        stripStreamingSuggestedQuestions(withBlock("Why?", "How")),
        BODY,
      );
    });

    it("leaves ordinary trailing text alone", function () {
      for (const tail of ["Still writing", "x = 1", "== Not a marker", ""]) {
        const streamed = `${BODY}\n${tail}`;
        assert.equal(
          stripStreamingSuggestedQuestions(streamed),
          streamed,
          tail,
        );
      }
    });

    it("returns nothing when the partial marker is the whole message", function () {
      assert.equal(stripStreamingSuggestedQuestions("==="), "");
      assert.equal(stripStreamingSuggestedQuestions(""), "");
    });
  });

  describe("instruction", function () {
    it("names the exact marker it wants back", function () {
      for (const lang of ["en-US", "zh-CN"] as const) {
        const instruction = buildSuggestedQuestionsInstruction(lang);
        assert.include(instruction, SUGGESTED_QUESTIONS_MARKER);
        assert.include(instruction, "25");
      }
    });

    it("round-trips: an answer built to the instruction parses back", function () {
      const instruction = buildSuggestedQuestionsInstruction("en-US");
      assert.include(instruction, "one per line");
      const answer = withBlock("Q one?", "Q two?", "Q three?");
      assert.equal(splitSuggestedQuestions(answer).questions.length, 3);
    });

    it("falls back to English outside the two translated locales", function () {
      assert.equal(resolveSuggestedQuestionsLang("zh-TW"), "zh-CN");
      assert.equal(resolveSuggestedQuestionsLang("ja-JP"), "en-US");
      assert.equal(resolveSuggestedQuestionsLang(""), "en-US");
      assert.equal(resolveSuggestedQuestionsLang(undefined), "en-US");
    });
  });

  describe("preference", function () {
    let previous: unknown;

    beforeEach(function () {
      previous = (globalThis as any).Zotero;
    });

    afterEach(function () {
      (globalThis as any).Zotero = previous;
    });

    it("defaults to enabled without a Zotero runtime", function () {
      delete (globalThis as any).Zotero;
      assert.isTrue(isSuggestedQuestionsEnabled());
    });

    it("reads the stored value, however it was written", function () {
      for (const [stored, expected] of [
        [true, true],
        [false, false],
        ["false", false],
        ["0", false],
        ["true", true],
        ["", true],
        [undefined, true],
      ] as const) {
        (globalThis as any).Zotero = {
          Prefs: {
            get(key: string) {
              return key.endsWith(SUGGESTED_QUESTIONS_PREF_KEY)
                ? stored
                : undefined;
            },
          },
        };
        assert.equal(isSuggestedQuestionsEnabled(), expected, String(stored));
      }
    });

    it("falls back to enabled when reading the preference throws", function () {
      (globalThis as any).Zotero = {
        Prefs: {
          get() {
            throw new Error("prefs unavailable");
          },
        },
      };
      assert.isTrue(isSuggestedQuestionsEnabled());
    });
  });

  describe("briefing prompt assembly", function () {
    it("fills the template's slot with the question instruction", function () {
      const prompt = buildPaperBriefingPrompt({
        builtinTemplate: TEMPLATE,
        lang: "en-US",
      });
      assert.notInclude(prompt, PAPER_BRIEFING_QUESTIONS_PLACEHOLDER);
      assert.include(prompt, SUGGESTED_QUESTIONS_MARKER);
      assert.include(prompt, "## TL;DR");
    });

    it("empties the slot when the preference is off", function () {
      const prompt = buildPaperBriefingPrompt({
        builtinTemplate: TEMPLATE,
        lang: "en-US",
        suggestedQuestions: false,
      });
      assert.notInclude(prompt, PAPER_BRIEFING_QUESTIONS_PLACEHOLDER);
      assert.notInclude(prompt, SUGGESTED_QUESTIONS_MARKER);
      assert.notInclude(prompt, "QUESTIONS");
      assert.include(prompt, "## TL;DR");
      // Removing the slot must not leave the blank lines that framed it.
      assert.notMatch(prompt, /\n{3,}/);
    });

    it("appends the instruction when a template lost its slot", function () {
      const prompt = buildPaperBriefingPrompt({
        builtinTemplate: "Write a briefing.\n\n## TL;DR",
        lang: "en-US",
      });
      assert.include(prompt, SUGGESTED_QUESTIONS_MARKER);
      const withoutQuestions = buildPaperBriefingPrompt({
        builtinTemplate: "Write a briefing.\n\n## TL;DR",
        lang: "en-US",
        suggestedQuestions: false,
      });
      assert.notInclude(withoutQuestions, SUGGESTED_QUESTIONS_MARKER);
    });

    it("asks in the panel's language", function () {
      const zh = buildPaperBriefingPrompt({
        builtinTemplate: TEMPLATE,
        lang: "zh-CN",
      });
      assert.include(zh, "追问区块");
      const en = buildPaperBriefingPrompt({
        builtinTemplate: TEMPLATE,
        lang: "en-US",
      });
      assert.include(en, "follow-up block");
    });

    it("still refuses to send bare rules when the template is missing", function () {
      assert.equal(
        buildPaperBriefingPrompt({ builtinTemplate: "", lang: "en-US" }),
        "",
      );
    });
  });

  describe("bundled templates", function () {
    const read = (path: string) =>
      readFileSync(new URL(path, import.meta.url), "utf8");

    it("reserve the question slot in both languages", function () {
      for (const path of [
        "../addon/content/shortcuts/paper-briefing.txt",
        "../addon/content/shortcuts/zh-CN/paper-briefing.txt",
      ]) {
        assert.include(read(path), PAPER_BRIEFING_QUESTIONS_PLACEHOLDER, path);
      }
    });

    it("produce a prompt whose block a parser can read back", function () {
      for (const [lang, path] of [
        ["en-US", "../addon/content/shortcuts/paper-briefing.txt"],
        ["zh-CN", "../addon/content/shortcuts/zh-CN/paper-briefing.txt"],
      ] as const) {
        const prompt = buildPaperBriefingPrompt({
          builtinTemplate: read(path),
          lang,
        });
        assert.include(prompt, SUGGESTED_QUESTIONS_MARKER);
        assert.notInclude(prompt, PAPER_BRIEFING_QUESTIONS_PLACEHOLDER);
      }
    });
  });
});
