/**
 * Citation import — the Zotero side of "Import to Zotero" for cited works.
 *
 * Citation insight pins the cited papers the user already owns. The ones it
 * could not find are offered here, in the panel notice, as one-click imports:
 * metadata from Crossref (OpenAlex when Crossref has nothing or cannot be
 * reached), a duplicate check against the library, then a new regular item in
 * the source paper's library. When Zotero's own "download associated files"
 * preference is on, the importer also asks Zotero to find an open-access PDF
 * and, if one arrives, pins the new paper as supplemental context.
 *
 * The request URLs, response picking, duplicate rules and field mapping are
 * pure and live in `utils/citationImport.ts`.
 */

import {
  buildCrossrefLookup,
  buildOpenAlexLookup,
  buildZoteroItemDraft,
  findDuplicateWork,
  normalizeDoiKey,
  pickCrossrefItem,
  pickOpenAlexItem,
  summarizeImportOutcomes,
  type CitationImportOutcome,
  type ImportableBibliographicItem,
  type ImportableReference,
  type MetadataLookupRequest,
  type MetadataSource,
} from "../../utils/citationImport";
import { buildLibraryTitleQueries } from "../../utils/citationInsight";
import {
  classifyLookupError,
  resolveRateLimitWaitMinutes,
  type LookupFailureKind,
  type LookupHttpError,
} from "../../utils/lookupErrors";
import { getPanelI18n } from "./i18n";
import { fetchLookupJson } from "./lookupFetch";
import { showPanelNotice, type NoticeAction } from "./notice";

export const CITATION_IMPORT_NOTICE_SOURCE = "citation-import";

/** Per-reference buttons in the offer; the rest are reached by "Import all". */
const OFFER_MAX_BUTTONS = 3;

/** Library hits examined per duplicate query. */
const DUPLICATE_CANDIDATES = 20;

const OFFER_TITLE_MAX = 80;

export type CitationImportContext = {
  /** Any element inside the panel; the notice is found from it. */
  anchor: Element;
  libraryID: number;
  /** Pin an item as supplemental paper context; false when it has no file. */
  attachAsContext: (item: Zotero.Item) => boolean;
};

type ResolvedMetadata = {
  item: ImportableBibliographicItem;
  source: MetadataSource;
};

type LookupStep = {
  source: MetadataSource;
  build: (reference: ImportableReference) => MetadataLookupRequest | null;
  pick: (
    json: unknown,
    request: MetadataLookupRequest,
    titleGuess: string,
  ) => ImportableBibliographicItem | null;
};

const LOOKUP_STEPS: LookupStep[] = [
  { source: "Crossref", build: buildCrossrefLookup, pick: pickCrossrefItem },
  { source: "OpenAlex", build: buildOpenAlexLookup, pick: pickOpenAlexItem },
];

/** A failed lookup, carried as an outcome rather than thrown. */
class LookupFailure extends Error {
  constructor(
    readonly failure: LookupFailureKind,
    readonly service: string,
    readonly waitMinutes: number | null,
  ) {
    super(failure);
  }
}

function truncateTitle(title: string): string {
  const clean = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > OFFER_TITLE_MAX
    ? `${clean.slice(0, OFFER_TITLE_MAX - 1)}…`
    : clean;
}

function log(message: string, err?: unknown): void {
  try {
    ztoolkit.log(`LLM: ${message}`, err ?? "");
  } catch {
    /* no toolkit */
  }
}

/**
 * Metadata for one reference: Crossref first, OpenAlex second.
 *
 * A DOI that Crossref does not know (404) is "no record", not a failure. Only
 * when no service answered at all is the last network failure reported, so
 * "offline" is never shown for a lookup OpenAlex actually answered.
 */
