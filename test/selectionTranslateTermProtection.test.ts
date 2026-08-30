import { assert } from "chai";
import { PDF_CONTENT_TYPE } from "../src/modules/contextPanel/documentContext";
import { pdfTextCache } from "../src/modules/contextPanel/state";
import type { PdfContext } from "../src/modules/contextPanel/types";
import { clearSelectionTranslateResultCache } from "../src/utils/selectionTranslateCacheStore";

type SelectionTranslateModule =
  typeof import("../src/modules/contextPanel/selectionTranslate");

const originalZotero = (globalThis as Record<string, unknown>).Zotero;
const originalZtoolkit = (globalThis as Record<string, unknown>).ztoolkit;
const originalFetch = globalThis.fetch;

let selectionTranslate: SelectionTranslateModule;
let prefs: Map<string, unknown>;
let conceptRows: Array<Record<string, unknown>>;
let conceptQueryFails: boolean;
let prompts: string[];

function makeAttachment(id: number): Zotero.Item {
  return {
    id,
    libraryID: 1,
    parentID: null,
    attachmentContentType: PDF_CONTENT_TYPE,
    isAttachment: () => true,
    isRegularItem: () => false,
    getField: () => "",
  } as unknown as Zotero.Item;
}

function makeEmptyContext(): PdfContext {
  return {
    title: "pdf",
    chunks: [],
    chunkStats: [],
    docFreq: {},
    avgChunkLength: 0,
    fullLength: 0,
    embeddingFailed: false,
  };
}

function conceptRow(
  id: number,
  term: string,
  definition: string,
): Record<string, unknown> {
  return {
    id,
    libraryID: 1,
    term,
    termKey: "",
    definition,
    sourceItemId: null,
    sourceTitle: null,
    sourcePage: null,
    createdAt: 1,
    updatedAt: 1,
    hitCount: 0,
    lastHitAt: null,
  };
}

