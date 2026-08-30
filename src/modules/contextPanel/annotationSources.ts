/**
 * Read the reader's own annotations off Zotero items.
 *
 * The panel item is either the attachment a reader tab is showing or the
 * regular item selected in the library, so both are resolved to the one
 * attachment whose annotations should be used. Every lookup fails softly:
 * annotations are an optional context source, never a reason to break a send.
 *
 * The formatting, ordering, and truncation rules live in
 * `utils/annotationContext.ts` so they stay testable without a Zotero runtime.
 */

import {
  normalizeAnnotationRecords,
  type AnnotationRecord,
} from "../../utils/annotationContext";
import { getZoteroItem } from "../../utils/zoteroItems";
import { getDocumentAdapterForItem } from "./document/registry";

export type AnnotationSource = {
  /** Attachment the annotations belong to. */
  attachmentId: number;
  /** Parent title when available, so the chip names the paper, not the file. */
  title: string;
  records: AnnotationRecord[];
};

function normalizeItemId(value: unknown): number | null {
  const id = Number(value);
  if (!Number.isFinite(id)) return null;
  const normalized = Math.floor(id);
  return normalized > 0 ? normalized : null;
}

/**
 * Attachment whose annotations back the panel item.
 *
 * A reader tab hands over the attachment itself. For a regular item the first
 * readable attachment wins, preferring PDF when several formats exist so the
 * choice matches the reader's own default. Group libraries need no special
 * handling — annotations of other members are stored as ordinary child items.
 */
export function resolveAnnotationAttachment(
  item: Zotero.Item | null | undefined,
): Zotero.Item | null {
  if (!item) return null;
  try {
    if (item.isAttachment?.()) {
      return getDocumentAdapterForItem(item) ? item : null;
    }
    if (!item.isRegularItem?.()) return null;

    const readable: Zotero.Item[] = [];
    for (const attachmentId of item.getAttachments()) {
      const attachment = getZoteroItem(attachmentId);
      if (attachment && getDocumentAdapterForItem(attachment)) {
        readable.push(attachment);
      }
    }
    if (!readable.length) return null;
    return (
      readable.find(
        (attachment) => getDocumentAdapterForItem(attachment)?.kind === "pdf",
      ) || readable[0]
    );
  } catch (err) {
    ztoolkit.log("LLM: annotation attachment resolution failed", err);
    return null;
  }
}

/**
 * Zero-based physical page of an annotation.
 *
 * Only PDF positions carry `pageIndex`; EPUB and snapshot positions describe a
 * DOM range instead, so those simply have no page and fall back to the label.
 */
function readAnnotationPageIndex(annotation: Zotero.Item): number | null {
  try {
    const raw = annotation.annotationPosition;
    if (typeof raw !== "string" || !raw.trim()) return null;
    const position = JSON.parse(raw) as { pageIndex?: unknown };
    const pageIndex = Number(position?.pageIndex);
    return Number.isFinite(pageIndex) ? Math.floor(pageIndex) : null;
  } catch {
    return null;
  }
}

/** Read every usable annotation of one attachment, in reading order. */
export function readAnnotationRecords(
  attachment: Zotero.Item | null | undefined,
): AnnotationRecord[] {
  if (!attachment?.isAttachment?.()) return [];
  let annotations: Zotero.Item[];
  try {
    annotations = attachment.getAnnotations?.(false) || [];
  } catch (err) {
    ztoolkit.log("LLM: failed to read annotations", err);
    return [];
  }

  const raws = annotations.map((annotation) => {
    try {
      return {
        key: annotation.key,
        type: annotation.annotationType,
        text: annotation.annotationText,
        comment: annotation.annotationComment,
        pageLabel: annotation.annotationPageLabel,
        pageIndex: readAnnotationPageIndex(annotation),
        color: annotation.annotationColor,
        sortIndex: annotation.annotationSortIndex,
      };
    } catch (err) {
      // A single unreadable annotation must not cost the user the rest.
      ztoolkit.log("LLM: skipped unreadable annotation", err);
      return null;
    }
  });
  return normalizeAnnotationRecords(raws);
}

/** Title for the chip and the context header: parent item first, then file. */
function resolveAnnotationTitle(attachment: Zotero.Item): string {
  try {
    const parent = attachment.parentID
      ? getZoteroItem(attachment.parentID)
      : null;
    return (
      (parent ? parent.getField("title") : "") ||
      attachment.getField("title") ||
      ""
    );
  } catch {
    return "";
  }
}

/**
 * Collect the annotation context for a panel item.
 *
 * Returns null only when no attachment could be resolved; an attachment with
 * no annotations yields a source with an empty record list so callers can tell
 * "nothing marked yet" apart from "nothing to read".
 */
export function collectAnnotationSource(
  item: Zotero.Item | null | undefined,
): AnnotationSource | null {
  const attachment = resolveAnnotationAttachment(item);
  const attachmentId = normalizeItemId(attachment?.id);
  if (!attachment || attachmentId === null) return null;
  return {
    attachmentId,
    title: resolveAnnotationTitle(attachment),
    records: readAnnotationRecords(attachment),
  };
}
