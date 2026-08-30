import { assert } from "chai";
import { readFileSync } from "node:fs";

import {
  AUTO_BRIEFING_MODES,
  AUTO_BRIEFING_MODE_PREF_KEY,
  AUTO_BRIEFING_TRIGGER_DELAY_MS,
  PAPER_BRIEFING_TITLE,
  buildPaperBriefingPrompt,
  evaluateAutoBriefingGate,
  getAutoBriefingMode,
  normalizeAutoBriefingMode,
  paperPinsBlockAutoBriefing,
  resolveAutoBriefingLang,
  shouldStillAutoBrief,
  type AutoBriefingGateInput,
  type AutoBriefingRecheckInput,
} from "../src/utils/autoBriefing";

const BUILTIN = [
  "Write a compact opening briefing for this document.",
  "",
  "## TL;DR",
  "## Research Question",
  "## Key Contributions",
  "## What Is New",
  "## Method",
  "## Main Results",
].join("\n");

/** A panel that satisfies every condition; each test breaks exactly one. */
const READY_GATE: AutoBriefingGateInput = {
  panelKind: "reader",
  mode: "auto",
  alreadyAttempted: false,
  conversationLoaded: true,
  messageCount: 0,
  composerDirty: false,
  generating: false,
  hasDocument: true,
  hasModel: true,
};

/** The same idea for the post-delay check. */
const READY_RECHECK: AutoBriefingRecheckInput = {
  panelConnected: true,
  panelItemId: 42,
  activeDocumentItemId: 42,
  conversationLoaded: true,
  messageCount: 0,
  composerDirty: false,
  generating: false,
};