function stubFetch(translation: string): () => number {
  let requestCount = 0;
  globalThis.fetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    requestCount += 1;
    const payload = JSON.parse(String(init?.body || "{}")) as Record<
      string,
      unknown
    >;
    const messages = payload.messages as
      Array<{ content?: unknown }> | undefined;
    prompts.push(String(messages?.at(-1)?.content || ""));
    return new Response(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: translation } }],
      })}\n\n` + "data: [DONE]\n\n",
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }) as typeof globalThis.fetch;
  return () => requestCount;
}

describe("selection translation term protection wiring", function () {
  before(async function () {
    prefs = new Map<string, unknown>([
      ["extensions.zotero.aidea.selectionTranslate.enabled", true],
      ["extensions.zotero.aidea.primaryConnectionMode", "custom"],
      [
        "extensions.zotero.aidea.apiBase",
        "https://api.example.test/v1/chat/completions",
      ],
      ["extensions.zotero.aidea.apiKey", "test-key"],
      ["extensions.zotero.aidea.model", "gpt-4o-mini"],
      ["extensions.zotero.aidea.selectionTranslate.sourceLang", "en"],
      ["extensions.zotero.aidea.selectionTranslate.targetLang", "zh-CN"],
    ]);
    (globalThis as Record<string, unknown>).Zotero = {
      Prefs: {
        get: (key: string) => prefs.get(key) ?? "",
        set: (key: string, value: unknown) => {
          prefs.set(key, value);
        },
      },
      DB: {
        async queryAsync(sql: string) {
          if (conceptQueryFails) throw new Error("concept store unavailable");
          if (String(sql).includes("zotero_ai_concepts")) return conceptRows;
          return [];
        },
      },
    };
    (globalThis as Record<string, unknown>).ztoolkit = {
      getGlobal: (name: string) =>
        name === "fetch" ? globalThis.fetch : undefined,
      log: () => undefined,
    };
    selectionTranslate =
      await import("../src/modules/contextPanel/selectionTranslate");
  });

  beforeEach(function () {
    conceptRows = [];
    conceptQueryFails = false;
    prompts = [];
    clearSelectionTranslateResultCache();
    prefs.delete("extensions.zotero.aidea.selectionTranslate.termProtection");
  });

  afterEach(function () {
    pdfTextCache.clear();
    globalThis.fetch = originalFetch;
  });

  after(function () {
    (globalThis as Record<string, unknown>).Zotero = originalZotero;
    (globalThis as Record<string, unknown>).ztoolkit = originalZtoolkit;
    globalThis.fetch = originalFetch;
  });

  it("injects only the terms the selection actually names", async function () {
    const item = makeAttachment(101);
    pdfTextCache.set(item.id, makeEmptyContext());
    conceptRows = [
      conceptRow(1, "GAN", "生成对抗网络；由生成器和判别器组成"),
      conceptRow(2, "beam search", "保留固定宽度候选的近似解码"),
    ];
    stubFetch("已翻译");

    await selectionTranslate.translateSelectedTextForReader({
      item,
      selectedText: "The GAN objective is unstable.",
    });

    assert.include(prompts[0], "术语规则");
    assert.include(prompts[0], "- GAN（=生成对抗网络）");
    assert.notInclude(prompts[0], "beam search");
  });

  it("adds no rule at all when the library matches nothing", async function () {
    const item = makeAttachment(102);
    pdfTextCache.set(item.id, makeEmptyContext());
    conceptRows = [conceptRow(1, "beam search", "近似解码")];
    stubFetch("已翻译");

    await selectionTranslate.translateSelectedTextForReader({
      item,
      selectedText: "The GAN objective is unstable.",
    });

    assert.notInclude(prompts[0], "术语规则");
    assert.notInclude(prompts[0], "Terminology rule");
  });

  it("degrades to a plain translation when the concept store throws", async function () {
    const item = makeAttachment(103);
    pdfTextCache.set(item.id, makeEmptyContext());
    conceptQueryFails = true;
    const requests = stubFetch("已翻译");

    const result = await selectionTranslate.translateSelectedTextForReader({
      item,
      selectedText: "The GAN objective is unstable.",
    });

    assert.equal(result.translation, "已翻译");
    assert.equal(requests(), 1);
    assert.notInclude(prompts[0], "术语规则");
  });

  it("skips the injection when the preference is off", async function () {
    const item = makeAttachment(104);
    pdfTextCache.set(item.id, makeEmptyContext());
    prefs.set(
      "extensions.zotero.aidea.selectionTranslate.termProtection",
      false,
    );
    conceptRows = [conceptRow(1, "GAN", "生成对抗网络")];
    stubFetch("已翻译");

    await selectionTranslate.translateSelectedTextForReader({
      item,
      selectedText: "The GAN objective is unstable.",
    });

    assert.notInclude(prompts[0], "术语规则");
  });

  it("reuses a memoized translation for an identical request", async function () {
    const item = makeAttachment(105);
    pdfTextCache.set(item.id, makeEmptyContext());
    const requests = stubFetch("已翻译");

    const first = await selectionTranslate.translateSelectedTextForReader({
      item,
      selectedText: "The GAN objective is unstable.",
    });
    const second = await selectionTranslate.translateSelectedTextForReader({
      item,
      selectedText: "The GAN objective is unstable.",
    });

    assert.equal(second.translation, first.translation);
    assert.equal(requests(), 1);
  });

  it("re-translates the same text once a matching term appears", async function () {
    const item = makeAttachment(106);
    pdfTextCache.set(item.id, makeEmptyContext());
    const requests = stubFetch("已翻译");

    await selectionTranslate.translateSelectedTextForReader({
      item,
      selectedText: "The GAN objective is unstable.",
    });
    conceptRows = [conceptRow(1, "GAN", "生成对抗网络")];
    await selectionTranslate.translateSelectedTextForReader({
      item,
      selectedText: "The GAN objective is unstable.",
    });

    assert.equal(
      requests(),
      2,
      "the term rule changes the prompt, so the memo must not answer",
    );
    assert.notInclude(prompts[0], "术语规则");
    assert.include(prompts[1], "术语规则");
  });

  it("keeps the bilingual preference off by default and writes toggles back", function () {
    assert.isFalse(selectionTranslate.isSelectionTranslateBilingualEnabled());
    assert.isTrue(selectionTranslate.toggleSelectionTranslateBilingual());
    assert.isTrue(selectionTranslate.isSelectionTranslateBilingualEnabled());
    assert.isFalse(selectionTranslate.toggleSelectionTranslateBilingual());
    assert.isFalse(selectionTranslate.isSelectionTranslateBilingualEnabled());
  });
});
