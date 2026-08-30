import { assert } from "chai";

import {
  buildOpenPdfUrlForAttachment,
  buildPageAnchorScope,
  createPageAnchorHrefResolver,
  navigateToPageAnchor,
  resolvePageAnchorAttachmentId,
} from "../src/modules/contextPanel/pageAnchorTargets";
import {
  chatHistory,
  conversationContextPool,
} from "../src/modules/contextPanel/state";
import type {
  Message,
  PaperContextRef,
} from "../src/modules/contextPanel/types";

const PDF_CONTENT_TYPE = "application/pdf";
const CONVERSATION_KEY = 4242;

const originalZotero = (globalThis as Record<string, unknown>).Zotero;
const originalZtoolkit = (globalThis as Record<string, unknown>).ztoolkit;

type StubItem = Zotero.Item & { id: number };

const itemsById = new Map<number, StubItem>();
const readerOpenCalls: Array<{ itemID: number; location: unknown }> = [];
const loadedUris: string[] = [];

function makeAttachment(params: {
  id: number;
  key?: string;
  libraryID?: number;
  contentType?: string;
}): StubItem {
  const item = {
    id: params.id,
    key: params.key ?? `KEY${params.id}`,
    libraryID: params.libraryID ?? 1,
    parentID: null,
    attachmentContentType: params.contentType ?? PDF_CONTENT_TYPE,
    isAttachment: () => true,
    isRegularItem: () => false,
    getAttachments: () => {
      throw new Error("attachment getAttachments() must not be called");
    },
    getField: () => "",
  } as unknown as StubItem;
  itemsById.set(item.id, item);
  return item;
}

function makeRegularItem(params: {
  id: number;
  attachmentIds: number[];
}): StubItem {
  const item = {
    id: params.id,
    key: `KEY${params.id}`,
    libraryID: 1,
    parentID: null,
    isAttachment: () => false,
    isRegularItem: () => true,
    getAttachments: () => params.attachmentIds,
    getField: () => "",
  } as unknown as StubItem;
  itemsById.set(item.id, item);
  return item;
}

function makePaperRef(contextItemId: number): PaperContextRef {
  return {
    itemId: contextItemId - 1,
    contextItemId,
    title: `Paper ${contextItemId}`,
  };
}

function setHistory(messages: Message[]): void {
  chatHistory.set(CONVERSATION_KEY, messages);
}