async function resolveMetadata(
  reference: ImportableReference,
): Promise<ResolvedMetadata | null> {
  let lastFailure: { error: unknown; service: string } | null = null;
  let answered = false;
  for (const step of LOOKUP_STEPS) {
    const request = step.build(reference);
    if (!request) continue;
    try {
      const json = await fetchLookupJson(request.url);
      answered = true;
      const item = step.pick(json, request, reference.titleGuess);
      if (item) return { item, source: step.source };
    } catch (err) {
      const status = (err as LookupHttpError)?.status;
      if (status === 404) {
        answered = true;
        continue;
      }
      log(`${step.source} lookup failed`, err);
      lastFailure = { error: err, service: step.source };
    }
  }
  if (!answered && lastFailure) {
    const reset = (lastFailure.error as LookupHttpError)?.rateLimitReset;
    throw new LookupFailure(
      classifyLookupError(lastFailure.error),
      lastFailure.service,
      resolveRateLimitWaitMinutes(reset, Date.now()),
    );
  }
  return null;
}

async function searchLibrary(
  libraryID: number,
  field: string,
  value: string,
): Promise<Zotero.Item[]> {
  try {
    const search = new Zotero.Search({ libraryID });
    search.addCondition(field as any, "contains", value);
    const ids: number[] = await search.search();
    const items = await Zotero.Items.getAsync(
      ids.slice(0, DUPLICATE_CANDIDATES),
    );
    return (items as Zotero.Item[]).filter(
      (entry) => entry?.isRegularItem?.() && !entry.deleted,
    );
  } catch (err) {
    log(`library ${field} search failed`, err);
    return [];
  }
}

function identityOf(item: Zotero.Item): { DOI: string; title: string } {
  let DOI = "";
  let title = "";
  try {
    DOI = String(item.getField("DOI") || "");
  } catch {
    /* type without a DOI field */
  }
  if (!DOI) {
    try {
      const extra = String(item.getField("extra") || "");
      DOI = extra.match(/^DOI:\s*(\S+)/im)?.[1] || "";
    } catch {
      /* no extra */
    }
  }
  try {
    title = String(item.getField("title") || "");
  } catch {
    /* ignore */
  }
  return { DOI, title };
}

/** The library item that already is this work, if there is one. */
async function findExistingItem(
  libraryID: number,
  work: { DOI?: string; title: string },
): Promise<Zotero.Item | null> {
  const candidates: Zotero.Item[] = [];
  const doi = normalizeDoiKey(work.DOI);
  if (doi) {
    candidates.push(...(await searchLibrary(libraryID, "DOI", doi)));
    candidates.push(...(await searchLibrary(libraryID, "extra", doi)));
  }
  for (const query of buildLibraryTitleQueries(work.title)) {
    candidates.push(...(await searchLibrary(libraryID, "title", query)));
  }
  const identified = candidates.map((item) => ({
    item,
    ...identityOf(item),
  }));
  return findDuplicateWork(work, identified)?.item || null;
}

function itemTypeExists(itemType: string): boolean {
  try {
    return Boolean((Zotero as any).ItemTypes.getID(itemType));
  } catch {
    return false;
  }
}

function isValidFieldForType(itemType: string, field: string): boolean {
  const z = Zotero as any;
  const typeID = z.ItemTypes.getID(itemType);
  const fieldID = z.ItemFields.getID(field);
  if (!typeID || !fieldID) return false;
  return Boolean(z.ItemFields.isValidForType(fieldID, typeID));
}

async function createItem(
  libraryID: number,
  resolved: ResolvedMetadata,
): Promise<Zotero.Item> {
  const bib: ImportableBibliographicItem = itemTypeExists(
    resolved.item.itemType,
  )
    ? resolved.item
    : { ...resolved.item, itemType: "journalArticle" };
  const draft = buildZoteroItemDraft(bib, resolved.source, isValidFieldForType);
  const item = new Zotero.Item(draft.itemType as any);
  item.libraryID = libraryID;
  for (const [field, value] of draft.fields) {
    item.setField(field as any, value);
  }
  if (draft.extraLines.length) {
    item.setField("extra", draft.extraLines.join("\n"));
  }
  if (draft.creators.length) {
    item.setCreators(
      draft.creators.map((creator) => ({
        creatorType: creator.creatorType,
        firstName: creator.firstName || "",
        lastName: creator.lastName,
      })) as any,
    );
  }
  await item.saveTx();
  return item;
}

/**
 * Let Zotero look for an open-access PDF, the way it does after a connector
 * save — and only when the user left that behaviour on.
 */
