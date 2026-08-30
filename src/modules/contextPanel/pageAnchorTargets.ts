/**
 * Resolve page anchors emitted by the model back to Zotero attachments.
 *
 * `[p.12]` points at the conversation's base document and `[S2 p.12]` at the
 * second supplemental paper, matching the `Anchor ID` tokens injected into the
 * supplemental context blocks. Every lookup fails softly: an anchor that
 * cannot be resolved stays inert text instead of breaking chat rendering.
 */

import {
  buildOpenPdfUrl,
  parseSupplementalAnchorPosition,
  type PageAnchor,
} from "../../utils/pageAnchors";
import { getZoteroItem } from "../../utils/zoteroItems";
import { getConversationKey } from "./chatScroll";
import { getDocumentAdapterForItem } from "./document/registry";
import { chatHistory, conversationContextPool } from "./state";
import type { Message } from "./types";

export type PageAnchorScope = {
  /** Attachment backing unprefixed `[p.N]` anchors. */
  baseAttachmentId: number | null;
  /** Supplemental attachments in `S1, S2, …` order. */
  supplementalAttachmentIds: number[];
};

export type PageAnchorScopeOptions = {
  /** Panel item used to derive the conversation and a base-document fallback. */
  item?: Zotero.Item | null;
  /** Explicit conversation key; derived from `item` when omitted. */
  conversationKey?: number | null;
  /** Assistant message the anchor belongs to, for turn-accurate resolution. */
  messageId?: number | null;
};

const EMPTY_SCOPE: PageAnchorScope = {
  baseAttachmentId: null,
  supplementalAttachmentIds: [],
};

function normalizeItemId(value: unknown): number | null {
  const id = Number(value);
  if (!Number.isFinite(id)) return null;
  const normalized = Math.floor(id);
  return normalized > 0 ? normalized : null;
}

function resolveConversationKey(
  options: PageAnchorScopeOptions,
): number | null {
  if (Number.isFinite(options.conversationKey)) {
    return options.conversationKey as number;
  }
  if (!options.item) return null;
  try {
    return getConversationKey(options.item);
  } catch {
    return null;
  }
}

/**
 * Context refs are persisted on user messages, so an assistant answer inherits
 * the scope of the user turn that produced it.
 */
function findContextRefsForMessage(
  history: readonly Message[],
  messageId: number | null,
): Message["contextRefs"] | undefined {
  if (!history.length) return undefined;
  let end = history.length;
  if (messageId !== null) {
    const index = history.findIndex((entry) => entry.messageId === messageId);
    if (index >= 0) end = index + 1;
  }
  for (let index = end - 1; index >= 0; index--) {
    const message = history[index];
    if (message.role === "user" && message.contextRefs) {
      return message.contextRefs;
    }
  }
  return undefined;
}

