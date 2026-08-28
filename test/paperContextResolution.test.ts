import { assert } from "chai";
import {
  resolvePaperContextRefFromAttachment,
  resolvePaperContextRefFromLibraryItem,
} from "../src/modules/contextPanel/paperAttribution";

const PDF_CONTENT_TYPE = "application/pdf";
const EPUB_CONTENT_TYPE = "application/epub+zip";

const originalZotero = (globalThis as Record<string, unknown>).Zotero;

type StubItem = Zotero.Item & { id: number };

const itemsById = new Map<number, StubItem>();

function register<T extends StubItem>(item: T): T {
  itemsById.set(item.id, item);
  return item;
}

function makeAttachment(params: {
  id: number;
  contentType: string;
  parentID?: number | null;
  title?: string;
}): StubItem {
  return register({
    id: params.id,
    parentID: params.parentID ?? null,
    attachmentContentType: params.contentType,
    isAttachment: () => true,
    isRegularItem: () => false,
    getAttachments: () => {
      throw new Error("attachment getAttachments() must not be called");
    },
    getField: (field: string) => (field === "title" ? params.title || "" : ""),
  } as unknown as StubItem);
}

function makeRegularItem(params: {
  id: number;
  title: string;
  attachmentIds: number[];
  firstCreator?: string;
  year?: string;
}): StubItem {
  const fields: Record<string, string> = {
    title: params.title,
    firstCreator: params.firstCreator || "",
    year: params.year || "",
  };
  return register({
    id: params.id,
    parentID: null,
    isAttachment: () => false,
    isRegularItem: () => true,
    getAttachments: () => params.attachmentIds,
    getField: (field: string) => fields[field] || "",
  } as unknown as StubItem);
}

describe("paper context resolution", function () {
  beforeEach(function () {
    itemsById.clear();
    (globalThis as Record<string, unknown>).Zotero = {
      Items: { get: (id: number) => itemsById.get(id) || false },
    };
  });

  afterEach(function () {
    itemsById.clear();
    if (originalZotero === undefined) {
      delete (globalThis as Record<string, unknown>).Zotero;
    } else {
      (globalThis as Record<string, unknown>).Zotero = originalZotero;
    }
  });

  it("accepts an EPUB attachment, not only PDF", function () {
    const epub = makeAttachment({
      id: 11,
      contentType: EPUB_CONTENT_TYPE,
      title: "Some Book",
    });
    const ref = resolvePaperContextRefFromAttachment(epub);
    assert.isNotNull(ref);
    assert.equal(ref?.contextItemId, 11);
  });

  it("rejects attachments no document adapter can read", function () {
    const note = makeAttachment({ id: 12, contentType: "text/html" });
    assert.isNull(resolvePaperContextRefFromAttachment(note));
  });

  it("resolves a library item through its readable attachment", function () {
    makeAttachment({ id: 21, contentType: EPUB_CONTENT_TYPE, parentID: 20 });
    const parent = makeRegularItem({
      id: 20,
      title: "Structured Concurrency",
      attachmentIds: [21],
      firstCreator: "Chan",
      year: "2024",
    });

    const ref = resolvePaperContextRefFromLibraryItem(parent);
    assert.equal(ref?.itemId, 20);
    assert.equal(ref?.contextItemId, 21);
    assert.equal(ref?.title, "Structured Concurrency");
    assert.equal(ref?.firstCreator, "Chan");
    assert.equal(ref?.year, "2024");
  });

  it("prefers the PDF attachment when an item carries several formats", function () {
    makeAttachment({ id: 31, contentType: EPUB_CONTENT_TYPE, parentID: 30 });
    makeAttachment({ id: 32, contentType: PDF_CONTENT_TYPE, parentID: 30 });
    const parent = makeRegularItem({
      id: 30,
      title: "Dual Format Paper",
      attachmentIds: [31, 32],
    });

    assert.equal(
      resolvePaperContextRefFromLibraryItem(parent)?.contextItemId,
      32,
    );
  });

  it("returns null for items without any readable attachment", function () {
    makeAttachment({ id: 41, contentType: "text/html", parentID: 40 });
    const parent = makeRegularItem({
      id: 40,
      title: "Link Only",
      attachmentIds: [41],
    });

    assert.isNull(resolvePaperContextRefFromLibraryItem(parent));
  });
});