describe("auto briefing", function () {
  describe("mode preference", function () {
    it("lists exactly the three documented modes", function () {
      assert.deepEqual([...AUTO_BRIEFING_MODES], ["auto", "manual", "off"]);
      assert.equal(AUTO_BRIEFING_MODE_PREF_KEY, "autoBriefing.mode");
    });

    it("normalizes the stored values, whatever their casing", function () {
      assert.equal(normalizeAutoBriefingMode("manual"), "manual");
      assert.equal(normalizeAutoBriefingMode("  OFF "), "off");
      assert.equal(normalizeAutoBriefingMode("auto"), "auto");
    });

    it("defaults to auto for unknown, empty and non-text values", function () {
      assert.equal(normalizeAutoBriefingMode("nonsense"), "auto");
      assert.equal(normalizeAutoBriefingMode(""), "auto");
      assert.equal(normalizeAutoBriefingMode(undefined), "auto");
      assert.equal(normalizeAutoBriefingMode(null), "auto");
      assert.equal(normalizeAutoBriefingMode(7), "auto");
    });

    it("defaults to auto without a Zotero runtime", function () {
      // The module must stay importable outside Zotero, so a missing Prefs
      // object is a default rather than a throw.
      const previous = (globalThis as any).Zotero;
      delete (globalThis as any).Zotero;
      try {
        assert.equal(getAutoBriefingMode(), "auto");
      } finally {
        (globalThis as any).Zotero = previous;
      }
    });

    it("reads the stored mode when Zotero is available", function () {
      const previous = (globalThis as any).Zotero;
      (globalThis as any).Zotero = {
        Prefs: {
          get(key: string) {
            return key.endsWith(AUTO_BRIEFING_MODE_PREF_KEY) ? "manual" : "";
          },
        },
      };
      try {
        assert.equal(getAutoBriefingMode(), "manual");
      } finally {
        (globalThis as any).Zotero = previous;
      }
    });

    it("falls back to auto when reading the preference throws", function () {
      const previous = (globalThis as any).Zotero;
      (globalThis as any).Zotero = {
        Prefs: {
          get() {
            throw new Error("prefs unavailable");
          },
        },
      };
      try {
        assert.equal(getAutoBriefingMode(), "auto");
      } finally {
        (globalThis as any).Zotero = previous;
      }
    });
  });

  describe("language resolution", function () {
    it("maps every Chinese panel locale onto the Simplified copy", function () {
      assert.equal(resolveAutoBriefingLang("zh-CN"), "zh-CN");
      assert.equal(resolveAutoBriefingLang("zh-TW"), "zh-CN");
    });

    it("falls back to English for unsupported and missing locales", function () {
      assert.equal(resolveAutoBriefingLang("ja-JP"), "en-US");
      assert.equal(resolveAutoBriefingLang(""), "en-US");
      assert.equal(resolveAutoBriefingLang(undefined), "en-US");
    });
  });

  describe("prompt assembly", function () {
    it("keeps the bundled heading skeleton verbatim", function () {
      const prompt = buildPaperBriefingPrompt({
        builtinTemplate: BUILTIN,
        lang: "en-US",
      });
      assert.include(prompt, BUILTIN);
      for (const heading of [
        "## TL;DR",
        "## Research Question",
        "## Key Contributions",
        "## What Is New",
        "## Method",
        "## Main Results",
      ]) {
        assert.include(prompt, heading);
      }
    });

    it("always demands the localized title line", function () {
      for (const lang of ["en-US", "zh-CN"] as const) {
        const prompt = buildPaperBriefingPrompt({
          builtinTemplate: BUILTIN,
          lang,
        });
        assert.include(prompt, `# ${PAPER_BRIEFING_TITLE[lang]}`);
      }
    });

    it("states a length budget so a briefing cannot become a survey", function () {
      assert.include(
        buildPaperBriefingPrompt({ builtinTemplate: BUILTIN, lang: "en-US" }),
        "400 words",
      );
      assert.include(
        buildPaperBriefingPrompt({ builtinTemplate: BUILTIN, lang: "zh-CN" }),
        "600 字",
      );
    });

    it("asks for page citations by default and relaxes them on request", function () {
      const withPages = buildPaperBriefingPrompt({
        builtinTemplate: BUILTIN,
        lang: "en-US",
      });
      assert.include(withPages, "[p.N]");
      assert.notInclude(withPages, "no page numbers");

      const withoutPages = buildPaperBriefingPrompt({
        builtinTemplate: BUILTIN,
        lang: "en-US",
        pageCitations: false,
      });
      assert.include(withoutPages, "no page numbers");
      assert.include(withoutPages, "do not write [p.N]");
    });

    it("returns nothing when the template could not be read", function () {
      // The caller reports a load failure; it must never send bare rules.
      assert.equal(
        buildPaperBriefingPrompt({ builtinTemplate: "", lang: "en-US" }),
        "",
      );
      assert.equal(
        buildPaperBriefingPrompt({ builtinTemplate: "   \n ", lang: "en-US" }),
        "",
      );
    });
  });

  describe("bundled templates", function () {
    const read = (path: string) =>
      readFileSync(new URL(path, import.meta.url), "utf8");
    const headingsOf = (template: string) =>
      template
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("## "));

    it("ships an English skeleton of six level-two headings", function () {
      const headings = headingsOf(
        read("../addon/content/shortcuts/paper-briefing.txt"),
      );
      assert.deepEqual(headings, [
        "## TL;DR",
        "## Research Question",
        "## Key Contributions",
        "## What Is New",
        "## Method",
        "## Main Results",
      ]);
    });

    it("ships a Simplified Chinese skeleton with the same six fields", function () {
      const headings = headingsOf(
        read("../addon/content/shortcuts/zh-CN/paper-briefing.txt"),
      );
      assert.deepEqual(headings, [
        "## 一句话总结",
        "## 研究问题",
        "## 核心贡献",
        "## 创新点",
        "## 方法概览",
        "## 主要结果",
      ]);
    });

    it("assembles a usable prompt from each bundled file", function () {
      for (const [lang, path] of [
        ["en-US", "../addon/content/shortcuts/paper-briefing.txt"],
        ["zh-CN", "../addon/content/shortcuts/zh-CN/paper-briefing.txt"],
      ] as const) {
        const prompt = buildPaperBriefingPrompt({
          builtinTemplate: read(path),
          lang,
        });
        assert.include(prompt, `# ${PAPER_BRIEFING_TITLE[lang]}`);
        assert.include(prompt, "[p.N]");
        assert.include(prompt, "## ");
      }
    });
  });

  describe("schedule-time gate", function () {
    it("fires for a fresh reader panel on an empty conversation", function () {
      assert.deepEqual(evaluateAutoBriefingGate(READY_GATE), {
        trigger: true,
        reason: null,
      });
    });

    it("never fires outside a reader panel", function () {
      for (const panelKind of ["library", "", "global"]) {
        assert.deepEqual(
          evaluateAutoBriefingGate({ ...READY_GATE, panelKind }),
          { trigger: false, reason: "not-reader" },
        );
      }
    });

    it("only fires in auto mode", function () {
      for (const mode of ["manual", "off"] as const) {
        assert.deepEqual(evaluateAutoBriefingGate({ ...READY_GATE, mode }), {
          trigger: false,
          reason: "mode-not-auto",
        });
      }
    });

    it("does not fire twice for the same document", function () {
      assert.deepEqual(
        evaluateAutoBriefingGate({ ...READY_GATE, alreadyAttempted: true }),
        { trigger: false, reason: "already-attempted" },
      );
    });

    it("waits rather than guessing when the conversation is still loading", function () {
      // An unloaded conversation reads as empty, which would look exactly like
      // a fresh paper and re-brief one that already has a briefing.
      assert.deepEqual(
        evaluateAutoBriefingGate({ ...READY_GATE, conversationLoaded: false }),
        { trigger: false, reason: "conversation-not-loaded" },
      );
    });

    it("does not fire once the conversation holds any message", function () {
      // This is the idempotency rule: a stored briefing is itself a message.
      for (const messageCount of [1, 2, 40]) {
        assert.deepEqual(
          evaluateAutoBriefingGate({ ...READY_GATE, messageCount }),
          { trigger: false, reason: "conversation-not-empty" },
        );
      }
    });

    it("does not overwrite a composer the user is already using", function () {
      // Sending clears the input box and consumes pinned context, so a
      // restored draft or a pinned passage has to call the briefing off.
      assert.deepEqual(
        evaluateAutoBriefingGate({ ...READY_GATE, composerDirty: true }),
        { trigger: false, reason: "composer-in-use" },
      );
    });

    it("does not interrupt a request already in flight", function () {
      assert.deepEqual(
        evaluateAutoBriefingGate({ ...READY_GATE, generating: true }),
        { trigger: false, reason: "generating" },
      );
    });

    it("does not fire without a readable document", function () {
      assert.deepEqual(
        evaluateAutoBriefingGate({ ...READY_GATE, hasDocument: false }),
        { trigger: false, reason: "no-document" },
      );
    });

    it("stays silent when no model is configured", function () {
      // Sending without a model would only surface an error the user did not
      // ask for, so an unconfigured plugin simply does nothing.
      assert.deepEqual(
        evaluateAutoBriefingGate({ ...READY_GATE, hasModel: false }),
        { trigger: false, reason: "no-model" },
      );
    });

    it("reports the most specific reason when several conditions fail", function () {
      assert.equal(
        evaluateAutoBriefingGate({
          ...READY_GATE,
          panelKind: "library",
          mode: "off",
          hasModel: false,
        }).reason,
        "not-reader",
      );
      assert.equal(
        evaluateAutoBriefingGate({
          ...READY_GATE,
          messageCount: 4,
          hasModel: false,
        }).reason,
        "conversation-not-empty",
      );
    });
  });

  describe("post-delay recheck", function () {
    it("waits long enough to survive a burst of opened tabs", function () {
      assert.isAtLeast(AUTO_BRIEFING_TRIGGER_DELAY_MS, 2000);
      assert.isAtMost(AUTO_BRIEFING_TRIGGER_DELAY_MS, 5000);
    });

    it("sends when the panel is still showing the same document", function () {
      assert.isTrue(shouldStillAutoBrief(READY_RECHECK));
    });

    it("drops when the reader moved on to another document", function () {
      assert.isFalse(
        shouldStillAutoBrief({ ...READY_RECHECK, activeDocumentItemId: 43 }),
      );
    });

    it("still sends when the active tab cannot be determined", function () {
      // An unreadable tab signal must not disable the feature outright; the
      // remaining checks are enough to guard the send.
      assert.isTrue(
        shouldStillAutoBrief({ ...READY_RECHECK, activeDocumentItemId: null }),
      );
    });

    it("drops when the panel was torn down while waiting", function () {
      assert.isFalse(
        shouldStillAutoBrief({ ...READY_RECHECK, panelConnected: false }),
      );
    });

    it("drops when the user got there first", function () {
      assert.isFalse(
        shouldStillAutoBrief({ ...READY_RECHECK, messageCount: 1 }),
      );
      assert.isFalse(
        shouldStillAutoBrief({ ...READY_RECHECK, generating: true }),
      );
    });

    it("drops when the user started composing during the delay", function () {
      assert.isFalse(
        shouldStillAutoBrief({ ...READY_RECHECK, composerDirty: true }),
      );
    });

    it("drops when the conversation was unloaded while waiting", function () {
      assert.isFalse(
        shouldStillAutoBrief({ ...READY_RECHECK, conversationLoaded: false }),
      );
    });
  });

  describe("paperPinsBlockAutoBriefing", function () {
    const ATTACHMENT_ID = 42;
    const PARENT_ID = 7;
    const OWN_IDS = [ATTACHMENT_ID, PARENT_ID];

    it("does not block when nothing is pinned", function () {
      assert.isFalse(paperPinsBlockAutoBriefing([], OWN_IDS));
    });

    it("does not block when the pin is the panel's own attachment", function () {
      assert.isFalse(
        paperPinsBlockAutoBriefing(
          [{ itemId: 999, contextItemId: ATTACHMENT_ID }],
          OWN_IDS,
        ),
      );
    });

    it("does not block when the pin resolves to the panel's parent item", function () {
      assert.isFalse(
        paperPinsBlockAutoBriefing(
          [{ itemId: PARENT_ID, contextItemId: 555 }],
          OWN_IDS,
        ),
      );
    });

    it("blocks when a pin points at a different paper", function () {
      assert.isTrue(
        paperPinsBlockAutoBriefing(
          [{ itemId: 999, contextItemId: 888 }],
          OWN_IDS,
        ),
      );
    });

    it("blocks when any pin among self pins is a different paper", function () {
      assert.isTrue(
        paperPinsBlockAutoBriefing(
          [
            { itemId: PARENT_ID, contextItemId: ATTACHMENT_ID },
            { itemId: 999, contextItemId: 888 },
          ],
          OWN_IDS,
        ),
      );
    });

    it("ignores invalid panel ids instead of matching them", function () {
      assert.isTrue(
        paperPinsBlockAutoBriefing(
          [{ itemId: 0, contextItemId: -1 }],
          [0, -1, Number.NaN],
        ),
      );
    });
  });
});
