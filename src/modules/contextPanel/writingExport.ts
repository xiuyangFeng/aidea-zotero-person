/**
 * Resolve page anchors to the bibliographic items a draft has to cite.
 *
 * `pageAnchorTargets` answers "which attachment does `[S2 p.12]` open?"; this
 * module answers "which work is that?". They share one scope so a citation and
 * a page jump can never disagree about what `S2` meant: the attachment is
 * resolved exactly as the reader does, then walked up to its parent regular
 * item, which is the thing that carries creators, a year and a citation key.
 *
 * Better BibTeX is probed softly. It is a separate plugin that may be absent,
 * disabled, or a version with a different key manager, so every lookup fails
 * back to Zotero's own citation key field and, in the end, to author-year.
 */

import {
  buildWritingDraft,
  type WritingCreator,
  type WritingDraftResult,
  type WritingSource,
  type WritingSourceResolver,
  type WritingCitationStyle,
} from "../../utils/writingExport";
import { getZoteroItem } from "../../utils/zoteroItems";
import {
  buildPageAnchorScope,
  resolvePageAnchorAttachmentId,
  type PageAnchorScope,
  type PageAnchorScopeOptions,
} from "./pageAnchorTargets";
import type { Message } from "./types";

/** Fields checked, in order, for the container a work appeared in. */
const PUBLICATION_FIELDS = [
  "publicationTitle",
  "bookTitle",
  "proceedingsTitle",
  "conferenceName",
  "publisher",
  "repository",
  "institution",
  "websiteTitle",
  "blogTitle",
] as const;

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return (
    value
      // eslint-disable-next-line no-control-regex -- strips unsafe field characters
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function getFieldText(item: Zotero.Item, field: string): string {
  try {
    return normalizeText(item.getField(field) as unknown as string);
  } catch {
    return "";
  }
}

/** Whether Better BibTeX is installed and exposing a usable key manager. */
export function isBetterBibTeXAvailable(): boolean {
  try {
    const manager = (
      globalThis as {
        Zotero?: { BetterBibTeX?: { KeyManager?: unknown } };
      }
    ).Zotero?.BetterBibTeX?.KeyManager;
    return Boolean(manager && typeof manager === "object");
  } catch {
    return false;
  }
}

type BetterBibTeXKeyRecord = { citationKey?: unknown; citekey?: unknown };

/**
 * Citation key Better BibTeX assigned to an item.
 *
 * The key manager changed shape across BBT majors — `get(itemID)` on current
 * releases, a `keys` collection on older ones — so both are tried and anything
 * unexpected is treated as "no key".
 */
export function resolveBetterBibTeXCitationKey(itemId: number): string {
  try {
    const manager = (
      globalThis as {
        Zotero?: {
          BetterBibTeX?: {
            KeyManager?: {
              get?: (id: number) => BetterBibTeXKeyRecord | null | undefined;
              keys?: {
                findOne?: (
                  query: unknown,
                ) => BetterBibTeXKeyRecord | null | undefined;
              };
            };
          };
        };
      }
    ).Zotero?.BetterBibTeX?.KeyManager;
    if (!manager) return "";
    let record: BetterBibTeXKeyRecord | null | undefined = null;
    if (typeof manager.get === "function") record = manager.get(itemId);
    if (!record && typeof manager.keys?.findOne === "function") {
      record = manager.keys.findOne({ itemID: itemId });
    }
    return normalizeText(record?.citationKey ?? record?.citekey);
  } catch (err) {
    ztoolkit.log("LLM: Better BibTeX citation key lookup failed", err);
    return "";
  }
}

/** BBT first, then the citation key Zotero itself stores on the item. */
function resolveCitationKeyForItem(item: Zotero.Item): string {
  const id = Number(item.id);
  const bbtKey = Number.isFinite(id) ? resolveBetterBibTeXCitationKey(id) : "";
  return bbtKey || getFieldText(item, "citationKey");
}

function readCreators(item: Zotero.Item): WritingCreator[] {
  try {
    const creators = item.getCreators?.();
    if (!Array.isArray(creators)) return [];
    return creators.map((creator) => ({
      firstName: normalizeText(creator?.firstName),
      lastName: normalizeText(creator?.lastName),
      fieldMode: Number(creator?.fieldMode) || 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Walk an anchor's attachment up to the work it belongs to.
 *
 * A standalone attachment has no parent to walk to; it is still the best
 * identity available, and its title at least names the file the claim came
 * from.
 */
export function resolveBibliographicItem(
  attachmentId: number | null,
): Zotero.Item | null {
  if (attachmentId === null) return null;
  const item = getZoteroItem(attachmentId);
  if (!item) return null;
  try {
    if (item.isAttachment?.() && item.parentID) {
      const parent = getZoteroItem(item.parentID);
      if (parent?.isRegularItem?.()) return parent;
    }
  } catch {
    /* fall through to the attachment itself */
  }
  return item;
}

/** Denormalize a Zotero item into the record the formatters consume. */
export function buildWritingSourceFromItem(
  item: Zotero.Item | null | undefined,
): WritingSource | null {
  if (!item) return null;
  const id = Number(item.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  let publication = "";
  for (const field of PUBLICATION_FIELDS) {
    publication = getFieldText(item, field);
    if (publication) break;
  }
  const citationKey = resolveCitationKeyForItem(item);
  return {
    id: String(Math.floor(id)),
    ...(citationKey ? { citationKey } : {}),
    creators: readCreators(item),
    title: getFieldText(item, "title"),
    date:
      getFieldText(item, "date") ||
      getFieldText(item, "year") ||
      getFieldText(item, "issued"),
    ...(publication ? { publication } : {}),
  };
}

/**
 * Anchor resolver for one message.
 *
 * The scope and the per-attachment lookups are both cached: a review answer
 * cites the same handful of papers dozens of times, and each lookup otherwise
 * costs a Zotero item fetch plus a Better BibTeX round trip.
 */
export function createWritingSourceResolver(
  options: PageAnchorScopeOptions = {},
): WritingSourceResolver {
  let scope: PageAnchorScope | null = null;
  const cache = new Map<number, WritingSource | null>();
  return (anchor) => {
    try {
      if (!scope) scope = buildPageAnchorScope(options);
      const attachmentId = resolvePageAnchorAttachmentId(scope, anchor);
      if (attachmentId === null) return null;
      if (cache.has(attachmentId)) return cache.get(attachmentId) ?? null;
      const source = buildWritingSourceFromItem(
        resolveBibliographicItem(attachmentId),
      );
      cache.set(attachmentId, source);
      return source;
    } catch (err) {
      ztoolkit.log("LLM: writing draft anchor resolution failed", err);
      return null;
    }
  };
}

/**
 * Newest finished assistant answer in a conversation.
 *
 * A streaming message is skipped: exporting half an answer would drop the
 * citations that had not been written yet.
 */
export function findLatestAssistantMessage(
  history: readonly Message[] | null | undefined,
): Message | null {
  const messages = history || [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant" || message.streaming) continue;
    if (!String(message.text || "").trim()) continue;
    return message;
  }
  return null;
}

export type BuildWritingDraftForMessageOptions = {
  message: Message;
  style: WritingCitationStyle;
  lang?: string;
  generatedAt?: string;
  /** Scope options minus the message id, which is taken from `message`. */
  anchorScope?: Omit<PageAnchorScopeOptions, "messageId">;
};

/** Build the draft for one assistant answer, resolved against its own turn. */
export function buildWritingDraftForMessage(
  options: BuildWritingDraftForMessageOptions,
): WritingDraftResult {
  return buildWritingDraft({
    text: options.message.text || "",
    resolveSource: createWritingSourceResolver({
      ...(options.anchorScope || {}),
      messageId: options.message.messageId ?? null,
    }),
    style: options.style,
    lang: options.lang,
    generatedAt: options.generatedAt,
  });
}