/** First readable attachment of an item, preferring the item itself. */
function resolveReadableAttachmentId(
  item: Zotero.Item | null | undefined,
): number | null {
  if (!item) return null;
  try {
    if (item.isAttachment?.()) {
      return getDocumentAdapterForItem(item) ? normalizeItemId(item.id) : null;
    }
    if (!item.isRegularItem?.()) return null;
    for (const attachmentId of item.getAttachments()) {
      const attachment = getZoteroItem(attachmentId);
      if (attachment && getDocumentAdapterForItem(attachment)) {
        return normalizeItemId(attachment.id);
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Build the anchor scope for one message.
 *
 * The stored context refs of the originating turn win, because the live pool
 * changes as the user pins and unpins papers. The pool and the panel item are
 * fallbacks for conversations whose refs were never persisted.
 */
export function buildPageAnchorScope(
  options: PageAnchorScopeOptions = {},
): PageAnchorScope {
  const conversationKey = resolveConversationKey(options);
  if (conversationKey === null && !options.item) return EMPTY_SCOPE;

  const history =
    conversationKey === null ? [] : chatHistory.get(conversationKey) || [];
  const contextRefs = findContextRefsForMessage(
    history,
    Number.isFinite(options.messageId) ? (options.messageId as number) : null,
  );
  const pool =
    conversationKey === null
      ? undefined
      : conversationContextPool.get(conversationKey);

  const storedBase =
    contextRefs?.baseDocument?.contextItemId ??
    contextRefs?.basePdf?.contextItemId;
  const baseAttachmentId =
    normalizeItemId(storedBase) ??
    normalizeItemId(pool?.basePdfItemId) ??
    resolveReadableAttachmentId(options.item);

  const storedSupplementals = contextRefs?.supplementalPapers;
  const supplementalRefs =
    storedSupplementals && storedSupplementals.length
      ? storedSupplementals
      : [...(pool?.supplementalContexts.values() || [])].map(
          (entry) => entry.ref,
        );
  const supplementalAttachmentIds = supplementalRefs.map(
    (ref) => normalizeItemId(ref?.contextItemId) ?? 0,
  );

  return { baseAttachmentId, supplementalAttachmentIds };
}

/** Attachment a single anchor points at, or null when it cannot be placed. */
export function resolvePageAnchorAttachmentId(
  scope: PageAnchorScope,
  anchor: PageAnchor,
): number | null {
  if (!anchor.sourceId) return scope.baseAttachmentId;
  const position = parseSupplementalAnchorPosition(anchor.sourceId);
  if (position === null) return null;
  return normalizeItemId(scope.supplementalAttachmentIds[position - 1]);
}

/** `zotero://open-pdf` URL for an attachment, honouring group libraries. */
export function buildOpenPdfUrlForAttachment(
  attachmentId: number | null,
  page: number,
): string | null {
  if (attachmentId === null) return null;
  try {
    const attachment = getZoteroItem(attachmentId);
    if (!attachment?.isAttachment?.()) return null;
    const itemKey = String(attachment.key || "").trim();
    if (!itemKey) return null;

    let groupID: number | null = null;
    const libraryID = Number(attachment.libraryID);
    if (Number.isFinite(libraryID)) {
      const library = (
        Zotero as unknown as {
          Libraries?: {
            get?: (id: number) => { groupID?: number } | false | null;
          };
        }
      ).Libraries?.get?.(libraryID);
      const rawGroupID = Number(
        library && typeof library === "object" ? library.groupID : NaN,
      );
      if (Number.isFinite(rawGroupID) && rawGroupID > 0) groupID = rawGroupID;
    }
    return buildOpenPdfUrl({ itemKey, page, groupID });
  } catch (err) {
    ztoolkit.log("LLM: page anchor URL build failed", err);
    return null;
  }
}

/**
 * Resolver handed to `renderMarkdownForNote` so exported notes keep their
 * page citations clickable inside Zotero.
 */
export function createPageAnchorHrefResolver(
  options: PageAnchorScopeOptions = {},
): (anchor: PageAnchor) => string | null {
  let scope: PageAnchorScope | null = null;
  return (anchor) => {
    try {
      if (!scope) scope = buildPageAnchorScope(options);
      const attachmentId = resolvePageAnchorAttachmentId(scope, anchor);
      return buildOpenPdfUrlForAttachment(attachmentId, anchor.page);
    } catch {
      return null;
    }
  };
}

/**
 * Jump the reader to an anchor's page.
 *
 * `Zotero.Reader.open` already covers every case: it selects an open tab and
 * navigates it, restores an unloaded tab at the requested location, or opens a
 * new one. The protocol URL is only used when that API is unavailable.
 */
export function navigateToPageAnchor(
  scope: PageAnchorScope,
  anchor: PageAnchor,
): boolean {
  const attachmentId = resolvePageAnchorAttachmentId(scope, anchor);
  if (attachmentId === null) return false;

  const location = { pageIndex: Math.max(0, anchor.page - 1) };
  try {
    const open = Zotero.Reader?.open;
    if (typeof open === "function") {
      void Promise.resolve(
        open.call(Zotero.Reader, attachmentId, location),
      ).catch((err: unknown) => {
        ztoolkit.log("LLM: page anchor reader navigation failed", err);
      });
      return true;
    }
  } catch (err) {
    ztoolkit.log("LLM: page anchor reader navigation failed", err);
  }

  const url = buildOpenPdfUrlForAttachment(attachmentId, anchor.page);
  if (!url) return false;
  try {
    const pane = (
      Zotero as unknown as {
        getActiveZoteroPane?: () => { loadURI?: (uri: string) => void } | null;
      }
    ).getActiveZoteroPane?.();
    if (typeof pane?.loadURI === "function") {
      pane.loadURI(url);
      return true;
    }
    Zotero.launchURL(url);
    return true;
  } catch (err) {
    ztoolkit.log("LLM: page anchor protocol navigation failed", err);
    return false;
  }
}
