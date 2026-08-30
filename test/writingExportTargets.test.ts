import { assert } from "chai";

import {
  buildWritingDraftForMessage,
  buildWritingSourceFromItem,
  createWritingSourceResolver,
  findLatestAssistantMessage,
  isBetterBibTeXAvailable,
  resolveBetterBibTeXCitationKey,
  resolveBibliographicItem,
} from "../src/modules/contextPanel/writingExport";
import {
  chatHistory,
  conversationContextPool,
} from "../src/modules/contextPanel/state";
import type {
  Message,
  PaperContextRef,
} from "../src/modules/contextPanel/types";

const CONVERSATION_KEY = 7373;

const originalZotero = (globalThis as Record<string, unknown>).Zotero;
const originalZtoolkit = (globalThis as Record<string, unknown>).ztoolkit;

type StubItem = Zotero.Item & { id: number };

const itemsById = new Map<number, StubItem>();

function makeAttachment(params: { id: number; parentID?: number }): StubItem {
  const item = {
    id: params.id,
    key: `KEY${params.id}`,
    libraryID: 1,
    parentID: params.parentID ?? null,
    attachmentContentType: "application/pdf",
    isAttachment: () => true,
    isRegularItem: () => false,
    getField: (field: string) => (field === "title" ? `File ${params.id}` : ""),
    getCreators: () => [],
  } as unknown as StubItem;
  itemsById.set(item.id, item);
  return item;
}

function makePaper(params: {
  id: number;
  fields?: Record<string, string>;
  creators?: Array<{
    lastName: string;
    firstName?: string;
    fieldMode?: number;
  }>;
}): StubItem {
  const fields = params.fields || {};
  const item = {
    id: params.id,
    key: `KEY${params.id}`,
    libraryID: 1,
    parentID: null,
    isAttachment: () => false,
    isRegularItem: () => true,
    getField: (field: string) => fields[field] ?? "",
    getCreators: () => params.creators || [],
  } as unknown as StubItem;
  itemsById.set(item.id, item);
  return item;
}

function makePaperRef(contextItemId: number, itemId: number): PaperContextRef {
  return { itemId, contextItemId, title: `Paper ${itemId}` };
}

