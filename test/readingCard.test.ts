import { assert } from "chai";

import {
  DEFAULT_READING_CARD_FIELDS,
  READING_CARD_FIELDS_PLACEHOLDER,
  READING_CARD_FOCUS_MAX_CHARS,
  READING_CARD_MAX_FIELDS,
  READING_CARD_NOTE_TAG,
  READING_CARD_TITLE,
  buildReadingCardPrompt,
  formatReadingCardFieldsBlock,
  isReadingCardText,
  normalizeReadingCardFocus,
  parseReadingCardFieldList,
  resolveReadingCardLang,
  resolveReadingCardPageCitations,
  resolveReadingCardTemplate,
} from "../src/utils/readingCard";

const BUILTIN = [
  "Write a structured reading card for this document.",
  "",
  READING_CARD_FIELDS_PLACEHOLDER,
  "",
  '- When the document never addresses a heading, write "Not stated".',
].join("\n");

describe("reading card", function () {
  describe("note tag", function () {
    it("is a single language-neutral value", function () {
      assert.equal(READING_CARD_NOTE_TAG, "aidea-reading-card");
      // A localized tag would split one library's cards into two buckets.
      assert.match(READING_CARD_NOTE_TAG, /^[a-z0-9-]+$/);
    });
  });

  describe("language resolution", function () {
    it("maps every Chinese panel locale onto the Simplified copy", function () {
      assert.equal(resolveReadingCardLang("zh-CN"), "zh-CN");
      assert.equal(resolveReadingCardLang("zh-TW"), "zh-CN");
    });

    it("falls back to English for unsupported and missing locales", function () {
      assert.equal(resolveReadingCardLang("ja-JP"), "en-US");
      assert.equal(resolveReadingCardLang(""), "en-US");
      assert.equal(resolveReadingCardLang(undefined), "en-US");
    });
  });

  describe("field list parsing", function () {
    it("accepts Latin and CJK separators", function () {
      assert.deepEqual(parseReadingCardFieldList("Question, Method; Data"), [
        "Question",
        "Method",
        "Data",
      ]);
      assert.deepEqual(parseReadingCardFieldList("研究问题，方法、数据"), [
        "研究问题",
        "方法",
        "数据",
      ]);
    });

    it("strips heading marks pasted out of an existing card", function () {
      assert.deepEqual(parseReadingCardFieldList("## Method, - Data"), [
        "Method",
        "Data",
      ]);
    });

    it("drops blanks and duplicates", function () {
      assert.deepEqual(parseReadingCardFieldList("Method, , method,  Data "), [
        "Method",
        "Data",
      ]);
    });

    it("caps the list so one card cannot become a survey", function () {
      const raw = Array.from({ length: 30 }, (_, i) => `F${i}`).join(",");
      assert.lengthOf(parseReadingCardFieldList(raw), READING_CARD_MAX_FIELDS);
    });

    it("returns nothing for punctuation-only input", function () {
      assert.deepEqual(parseReadingCardFieldList(",,,  ;"), []);
      assert.deepEqual(parseReadingCardFieldList(undefined), []);
    });
  });

  describe("template resolution", function () {
    it("uses the built-in template and fields when the override is empty", function () {
      const resolved = resolveReadingCardTemplate({
        builtinTemplate: BUILTIN,
        customTemplate: "   ",
        lang: "en-US",
      });
      assert.equal(resolved.mode, "builtin");
      assert.equal(resolved.template, BUILTIN);
      assert.deepEqual(resolved.fields, [
        ...DEFAULT_READING_CARD_FIELDS["en-US"],
      ]);
    });

    it("treats a single line as a field list over the built-in template", function () {
      const resolved = resolveReadingCardTemplate({
        builtinTemplate: BUILTIN,
        customTemplate: "Question, Method, Findings",
        lang: "en-US",
      });
      assert.equal(resolved.mode, "fields");
      assert.equal(resolved.template, BUILTIN);
      assert.deepEqual(resolved.fields, ["Question", "Method", "Findings"]);
    });

    it("treats several lines as a full template replacement", function () {
      const custom = "My own card.\nKeep it short.";
      const resolved = resolveReadingCardTemplate({
        builtinTemplate: BUILTIN,
        customTemplate: custom,
        lang: "zh-CN",
      });
      assert.equal(resolved.mode, "custom");
      assert.equal(resolved.template, custom);
      // A replaced template still gets the localized default headings.
      assert.deepEqual(resolved.fields, [
        ...DEFAULT_READING_CARD_FIELDS["zh-CN"],
      ]);
    });

    it("falls back to the built-in when a one-liner parses to nothing", function () {
      const resolved = resolveReadingCardTemplate({
        builtinTemplate: BUILTIN,
        customTemplate: "、、,",
        lang: "en-US",
      });
      assert.equal(resolved.mode, "builtin");
      assert.deepEqual(resolved.fields, [
        ...DEFAULT_READING_CARD_FIELDS["en-US"],
      ]);
    });
  });

  describe("fields block", function () {
    it("renders every field as a level-two heading", function () {
      assert.equal(
        formatReadingCardFieldsBlock(["Method", "Limitations"]),
        "## Method\n## Limitations",
      );
    });

    it("skips empty entries", function () {
      assert.equal(formatReadingCardFieldsBlock(["Method", "  "]), "## Method");
    });
  });

  describe("page citation mode", function () {
    it("keeps citations for a PDF whose text is not extracted yet", function () {
      assert.isTrue(
        resolveReadingCardPageCitations({
          documentKind: "pdf",
          pageAnchorsEnabled: true,
        }),
      );
    });

    it("keeps citations when the extracted PDF text carries page markers", function () {
      assert.isTrue(
        resolveReadingCardPageCitations({
          documentKind: "pdf",
          pageAnchorsEnabled: true,
          contextSample: "[page 1]\nAbstract...",
        }),
      );
    });

    it("relaxes citations when the extracted text has no page markers", function () {
      assert.isFalse(
        resolveReadingCardPageCitations({
          documentKind: "pdf",
          pageAnchorsEnabled: true,
          contextSample: "Abstract without any marker",
        }),
      );
    });

    it("relaxes citations for EPUB, which never gets page markers", function () {
      assert.isFalse(
        resolveReadingCardPageCitations({
          documentKind: "epub",
          pageAnchorsEnabled: true,
        }),
      );
    });

    it("relaxes citations when page anchors are switched off", function () {
      assert.isFalse(
        resolveReadingCardPageCitations({
          documentKind: "pdf",
          pageAnchorsEnabled: false,
          contextSample: "[page 3] text",
        }),
      );
    });
  });

  describe("research focus normalization", function () {
    it("collapses whitespace to a single line", function () {
      assert.equal(
        normalizeReadingCardFocus("  low-resource\n  retrieval  "),
        "low-resource retrieval",
      );
    });

    it("clamps an overlong focus", function () {
      const focus = normalizeReadingCardFocus("x".repeat(1000));
      assert.lengthOf(focus, READING_CARD_FOCUS_MAX_CHARS);
    });

    it("returns an empty string for non-text input", function () {
      assert.equal(normalizeReadingCardFocus(undefined), "");
      assert.equal(normalizeReadingCardFocus(42), "");
    });
  });

  describe("prompt assembly", function () {
    it("substitutes the default fields into the built-in template", function () {
      const prompt = buildReadingCardPrompt({
        builtinTemplate: BUILTIN,
        lang: "en-US",
      });
      assert.notInclude(prompt, READING_CARD_FIELDS_PLACEHOLDER);
      for (const field of DEFAULT_READING_CARD_FIELDS["en-US"]) {
        assert.include(prompt, `## ${field}`);
      }
      assert.include(prompt, "Write a structured reading card");
    });

    it("substitutes a custom field list and drops the defaults", function () {
      const prompt = buildReadingCardPrompt({
        builtinTemplate: BUILTIN,
        customTemplate: "Question, Method, Findings",
        lang: "en-US",
      });
      assert.include(prompt, "## Question");
      assert.include(prompt, "## Findings");
      assert.notInclude(prompt, "## Limitations");
    });

    it("keeps a multi-line custom template verbatim", function () {
      const custom = "Only answer with three bullets.\nNothing else.";
      const prompt = buildReadingCardPrompt({
        builtinTemplate: BUILTIN,
        customTemplate: custom,
        lang: "en-US",
      });
      assert.include(prompt, custom);
      assert.notInclude(prompt, "Write a structured reading card");
      // Without the placeholder, headings are not forced into a custom body.
      assert.notInclude(prompt, "## Research Question");
    });

    it("honours the placeholder inside a multi-line custom template", function () {
      const prompt = buildReadingCardPrompt({
        builtinTemplate: BUILTIN,
        customTemplate: `My card.\n${READING_CARD_FIELDS_PLACEHOLDER}`,
        lang: "en-US",
      });
      assert.include(prompt, "## Research Question");
      assert.notInclude(prompt, READING_CARD_FIELDS_PLACEHOLDER);
    });

    it("always demands the title line the recogniser looks for", function () {
      for (const lang of ["en-US", "zh-CN"] as const) {
        const prompt = buildReadingCardPrompt({
          builtinTemplate: BUILTIN,
          customTemplate: "totally\nunrelated template",
          lang,
        });
        assert.include(prompt, `# ${READING_CARD_TITLE[lang]}`);
        assert.isTrue(
          isReadingCardText(`# ${READING_CARD_TITLE[lang]}\n\nbody`),
        );
      }
    });

    it("injects the research focus when the user stated one", function () {
      const prompt = buildReadingCardPrompt({
        builtinTemplate: BUILTIN,
        researchFocus: "  retrieval for low-resource   languages ",
        lang: "en-US",
      });
      assert.include(
        prompt,
        "My research focus: retrieval for low-resource languages",
      );
      assert.notInclude(prompt, "I have not stated a research focus");
    });

    it("asks for follow-up questions when no focus is stated", function () {
      const prompt = buildReadingCardPrompt({
        builtinTemplate: BUILTIN,
        researchFocus: "   ",
        lang: "en-US",
      });
      assert.include(prompt, "I have not stated a research focus");
      assert.include(prompt, "follow-up questions");
    });

    it("injects the localized focus sentence for Chinese", function () {
      const prompt = buildReadingCardPrompt({
        builtinTemplate: BUILTIN,
        researchFocus: "低资源语言检索",
        lang: "zh-CN",
      });
      assert.include(prompt, "我的研究方向：低资源语言检索");
    });

    it("asks for page citations by default and relaxes them on request", function () {
      const withPages = buildReadingCardPrompt({
        builtinTemplate: BUILTIN,
        lang: "en-US",
      });
      assert.include(withPages, "[p.N]");
      assert.notInclude(withPages, "no page numbers");

      const withoutPages = buildReadingCardPrompt({
        builtinTemplate: BUILTIN,
        lang: "en-US",
        pageCitations: false,
      });
      assert.include(withoutPages, "no page numbers");
      assert.include(withoutPages, "do not write [p.N]");
    });

    it("appends the fields when a built-in copy lost its placeholder", function () {
      const prompt = buildReadingCardPrompt({
        builtinTemplate: "Write a card.",
        lang: "en-US",
      });
      assert.include(prompt, "## Research Question");
    });
  });

  describe("recognising a card message", function () {
    it("recognises the English and Chinese title lines", function () {
      assert.isTrue(
        isReadingCardText("# Reading Card\n\n## Research Question"),
      );
      assert.isTrue(isReadingCardText("# 精读卡片\n\n## 研究问题"));
      assert.isTrue(isReadingCardText("# 精讀卡片\n\n## 研究問題"));
    });

    it("tolerates other heading levels, an AIdea prefix, and a suffix", function () {
      assert.isTrue(isReadingCardText("## Reading Card"));
      assert.isTrue(isReadingCardText("### AIdea Reading Card"));
      assert.isTrue(isReadingCardText("# AIdea — 精读卡片：某论文"));
      assert.isTrue(
        isReadingCardText("# Reading Card: Attention Is All You Need"),
      );
    });

    it("looks past a wrapping code fence and a short preamble", function () {
      assert.isTrue(isReadingCardText("```markdown\n# Reading Card\n"));
      assert.isTrue(isReadingCardText("Sure, here it is.\n\n# Reading Card\n"));
    });

    it("rejects ordinary answers and late mentions", function () {
      assert.isFalse(isReadingCardText("## Summary\n\nThis paper argues..."));
      assert.isFalse(isReadingCardText("Reading Card"));
      assert.isFalse(
        isReadingCardText(
          ["a", "b", "c", "d", "e", "f", "# Reading Card"].join("\n"),
        ),
      );
    });

    it("rejects empty and non-string input", function () {
      assert.isFalse(isReadingCardText(""));
      assert.isFalse(isReadingCardText("   \n  "));
      assert.isFalse(isReadingCardText(null));
      assert.isFalse(isReadingCardText(123));
    });
  });
});