async function findPdfAndAttach(
  context: CitationImportContext,
  item: Zotero.Item,
  title: string,
): Promise<void> {
  try {
    if (!Zotero.Prefs.get("downloadAssociatedFiles")) return;
    const attachments = (Zotero as any).Attachments;
    const find =
      attachments?.addAvailableFile?.bind(attachments) ||
      attachments?.addAvailablePDF?.bind(attachments);
    if (!find) return;
    const attachment = await find(item);
    if (!attachment) return;
    if (context.attachAsContext(item)) {
      showPanelNotice(context.anchor, {
        kind: "success",
        message: getPanelI18n().citationImportPdfAttached(truncateTitle(title)),
        source: CITATION_IMPORT_NOTICE_SOURCE,
      });
    }
  } catch (err) {
    log("finding a PDF for an imported citation failed", err);
  }
}

function selectInLibrary(itemID: number): void {
  try {
    const pane = (Zotero as any).getActiveZoteroPane?.();
    pane?.selectItem?.(itemID);
  } catch (err) {
    log("could not select the imported item", err);
  }
}

/** Import one reference; never throws. */
async function importReference(
  context: CitationImportContext,
  reference: ImportableReference,
): Promise<CitationImportOutcome & { failureInfo?: LookupFailure }> {
  // A DOI in the entry is enough to rule a duplicate out before any request.
  if (reference.doi || reference.titleGuess) {
    const existing = await findExistingItem(context.libraryID, {
      DOI: reference.doi,
      title: reference.doi ? "" : reference.titleGuess,
    });
    if (existing) {
      context.attachAsContext(existing);
      return {
        kind: "duplicate",
        title: identityOf(existing).title || reference.titleGuess,
        itemID: existing.id,
      };
    }
  }
  let resolved: ResolvedMetadata | null;
  try {
    resolved = await resolveMetadata(reference);
  } catch (err) {
    const info =
      err instanceof LookupFailure
        ? err
        : new LookupFailure(classifyLookupError(err), "Crossref", null);
    return {
      kind: "failed",
      label: reference.label,
      failure: info.failure,
      failureInfo: info,
    };
  }
  if (!resolved) return { kind: "not-found", label: reference.label };

  const existing = await findExistingItem(context.libraryID, resolved.item);
  if (existing) {
    context.attachAsContext(existing);
    return {
      kind: "duplicate",
      title: identityOf(existing).title || resolved.item.title,
      itemID: existing.id,
    };
  }
  try {
    const item = await createItem(context.libraryID, resolved);
    void findPdfAndAttach(context, item, resolved.item.title);
    return { kind: "imported", title: resolved.item.title, itemID: item.id };
  } catch (err) {
    log("creating the imported item failed", err);
    return { kind: "failed", label: reference.label, failure: "save" };
  }
}

function failureMessage(info: LookupFailure | undefined): string {
  const labels = getPanelI18n();
  const service = info?.service || "Crossref";
  switch (info?.failure) {
    case "offline":
      return labels.lookupOffline(service);
    case "timeout":
      return labels.lookupTimeout(service);
    case "rate-limited":
      return labels.lookupRateLimited(service, info.waitMinutes);
    case undefined:
      return labels.citationImportSaveFailed;
    default:
      return labels.lookupFailed(service);
  }
}

function showWorking(context: CitationImportContext, message: string): void {
  showPanelNotice(context.anchor, {
    kind: "info",
    message,
    persist: true,
    source: CITATION_IMPORT_NOTICE_SOURCE,
  });
}

