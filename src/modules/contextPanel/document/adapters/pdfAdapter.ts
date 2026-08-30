import {
  injectPageMarkers,
  isPageAnchorsEnabled,
} from "../../../../utils/pageAnchors";
import type { DocumentAdapter, DocumentExtraction } from "../types";
import {
  getAttachmentContentType,
  getAttachmentSourceRevision,
  getDocumentTitle,
} from "./shared";

export const PDF_CONTENT_TYPE = "application/pdf";

const capabilities: DocumentAdapter["capabilities"] = {
  selectionText: true,
  panelChat: true,
  structuredSections: false,
  navigableLocators: false,
  screenshot: true,
  fullDocumentTranslation: true,
};

function readExtractedPageCount(result: unknown): number {
  const payload = result as
    { extractedPages?: unknown; totalPages?: unknown } | null | undefined;
  const pages = Number(payload?.extractedPages ?? payload?.totalPages);
  return Number.isFinite(pages) && pages > 0 ? Math.floor(pages) : 0;
}

async function extractPdfText(item: Zotero.Item): Promise<DocumentExtraction> {
  let text = "";
  let pageCount = 0;
  try {
    const result = await Zotero.PDFWorker.getFullText(item.id);
    if (result?.text) {
      text = result.text;
    }
    pageCount = readExtractedPageCount(result);
  } catch (err) {
    ztoolkit.log("PDF extraction failed:", err);
  }

  // Zotero's worker separates pages with a form feed, which is the only page
  // signal available here. Turning it into a short `[page N]` marker lets the
  // model cite pages the answer can jump back to.
  if (text && isPageAnchorsEnabled()) {
    text = injectPageMarkers(text, { pageCount });
  }

  return {
    text,
    completeness: text ? "complete" : "unavailable",
  };
}

/**
 * Extracted text depends on the page-anchor preference, so the toggle takes
 * part in the revision that invalidates the cached context.
 */
async function getPdfSourceRevision(
  item: Zotero.Item,
): Promise<string | undefined> {
  const revision = await getAttachmentSourceRevision(item);
  if (!revision) return revision;
  return `${revision}|pageAnchors:${isPageAnchorsEnabled() ? "on" : "off"}`;
}

export const pdfDocumentAdapter: DocumentAdapter = {
  kind: "pdf",
  contentTypes: [PDF_CONTENT_TYPE],
  capabilities,
  presentation: {
    noun: "paper",
    fullTextHeading: "Paper Full Text (complete document):",
    excerptsHeading: "Paper Text:",
    relevantSectionsNotice: "Relevant sections extracted from the document",
  },
  contextPolicy: {
    strategy: "full-or-retrieval",
    useEmbeddings: true,
    eagerWarmup: true,
  },
  selectionContextPolicy: {
    strategy: "cold-start-cache",
    allowUnattributedSelection: false,
  },
  supports(item): item is Zotero.Item {
    return Boolean(
      item?.isAttachment?.() &&
      getAttachmentContentType(item) === PDF_CONTENT_TYPE,
    );
  },
  describe(item) {
    return {
      item,
      kind: "pdf",
      title: getDocumentTitle(item),
      capabilities,
    };
  },
  getSourceRevision: getPdfSourceRevision,
  extract: extractPdfText,
};