describe("writing export targets", function () {
  beforeEach(function () {
    itemsById.clear();
    chatHistory.delete(CONVERSATION_KEY);
    conversationContextPool.delete(CONVERSATION_KEY);
    (globalThis as Record<string, unknown>).ztoolkit = { log: () => undefined };
    (globalThis as Record<string, unknown>).Zotero = {
      Items: { get: (id: number) => itemsById.get(id) || false },
      Libraries: { get: () => ({}) },
    };
  });

  afterEach(function () {
    itemsById.clear();
    chatHistory.delete(CONVERSATION_KEY);
    conversationContextPool.delete(CONVERSATION_KEY);
    if (originalZotero === undefined) {
      delete (globalThis as Record<string, unknown>).Zotero;
    } else {
      (globalThis as Record<string, unknown>).Zotero = originalZotero;
    }
    if (originalZtoolkit === undefined) {
      delete (globalThis as Record<string, unknown>).ztoolkit;
    } else {
      (globalThis as Record<string, unknown>).ztoolkit = originalZtoolkit;
    }
  });

  describe("Better BibTeX probe", function () {
    it("reports the plugin as missing without throwing", function () {
      assert.isFalse(isBetterBibTeXAvailable());
      assert.equal(resolveBetterBibTeXCitationKey(1), "");
    });

    it("reads a key from the current key manager API", function () {
      (
        globalThis as unknown as { Zotero: Record<string, unknown> }
      ).Zotero.BetterBibTeX = {
        KeyManager: {
          get: (id: number) =>
            id === 10 ? { citationKey: "smith_2024_long" } : null,
        },
      };
      assert.isTrue(isBetterBibTeXAvailable());
      assert.equal(resolveBetterBibTeXCitationKey(10), "smith_2024_long");
      assert.equal(resolveBetterBibTeXCitationKey(11), "");
    });

    it("falls back to the legacy keys collection", function () {
      (
        globalThis as unknown as { Zotero: Record<string, unknown> }
      ).Zotero.BetterBibTeX = {
        KeyManager: {
          keys: {
            findOne: (query: { itemID: number }) =>
              query.itemID === 10 ? { citekey: "legacy2020" } : null,
          },
        },
      };
      assert.equal(resolveBetterBibTeXCitationKey(10), "legacy2020");
    });

    it("swallows a key manager that throws", function () {
      (
        globalThis as unknown as { Zotero: Record<string, unknown> }
      ).Zotero.BetterBibTeX = {
        KeyManager: {
          get: () => {
            throw new Error("db locked");
          },
        },
      };
      assert.equal(resolveBetterBibTeXCitationKey(10), "");
    });
  });

  describe("resolveBibliographicItem", function () {
    it("walks an attachment up to its parent regular item", function () {
      const paper = makePaper({ id: 100 });
      makeAttachment({ id: 101, parentID: 100 });
      assert.equal(resolveBibliographicItem(101)?.id, paper.id);
    });

    it("keeps a standalone attachment as its own identity", function () {
      makeAttachment({ id: 200 });
      assert.equal(resolveBibliographicItem(200)?.id, 200);
    });

    it("returns null for a missing item", function () {
      assert.isNull(resolveBibliographicItem(999));
      assert.isNull(resolveBibliographicItem(null));
    });
  });

  describe("buildWritingSourceFromItem", function () {
    it("denormalizes creators, year and container", function () {
      const paper = makePaper({
        id: 100,
        fields: {
          title: "Retrieval over long documents",
          date: "2024-06-01",
          publicationTitle: "Journal of Retrieval",
          citationKey: "zoteroKey24",
        },
        creators: [{ lastName: "Smith", firstName: "Jane" }],
      });
      const source = buildWritingSourceFromItem(paper);
      assert.deepEqual(source, {
        id: "100",
        citationKey: "zoteroKey24",
        creators: [{ firstName: "Jane", lastName: "Smith", fieldMode: 0 }],
        title: "Retrieval over long documents",
        date: "2024-06-01",
        publication: "Journal of Retrieval",
      });
    });

    it("prefers the Better BibTeX key over Zotero's own field", function () {
      (
        globalThis as unknown as { Zotero: Record<string, unknown> }
      ).Zotero.BetterBibTeX = {
        KeyManager: { get: () => ({ citationKey: "bbtKey24" }) },
      };
      const paper = makePaper({
        id: 100,
        fields: { title: "T", citationKey: "zoteroKey24" },
      });
      assert.equal(buildWritingSourceFromItem(paper)?.citationKey, "bbtKey24");
    });

    it("falls back through the container fields", function () {
      const book = makePaper({
        id: 101,
        fields: { title: "Chapter", bookTitle: "Handbook of Things" },
      });
      assert.equal(
        buildWritingSourceFromItem(book)?.publication,
        "Handbook of Things",
      );
    });

    it("returns null for nothing", function () {
      assert.isNull(buildWritingSourceFromItem(null));
    });
  });

  describe("createWritingSourceResolver", function () {
    beforeEach(function () {
      makePaper({
        id: 10,
        fields: { title: "Base paper", date: "2024" },
        creators: [{ lastName: "Smith", firstName: "Jane" }],
      });
      makeAttachment({ id: 11, parentID: 10 });
      makePaper({
        id: 20,
        fields: { title: "First supplement", date: "2023" },
        creators: [{ lastName: "Jones", firstName: "Bo" }],
      });
      makeAttachment({ id: 21, parentID: 20 });
      chatHistory.set(CONVERSATION_KEY, [
        {
          messageId: 1,
          role: "user",
          text: "q",
          timestamp: 1,
          contextRefs: {
            baseDocument: {
              kind: "pdf",
              itemId: 10,
              contextItemId: 11,
              title: "Base paper",
            },
            supplementalPapers: [makePaperRef(21, 20)],
          },
        },
        { messageId: 2, role: "assistant", text: "a", timestamp: 2 },
      ]);
    });

    it("maps an unprefixed anchor to the base document's parent item", function () {
      const resolve = createWritingSourceResolver({
        conversationKey: CONVERSATION_KEY,
        messageId: 2,
      });
      assert.equal(resolve({ page: 3 })?.id, "10");
      assert.equal(resolve({ page: 3 })?.title, "Base paper");
    });

    it("maps SN to the Nth supplemental paper's parent item", function () {
      const resolve = createWritingSourceResolver({
        conversationKey: CONVERSATION_KEY,
        messageId: 2,
      });
      assert.equal(resolve({ sourceId: "S1", page: 9 })?.id, "20");
      assert.isNull(resolve({ sourceId: "S2", page: 9 }));
    });

    it("returns null when nothing identifies the conversation", function () {
      const resolve = createWritingSourceResolver({});
      assert.isNull(resolve({ page: 3 }));
    });
  });

  describe("findLatestAssistantMessage", function () {
    const history: Message[] = [
      { messageId: 1, role: "user", text: "q1", timestamp: 1 },
      { messageId: 2, role: "assistant", text: "first", timestamp: 2 },
      { messageId: 3, role: "user", text: "q2", timestamp: 3 },
      { messageId: 4, role: "assistant", text: "second", timestamp: 4 },
    ];

    it("takes the newest finished answer", function () {
      assert.equal(findLatestAssistantMessage(history)?.messageId, 4);
    });

    it("skips a streaming or empty answer", function () {
      assert.equal(
        findLatestAssistantMessage([
          ...history,
          { messageId: 5, role: "assistant", text: "", timestamp: 5 },
          {
            messageId: 6,
            role: "assistant",
            text: "half",
            timestamp: 6,
            streaming: true,
          },
        ])?.messageId,
        4,
      );
    });

    it("returns null without any answer", function () {
      assert.isNull(findLatestAssistantMessage([history[0]]));
      assert.isNull(findLatestAssistantMessage([]));
      assert.isNull(findLatestAssistantMessage(undefined));
    });
  });

  describe("buildWritingDraftForMessage", function () {
    it("resolves anchors against the turn the answer belongs to", function () {
      makePaper({
        id: 10,
        fields: { title: "Base paper", date: "2024", publicationTitle: "JR" },
        creators: [{ lastName: "Smith", firstName: "Jane" }],
      });
      makeAttachment({ id: 11, parentID: 10 });
      makePaper({
        id: 20,
        fields: { title: "Supplement", date: "2023" },
        creators: [{ lastName: "Jones", firstName: "Bo" }],
      });
      makeAttachment({ id: 21, parentID: 20 });
      const answer: Message = {
        messageId: 2,
        role: "assistant",
        text: "Base says X [p.3]; the other says Y [S1 p.8]; nothing here [S4 p.1].",
        timestamp: 2,
      };
      chatHistory.set(CONVERSATION_KEY, [
        {
          messageId: 1,
          role: "user",
          text: "q",
          timestamp: 1,
          contextRefs: {
            baseDocument: {
              kind: "pdf",
              itemId: 10,
              contextItemId: 11,
              title: "Base paper",
            },
            supplementalPapers: [makePaperRef(21, 20)],
          },
        },
        answer,
      ]);

      const draft = buildWritingDraftForMessage({
        message: answer,
        style: "author-year",
        lang: "en-US",
        generatedAt: "2026-08-29 10:00",
        anchorScope: { conversationKey: CONVERSATION_KEY },
      });
      assert.equal(
        draft.body,
        "Base says X (Smith, 2024, p. 3); the other says Y (Jones, 2023, p. 8); nothing here [S4 p.1].",
      );
      assert.deepEqual(
        draft.references.map((entry) => entry.source.id),
        ["20", "10"],
      );
      assert.deepEqual(draft.unresolved, [{ raw: "[S4 p.1]", count: 1 }]);
      assert.include(draft.markdown, "## References");
      assert.include(draft.markdown, "- Smith, J. (2024). Base paper. JR.");
    });
  });
});
