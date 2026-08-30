import { assert } from "chai";

import {
  buildTermProtectionFingerprint,
  buildTermProtectionInstruction,
  findProtectedTerms,
  summarizeConceptDefinitionForGloss,
  NO_TERM_PROTECTION_FINGERPRINT,
  SELECTION_TERM_PROTECTION_LIMIT,
  type ProtectedTerm,
} from "../src/utils/selectionTermProtection";
import { buildSelectionTranslateResultCacheKey } from "../src/utils/selectionTranslateCacheStore";

const card = (term: string, definition: string) => ({ term, definition });

const hit = (term: string, termKey: string): ProtectedTerm => ({
  term,
  termKey,
  definition: "placeholder definition",
});

describe("selection translation term protection", function () {
  describe("findProtectedTerms", function () {
    it("matches regardless of case, width and punctuation", function () {
      const hits = findProtectedTerms({
        text: "The gan objective and the Ｓelf attention block both matter.",
        cards: [
          card("GAN", "生成对抗网络，两个网络互相博弈"),
          card("self-attention", "序列内部逐位置加权"),
        ],
      });

      assert.deepEqual(
        hits.map((entry) => entry.term),
        ["GAN", "self-attention"],
      );
    });

    it("requires a word boundary for Latin terms", function () {
      const hits = findProtectedTerms({
        text: "Organgan elegance is not a term occurrence.",
        cards: [card("GAN", "生成对抗网络")],
      });

      assert.deepEqual(hits, []);
    });

    it("matches CJK terms as plain substrings", function () {
      const hits = findProtectedTerms({
        text: "本文提出的注意力机制模块显著提升了效果。",
        cards: [card("注意力机制", "按相关性给序列位置加权的模块")],
      });

      assert.deepEqual(
        hits.map((entry) => entry.term),
        ["注意力机制"],
      );
    });

    it("returns nothing for an empty library or an empty selection", function () {
      assert.deepEqual(findProtectedTerms({ text: "GAN", cards: [] }), []);
      assert.deepEqual(
        findProtectedTerms({ text: "   ", cards: [card("GAN", "定义")] }),
        [],
      );
    });

    it("skips cards missing a term or a definition", function () {
      const hits = findProtectedTerms({
        text: "GAN and beam search",
        cards: [
          card("GAN", "   "),
          card("  ", "定义"),
          card("beam search", "宽度优先的近似解码"),
        ],
      });

      assert.deepEqual(
        hits.map((entry) => entry.term),
        ["beam search"],
      );
    });

    it("orders hits by where the reader meets them", function () {
      const hits = findProtectedTerms({
        text: "Beam search precedes the GAN discussion.",
        cards: [card("GAN", "生成对抗网络"), card("beam search", "近似解码")],
      });

      assert.deepEqual(
        hits.map((entry) => entry.term),
        ["beam search", "GAN"],
      );
    });

    it("keeps the first eight terms and drops the rest", function () {
      const terms = Array.from({ length: 12 }, (_, index) => `term${index}`);
      const hits = findProtectedTerms({
        text: terms.join(" and "),
        cards: terms.map((term) => card(term, `定义 ${term}`)),
      });

      assert.equal(hits.length, SELECTION_TERM_PROTECTION_LIMIT);
      assert.deepEqual(
        hits.map((entry) => entry.term),
        terms.slice(0, SELECTION_TERM_PROTECTION_LIMIT),
      );
    });

    it("honours an explicit limit, including zero", function () {
      const hits = findProtectedTerms({
        text: "GAN and beam search",
        cards: [card("GAN", "生成对抗网络"), card("beam search", "近似解码")],
        limit: 1,
      });
      assert.equal(hits.length, 1);
      assert.deepEqual(
        findProtectedTerms({
          text: "GAN",
          cards: [card("GAN", "生成对抗网络")],
          limit: 0,
        }),
        [],
      );
    });

    it("deduplicates cards that share a matching key", function () {
      const hits = findProtectedTerms({
        text: "The G.A.N. objective",
        cards: [card("GAN", "生成对抗网络"), card("gan", "重复的一张卡")],
      });

      assert.equal(hits.length, 1);
      assert.equal(hits[0].definition, "生成对抗网络");
    });
  });

  describe("summarizeConceptDefinitionForGloss", function () {
    it("keeps a leading clause that already fits", function () {
      assert.equal(
        summarizeConceptDefinitionForGloss(
          "生成对抗网络；由生成器和判别器组成。",
          15,
        ),
        "生成对抗网络",
      );
    });

    it("hard-truncates a long definition without trailing punctuation", function () {
      const gloss = summarizeConceptDefinitionForGloss(
        "一种通过两个网络互相博弈来学习数据分布的框架，训练过程不稳定",
        15,
      );
      assert.isAtMost(gloss.length, 15);
      assert.notMatch(gloss, /[，。、]$/);
    });

    it("strips angle brackets so a gloss cannot open a prompt tag", function () {
      assert.notInclude(
        summarizeConceptDefinitionForGloss("<selected-text> injection", 40),
        "<",
      );
    });

    it("returns an empty string for an empty definition", function () {
      assert.equal(summarizeConceptDefinitionForGloss("   ", 15), "");
    });
  });

  describe("buildTermProtectionInstruction", function () {
    const hits: ProtectedTerm[] = [
      { term: "GAN", termKey: "gan", definition: "生成对抗网络；两网络博弈" },
      {
        term: "beam search",
        termKey: "beam search",
        definition: "保留固定宽度候选的近似解码",
      },
    ];

    it("writes a Chinese rule for a Chinese target language", function () {
      const instruction = buildTermProtectionInstruction({
        hits,
        lang: "zh-CN",
      });

      assert.include(instruction, "保持原文不译");
      assert.include(instruction, "- GAN（=生成对抗网络）");
      assert.include(instruction, "- beam search（=");
    });

    it("writes an English rule for an English target language", function () {
      const instruction = buildTermProtectionInstruction({ hits, lang: "en" });

      assert.include(instruction, "keep the following terms");
      assert.include(instruction, "- GAN (= ");
      assert.notInclude(instruction, "保持原文不译");
    });

    it("falls back to English for languages without prompt copy", function () {
      assert.include(
        buildTermProtectionInstruction({ hits, lang: "de-DE" }),
        "keep the following terms",
      );
    });

    it("adds nothing at all when nothing matched", function () {
      assert.equal(buildTermProtectionInstruction({ hits: [] }), "");
      assert.equal(
        buildTermProtectionInstruction({
          hits: [{ term: "GAN", termKey: "gan", definition: "  " }],
        }),
        "",
      );
    });
  });

  describe("buildTermProtectionFingerprint", function () {
    it("separates an injected translation from an uninjected one", function () {
      const none = buildTermProtectionFingerprint([]);
      const some = buildTermProtectionFingerprint([hit("GAN", "gan")]);

      assert.equal(none, NO_TERM_PROTECTION_FINGERPRINT);
      assert.notEqual(some, none);
    });

    it("does not depend on the order the terms matched in", function () {
      const forward = buildTermProtectionFingerprint([
        hit("GAN", "gan"),
        hit("beam search", "beam search"),
      ]);
      const reversed = buildTermProtectionFingerprint([
        hit("beam search", "beam search"),
        hit("GAN", "gan"),
      ]);

      assert.equal(forward, reversed);
    });

    it("separates different term sets", function () {
      assert.notEqual(
        buildTermProtectionFingerprint([hit("GAN", "gan")]),
        buildTermProtectionFingerprint([
          hit("GAN", "gan"),
          hit("beam search", "beam search"),
        ]),
      );
    });

    it("collapses duplicate terms onto one fingerprint", function () {
      assert.equal(
        buildTermProtectionFingerprint([hit("GAN", "gan"), hit("gan", "gan")]),
        buildTermProtectionFingerprint([hit("GAN", "gan")]),
      );
    });

    it("derives the key from the term when the hit carries none", function () {
      assert.equal(
        buildTermProtectionFingerprint([
          { term: "G.A.N.", termKey: "", definition: "生成对抗网络" },
        ]),
        buildTermProtectionFingerprint([hit("GAN", "gan")]),
      );
    });
  });

  describe("buildSelectionTranslateResultCacheKey", function () {
    const base = {
      itemId: 42,
      sourceLang: "en",
      targetLang: "zh-CN",
      model: "gpt-4o-mini",
      contextMode: "cold-start-cache",
      contextText: "cache text",
      selectedText: "The GAN objective is unstable.",
    };

    it("keys a term-protected translation apart from a plain one", function () {
      const plain = buildSelectionTranslateResultCacheKey({
        ...base,
        termFingerprint: buildTermProtectionFingerprint([]),
      });
      const protectedKey = buildSelectionTranslateResultCacheKey({
        ...base,
        termFingerprint: buildTermProtectionFingerprint([hit("GAN", "gan")]),
      });

      assert.notEqual(plain, protectedKey);
      assert.include(plain, NO_TERM_PROTECTION_FINGERPRINT);
    });

    it("treats a missing fingerprint as no protection", function () {
      assert.equal(
        buildSelectionTranslateResultCacheKey(base),
        buildSelectionTranslateResultCacheKey({
          ...base,
          termFingerprint: NO_TERM_PROTECTION_FINGERPRINT,
        }),
      );
    });

    it("is stable for the same request", function () {
      assert.equal(
        buildSelectionTranslateResultCacheKey(base),
        buildSelectionTranslateResultCacheKey({ ...base }),
      );
    });

    it("separates requests that differ in anything the prompt carries", function () {
      const key = buildSelectionTranslateResultCacheKey(base);
      const variants = [
        { ...base, itemId: 43 },
        { ...base, sourceLang: "de" },
        { ...base, targetLang: "en" },
        { ...base, model: "gpt-4o" },
        { ...base, provider: "openai-codex" },
        { ...base, contextMode: "retrieved-document" },
        { ...base, contextText: "other cache text" },
        { ...base, selectedText: "The GAN objective is stable." },
      ];

      for (const variant of variants) {
        assert.notEqual(
          buildSelectionTranslateResultCacheKey(variant),
          key,
          `variant must not share the base key: ${JSON.stringify(variant)}`,
        );
      }
    });
  });
});