async function runSingleImport(
  context: CitationImportContext,
  reference: ImportableReference,
  offer: ImportableReference[],
): Promise<void> {
  const labels = getPanelI18n();
  showWorking(context, labels.citationImportWorking(reference.label));
  const outcome = await importReference(context, reference);
  const rest = offer.filter((entry) => entry !== reference);
  const offerRest: NoticeAction[] = rest.length
    ? [
        {
          label: labels.citationImportAll(rest.length),
          onClick: () => void runBatchImport(context, rest),
        },
      ]
    : [];
  if (outcome.kind === "imported" || outcome.kind === "duplicate") {
    showPanelNotice(context.anchor, {
      kind: outcome.kind === "imported" ? "success" : "info",
      message:
        outcome.kind === "imported"
          ? labels.citationImportDone(truncateTitle(outcome.title))
          : labels.citationImportDuplicate(truncateTitle(outcome.title)),
      source: CITATION_IMPORT_NOTICE_SOURCE,
      actions: [
        {
          label: labels.citationImportShow,
          onClick: () => selectInLibrary(outcome.itemID),
        },
        ...offerRest,
      ],
    });
    return;
  }
  if (outcome.kind === "not-found") {
    showPanelNotice(context.anchor, {
      kind: "warning",
      message: labels.citationImportNotFound(reference.label),
      source: CITATION_IMPORT_NOTICE_SOURCE,
      actions: offerRest,
    });
    return;
  }
  showPanelNotice(context.anchor, {
    kind: "error",
    message: failureMessage(outcome.failureInfo),
    source: CITATION_IMPORT_NOTICE_SOURCE,
    actions: [
      {
        label: labels.lookupRetry,
        primary: true,
        onClick: () => void runSingleImport(context, reference, offer),
      },
    ],
  });
}

async function runBatchImport(
  context: CitationImportContext,
  references: ImportableReference[],
): Promise<void> {
  const labels = getPanelI18n();
  const outcomes: CitationImportOutcome[] = [];
  const failedRefs: ImportableReference[] = [];
  let lastFailure: LookupFailure | undefined;
  for (let i = 0; i < references.length; i += 1) {
    showWorking(
      context,
      labels.citationImportWorkingMany(i + 1, references.length),
    );
    const outcome = await importReference(context, references[i]);
    outcomes.push(outcome);
    if (outcome.kind === "failed") {
      failedRefs.push(references[i]);
      lastFailure = outcome.failureInfo || lastFailure;
      // Offline or rate-limited: every further request fails the same way.
      if (outcome.failure === "offline" || outcome.failure === "rate-limited") {
        failedRefs.push(...references.slice(i + 1));
        break;
      }
    }
  }
  const summary = summarizeImportOutcomes(outcomes);
  // Requests skipped after an offline/rate-limit failure count as failed.
  const failedTotal = failedRefs.length;
  const parts = [
    labels.citationImportSummary(
      summary.imported,
      summary.duplicates,
      summary.notFound,
      failedTotal,
    ),
  ];
  if (failedTotal && lastFailure) parts.push(failureMessage(lastFailure));
  showPanelNotice(context.anchor, {
    kind: failedTotal && !summary.imported ? "error" : summary.noticeKind,
    message: parts.join(" — "),
    source: CITATION_IMPORT_NOTICE_SOURCE,
    actions: failedRefs.length
      ? [
          {
            label: labels.lookupRetry,
            primary: true,
            onClick: () => void runBatchImport(context, failedRefs),
          },
        ]
      : [],
  });
}

/**
 * Offer the references citation insight could not find in the library.
 *
 * One reference gets a single "Import to Zotero" button; several get a button
 * per marker (the first few, labelled as the passage printed them) plus
 * "Import all". The notice carries actions, so it stays until used or closed.
 */
export function offerCitationImports(
  context: CitationImportContext,
  references: ImportableReference[],
): boolean {
  if (!references.length || !context.libraryID) return false;
  const labels = getPanelI18n();
  if (references.length === 1) {
    const [only] = references;
    return showPanelNotice(context.anchor, {
      kind: "info",
      message: labels.citationImportOfferOne(
        only.label,
        truncateTitle(only.titleGuess || only.doi || ""),
      ),
      source: CITATION_IMPORT_NOTICE_SOURCE,
      actions: [
        {
          label: labels.citationImportAction,
          primary: true,
          onClick: () => void runSingleImport(context, only, references),
        },
      ],
    });
  }
  const actions: NoticeAction[] = references
    .slice(0, OFFER_MAX_BUTTONS)
    .map((reference) => ({
      label: labels.citationImportActionFor(reference.label),
      onClick: () => void runSingleImport(context, reference, references),
    }));
  actions.push({
    label: labels.citationImportAll(references.length),
    primary: true,
    onClick: () => void runBatchImport(context, references),
  });
  return showPanelNotice(context.anchor, {
    kind: "info",
    message: labels.citationImportOfferMany(references.length),
    source: CITATION_IMPORT_NOTICE_SOURCE,
    actions,
  });
}