describe("page anchor targets", function () {
  beforeEach(function () {
    itemsById.clear();
    readerOpenCalls.length = 0;
    loadedUris.length = 0;
    chatHistory.delete(CONVERSATION_KEY);
    conversationContextPool.delete(CONVERSATION_KEY);
    (globalThis as Record<string, unknown>).ztoolkit = { log: () => undefined };
    (globalThis as Record<string, unknown>).Zotero = {
      Items: { get: (id: number) => itemsById.get(id) || false },
      Libraries: { get: () => ({}) },
      Reader: {
        open: (itemID: number, location: unknown) => {
          readerOpenCalls.push({ itemID, location });
          return Promise.resolve();
        },
      },
      getActiveZoteroPane: () => ({
        loadURI: (uri: string) => loadedUris.push(uri),
      }),
      launchURL: (uri: string) => loadedUris.push(uri),
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

  describe("buildPageAnchorScope", function () {
    it("uses the context refs of the user turn that produced the answer", function () {
      setHistory([
        {
          messageId: 1,
          role: "user",
          text: "first",
          timestamp: 1,
          contextRefs: {
            basePdf: { itemId: 10, contextItemId: 11, title: "Old" },
            supplementalPapers: [makePaperRef(21)],
          },
        },
        { messageId: 2, role: "assistant", text: "answer", timestamp: 2 },
        {
          messageId: 3,
          role: "user",
          text: "second",
          timestamp: 3,
          contextRefs: {
            baseDocument: {
              kind: "pdf",
              itemId: 30,
              contextItemId: 31,
              title: "New",
            },
            supplementalPapers: [makePaperRef(41), makePaperRef(42)],
          },
        },
        { messageId: 4, role: "assistant", text: "answer", timestamp: 4 },
      ]);

      const older = buildPageAnchorScope({
        conversationKey: CONVERSATION_KEY,
        messageId: 2,
      });
      assert.equal(older.baseAttachmentId, 11);
      assert.deepEqual(older.supplementalAttachmentIds, [21]);

      const newer = buildPageAnchorScope({
        conversationKey: CONVERSATION_KEY,
        messageId: 4,
      });
      assert.equal(newer.baseAttachmentId, 31);
      assert.deepEqual(newer.supplementalAttachmentIds, [41, 42]);
    });

    it("falls back to the live pool when no refs were persisted", function () {
      conversationContextPool.set(CONVERSATION_KEY, {
        basePdfContext: "",
        basePdfItemId: 77,
        basePdfTitle: "Pooled",
        basePdfRemoved: false,
        baseDocumentKind: "pdf",
        baseDocumentSegmentIds: [],
        supplementalContexts: new Map([
          [
            88,
            {
              ref: makePaperRef(88),
              builtContext: "text",
              addedAtTurn: 1,
            },
          ],
        ]),
      });

      const scope = buildPageAnchorScope({ conversationKey: CONVERSATION_KEY });
      assert.equal(scope.baseAttachmentId, 77);
      assert.deepEqual(scope.supplementalAttachmentIds, [88]);
    });

    it("falls back to the panel item's own readable attachment", function () {
      makeAttachment({ id: 101 });
      const parent = makeRegularItem({ id: 100, attachmentIds: [101] });

      const scope = buildPageAnchorScope({
        item: parent,
        conversationKey: CONVERSATION_KEY,
      });
      assert.equal(scope.baseAttachmentId, 101);
      assert.deepEqual(scope.supplementalAttachmentIds, []);
    });

    it("returns an empty scope when nothing identifies the conversation", function () {
      const scope = buildPageAnchorScope({});
      assert.isNull(scope.baseAttachmentId);
      assert.deepEqual(scope.supplementalAttachmentIds, []);
    });
  });

  describe("resolvePageAnchorAttachmentId", function () {
    const scope = {
      baseAttachmentId: 11,
      supplementalAttachmentIds: [21, 22],
    };

    it("maps an unprefixed anchor to the base document", function () {
      assert.equal(resolvePageAnchorAttachmentId(scope, { page: 3 }), 11);
    });

    it("maps SN to the Nth supplemental paper", function () {
      assert.equal(
        resolvePageAnchorAttachmentId(scope, { sourceId: "S1", page: 3 }),
        21,
      );
      assert.equal(
        resolvePageAnchorAttachmentId(scope, { sourceId: "S2", page: 3 }),
        22,
      );
    });

    it("returns null for out-of-range and malformed sources", function () {
      assert.isNull(
        resolvePageAnchorAttachmentId(scope, { sourceId: "S3", page: 3 }),
      );
      assert.isNull(
        resolvePageAnchorAttachmentId(scope, { sourceId: "X1", page: 3 }),
      );
      assert.isNull(
        resolvePageAnchorAttachmentId(
          { baseAttachmentId: null, supplementalAttachmentIds: [] },
          { page: 3 },
        ),
      );
    });
  });

  describe("buildOpenPdfUrlForAttachment", function () {
    it("builds a user-library URL from the attachment key", function () {
      makeAttachment({ id: 11, key: "ABCD1234" });
      assert.equal(
        buildOpenPdfUrlForAttachment(11, 12),
        "zotero://open-pdf/library/items/ABCD1234?page=12",
      );
    });

    it("uses the group path for group libraries", function () {
      makeAttachment({ id: 12, key: "EFGH5678", libraryID: 5 });
      (
        globalThis as unknown as {
          Zotero: { Libraries: { get: () => unknown } };
        }
      ).Zotero.Libraries.get = () => ({ groupID: 91 });
      assert.equal(
        buildOpenPdfUrlForAttachment(12, 4),
        "zotero://open-pdf/groups/91/items/EFGH5678?page=4",
      );
    });

    it("returns null for missing or non-attachment items", function () {
      assert.isNull(buildOpenPdfUrlForAttachment(null, 3));
      assert.isNull(buildOpenPdfUrlForAttachment(999, 3));
      makeRegularItem({ id: 100, attachmentIds: [] });
      assert.isNull(buildOpenPdfUrlForAttachment(100, 3));
    });
  });

  describe("createPageAnchorHrefResolver", function () {
    it("resolves note links for base and supplemental anchors", function () {
      makeAttachment({ id: 31, key: "BASEKEY1" });
      makeAttachment({ id: 41, key: "SUPPKEY1" });
      setHistory([
        {
          messageId: 1,
          role: "user",
          text: "q",
          timestamp: 1,
          contextRefs: {
            baseDocument: {
              kind: "pdf",
              itemId: 30,
              contextItemId: 31,
              title: "Base",
            },
            supplementalPapers: [makePaperRef(41)],
          },
        },
      ]);

      const resolve = createPageAnchorHrefResolver({
        conversationKey: CONVERSATION_KEY,
      });
      assert.equal(
        resolve({ page: 2 }),
        "zotero://open-pdf/library/items/BASEKEY1?page=2",
      );
      assert.equal(
        resolve({ sourceId: "S1", page: 9 }),
        "zotero://open-pdf/library/items/SUPPKEY1?page=9",
      );
      assert.isNull(resolve({ sourceId: "S4", page: 9 }));
    });
  });

  describe("navigateToPageAnchor", function () {
    it("opens the reader at the zero-based page index", function () {
      makeAttachment({ id: 11, key: "ABCD1234" });
      const navigated = navigateToPageAnchor(
        { baseAttachmentId: 11, supplementalAttachmentIds: [] },
        { page: 12 },
      );
      assert.isTrue(navigated);
      assert.deepEqual(readerOpenCalls, [
        { itemID: 11, location: { pageIndex: 11 } },
      ]);
    });

    it("falls back to the zotero://open-pdf protocol without the reader API", function () {
      makeAttachment({ id: 11, key: "ABCD1234" });
      delete (globalThis as unknown as { Zotero: { Reader?: unknown } }).Zotero
        .Reader;
      const navigated = navigateToPageAnchor(
        { baseAttachmentId: 11, supplementalAttachmentIds: [] },
        { page: 3 },
      );
      assert.isTrue(navigated);
      assert.deepEqual(loadedUris, [
        "zotero://open-pdf/library/items/ABCD1234?page=3",
      ]);
    });

    it("reports failure instead of throwing when nothing resolves", function () {
      const navigated = navigateToPageAnchor(
        { baseAttachmentId: null, supplementalAttachmentIds: [] },
        { page: 3 },
      );
      assert.isFalse(navigated);
      assert.lengthOf(readerOpenCalls, 0);
      assert.lengthOf(loadedUris, 0);
    });
  });
});
