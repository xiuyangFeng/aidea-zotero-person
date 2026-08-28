import {
  SUPPLEMENTAL_PAPER_CONTEXT_MAX_CHUNKS,
  SUPPLEMENTAL_PAPER_CONTEXT_MAX_LENGTH,
} from "./constants";
import { getZoteroItem } from "../../utils/zoteroItems";
import {
  buildReaderDocumentContext,
  ensureDocumentContext,
  resolveReaderDocument,
  type ReaderDocument,
} from "./documentContext";
import type { PaperContextRef } from "./types";

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

/**
 * Resolve a supplemental reference to a readable document, preferring the
 * exact attachment the user picked and falling back to the parent item's
 * first supported attachment. Any format with a document adapter works here,
 * so EPUB references carry real content instead of metadata alone.
 */
function resolveContextDocument(ref: PaperContextRef): ReaderDocument | null {
  const direct = getZoteroItem(ref.contextItemId);
  if (direct?.isAttachment?.()) {
    const directDocument = resolveReaderDocument(direct);
    if (directDocument) return directDocument;
  }
  return resolveReaderDocument(getZoteroItem(ref.itemId));
}

function formatMetadataLabel(ref: PaperContextRef, index: number): string {
  const title = normalizeText(ref.title) || `Item ${ref.itemId}`;
  const parts = [`Title: ${title}`];
  const citationKey = normalizeText(ref.citationKey);
  if (citationKey) parts.push(`Citation key: ${citationKey}`);
  const firstCreator = normalizeText(ref.firstCreator);
  if (firstCreator) parts.push(`Author: ${firstCreator}`);
  const year = normalizeText(ref.year);
  if (year) parts.push(`Year: ${year}`);
  return `Supplemental Paper ${index + 1}\n${parts.join("\n")}`;
}

/**
 * Build context for a single supplemental paper.
 * Returns a formatted block with metadata + extracted PDF content.
 */
export async function buildSinglePaperContext(
  ref: PaperContextRef,
  question: string,
  index: number,
  apiOverrides?: { apiBase?: string; apiKey?: string },
): Promise<string> {
  const metadataLabel = formatMetadataLabel(ref, index);
  try {
    const document = resolveContextDocument(ref);
    const cached = document ? await ensureDocumentContext(document) : null;
    const paperContext = document
      ? await buildReaderDocumentContext(
          document,
          cached || undefined,
          question,
          false,
          apiOverrides,
          {
            // Supplemental papers never send a whole document: several of them
            // share one request, so each contributes bounded excerpts.
            forceRetrieval: true,
            maxChunks: SUPPLEMENTAL_PAPER_CONTEXT_MAX_CHUNKS,
            maxLength: SUPPLEMENTAL_PAPER_CONTEXT_MAX_LENGTH,
          },
        )
      : "";
    if (paperContext.trim()) {
      return `${metadataLabel}\n\n${paperContext.trim()}`;
    }
    return `${metadataLabel}\n\n[No extractable PDF text available. Using metadata only.]`;
  } catch (err) {
    ztoolkit.log("LLM: Failed to build supplemental paper context", err);
    return `${metadataLabel}\n\n[Failed to build context. Using metadata only.]`;
  }
}
