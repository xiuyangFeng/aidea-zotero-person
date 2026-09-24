/**
 * Citation Import — 1-click bibliographic lookup and import for cited works.
 *
 * When `citationInsight` resolves a citation marker to a reference entry that is
 * NOT present in the user's Zotero library, this module provides the capability
 * to fetch full bibliographic metadata from Crossref/OpenAlex/arXiv and format it
 * into a complete Zotero item schema (including Open Access PDF links when available).
 *
 * Everything here is pure: request URLs, response picking, duplicate checks and
 * the Zotero field mapping. The network calls and `new Zotero.Item` live in
 * `modules/contextPanel/citationImportActions.ts`.
 */

import {
  guessReferenceTitle,
  scoreTitleMatch,
  type CitationResolution,
} from "./citationInsight";

export interface ImportableCreator {
  creatorType: "author" | "editor";
  firstName?: string;
  lastName: string;
}

export interface ImportableBibliographicItem {
  itemType:
    "journalArticle" | "conferencePaper" | "book" | "preprint" | "document";
  title: string;
  creators: ImportableCreator[];
  publicationTitle?: string;
  date?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  DOI?: string;
  url?: string;
  abstractNote?: string;
  openAccessPdfUrl?: string;
}

export interface CitationImportCandidate {
  rawReferenceText: string;
  extractedDoi?: string;
  extractedTitle?: string;
  extractedAuthor?: string;
  extractedYear?: string;
}

const DOI_REGEX = /\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/;
const YEAR_REGEX = /\b(19\d{2}|20\d{2})\b/;

function normalizeWhitespace(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Parses raw reference text to extract candidates for online bibliographic retrieval.
 */
export function parseCitationForImport(
  rawReferenceText: string,
): CitationImportCandidate {
  const text = normalizeWhitespace(rawReferenceText || "");
  const doiMatch = text.match(DOI_REGEX);
  const extractedDoi = doiMatch
    ? doiMatch[1].replace(/[.,;)]+$/, "")
    : undefined;

  const yearMatch = text.match(YEAR_REGEX);
  const extractedYear = yearMatch ? yearMatch[1] : undefined;

  // Extract author snippet: usually before the year or at the opening
  let extractedAuthor: string | undefined;
  if (extractedYear) {
    const beforeYear = text.slice(0, text.indexOf(extractedYear)).trim();
    if (beforeYear.length > 2 && beforeYear.length < 100) {
      extractedAuthor = beforeYear.replace(/[(,\-.]+$/, "").trim();
    }
  }

  const extractedTitle = guessReferenceTitle(text) || undefined;

  return {
    rawReferenceText: text,
    extractedDoi,
    extractedTitle,
    extractedAuthor,
    extractedYear,
  };
}

/**
 * Normalizes Crossref work JSON into an importable Zotero item format.
 */
export function normalizeCrossrefToZoteroItem(
  work: Record<string, any>,
): ImportableBibliographicItem | null {
  if (!work || typeof work !== "object") return null;

  const titleList = Array.isArray(work.title) ? work.title : [work.title];
  const title = normalizeWhitespace(titleList.filter(Boolean).join(" "));
  if (!title) return null;

  const creators: ImportableCreator[] = [];
  if (Array.isArray(work.author)) {
    for (const a of work.author) {
      const family = normalizeWhitespace(a.family || a.name);
      const given = normalizeWhitespace(a.given);
      if (family) {
        creators.push({
          creatorType: "author",
          lastName: family,
          ...(given ? { firstName: given } : {}),
        });
      }
    }
  }

  let itemType: ImportableBibliographicItem["itemType"] = "journalArticle";
  if (work.type === "proceedings-article" || work.type === "paper-conference") {
    itemType = "conferencePaper";
  } else if (work.type === "book" || work.type === "monograph") {
    itemType = "book";
  } else if (work.type === "posted-content") {
    itemType = "preprint";
  }

  const containerList = Array.isArray(work["container-title"])
    ? work["container-title"]
    : [work["container-title"]];
  const publicationTitle = normalizeWhitespace(
    containerList.filter(Boolean).join(" "),
  );

  let date: string | undefined;
  const publishedDateParts =
    work["published-print"]?.["date-parts"]?.[0] ||
    work["published-online"]?.["date-parts"]?.[0] ||
    work.issued?.["date-parts"]?.[0];
  if (Array.isArray(publishedDateParts) && publishedDateParts[0]) {
    date = publishedDateParts.join("-");
  }

  let openAccessPdfUrl: string | undefined;
  if (Array.isArray(work.link)) {
    const pdfLink = work.link.find(
      (l: any) =>
        l["content-type"] === "application/pdf" || l.URL?.endsWith(".pdf"),
    );
    if (pdfLink?.URL) {
      openAccessPdfUrl = pdfLink.URL;
    }
  }

  return {
    itemType,
    title,
    creators,
    publicationTitle: publicationTitle || undefined,
    date,
    volume: work.volume ? String(work.volume) : undefined,
    issue: work.issue ? String(work.issue) : undefined,
    pages: work.page ? String(work.page) : undefined,
    DOI: work.DOI ? String(work.DOI) : undefined,
    url: work.URL ? String(work.URL) : undefined,
    abstractNote: work.abstract
      ? normalizeWhitespace(work.abstract.replace(/<[^>]+>/g, ""))
      : undefined,
    openAccessPdfUrl,
  };
}

/**
 * Normalizes OpenAlex work JSON into an importable Zotero item format.
 */
export function normalizeOpenAlexToZoteroItem(
  work: Record<string, any>,
): ImportableBibliographicItem | null {
  if (!work || typeof work !== "object") return null;

  const title = normalizeWhitespace(work.title || work.display_name);
  if (!title) return null;

  const creators: ImportableCreator[] = [];
  if (Array.isArray(work.authorships)) {
    for (const a of work.authorships) {
      const rawName = normalizeWhitespace(
        a.author?.display_name || a.raw_author_name,
      );
      if (!rawName) continue;
      const parts = rawName.split(/\s+/);
      if (parts.length > 1) {
        creators.push({
          creatorType: "author",
          lastName: parts[parts.length - 1],
          firstName: parts.slice(0, parts.length - 1).join(" "),
        });
      } else {
        creators.push({
          creatorType: "author",
          lastName: rawName,
        });
      }
    }
  }

  let itemType: ImportableBibliographicItem["itemType"] = "journalArticle";
  if (work.type === "article") itemType = "journalArticle";
  else if (work.type === "book") itemType = "book";
  else if (work.type === "preprint") itemType = "preprint";

  const hostVenue = work.primary_location?.source || work.host_venue;
  const publicationTitle = normalizeWhitespace(hostVenue?.display_name);

  const doi = work.doi
    ? work.doi.replace(/^https?:\/\/doi\.org\//i, "")
    : undefined;
  const openAccessPdfUrl =
    work.open_access?.oa_url || work.best_oa_location?.pdf_url || undefined;

  return {
    itemType,
    title,
    creators,
    publicationTitle: publicationTitle || undefined,
    date:
      work.publication_date ||
      (work.publication_year ? String(work.publication_year) : undefined),
    DOI: doi,
    url: work.doi || work.id,
    openAccessPdfUrl,
  };
}

// ═══════════════════════════════════════════════════════════
// Which references are worth offering for import
// ═══════════════════════════════════════════════════════════

/** At most this many references are offered from one citation insight run. */
export const CITATION_IMPORT_MAX_OFFERS = 10;

export type ImportableReference = {
  /** The marker as the user saw it, e.g. `[12]` or `(Smith et al., 2020)`. */
  label: string;
  referenceText: string;
  titleGuess: string;
  doi?: string;
};

/**
 * References the citation insight located but could not find in the library.
 *
 * An entry needs either a DOI or a guessable title: without one, a metadata
 * search would be a guess on a guess. The same bibliography entry cited under
 * two markers is offered once.
 */
export function collectImportableReferences(
  resolutions: CitationResolution[],
  max: number = CITATION_IMPORT_MAX_OFFERS,
): ImportableReference[] {
  const out: ImportableReference[] = [];
  const seen = new Set<string>();
  for (const resolution of resolutions || []) {
    if (out.length >= max) break;
    if (!resolution?.reference || resolution.libraryTitle) continue;
    const parsed = parseCitationForImport(resolution.reference.text);
    const key = parsed.rawReferenceText.toLowerCase();
    if (!key || seen.has(key)) continue;
    const titleGuess = parsed.extractedTitle || "";
    if (!titleGuess && !parsed.extractedDoi) continue;
    seen.add(key);
    out.push({
      label:
        normalizeWhitespace(resolution.marker?.raw) || `#${out.length + 1}`,
      referenceText: parsed.rawReferenceText,
      titleGuess,
      ...(parsed.extractedDoi ? { doi: parsed.extractedDoi } : {}),
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// Metadata lookup: request URLs and response picking
// ═══════════════════════════════════════════════════════════

export const CROSSREF_WORKS_API = "https://api.crossref.org/works";
export const OPENALEX_WORKS_API = "https://api.openalex.org/works";

/** Candidates examined from one search response. */
export const METADATA_SEARCH_ROWS = 5;

/** Share of the guessed title a search hit must cover to be accepted. */
export const METADATA_MATCH_MIN_SCORE = 0.75;

/** Share of the hit's own title the guess must cover, so a longer work fails. */
export const METADATA_MATCH_MIN_REVERSE_SCORE = 0.5;

const LOOKUP_QUERY_MAX_LENGTH = 300;

export type MetadataLookupRequest = {
  url: string;
  /** DOI lookups return one work, searches a list that must be scored. */
  byDoi: boolean;
};

function lookupQueryText(reference: ImportableReference): string {
  return normalizeWhitespace(
    reference.titleGuess || reference.referenceText,
  ).slice(0, LOOKUP_QUERY_MAX_LENGTH);
}

/**
 * Crossref request for one reference: the DOI endpoint when the entry carries
 * a DOI, otherwise a bibliographic search on the whole entry, which Crossref
 * ranks better than a title-only query because authors and year disambiguate.
 */
export function buildCrossrefLookup(
  reference: ImportableReference,
): MetadataLookupRequest | null {
  if (reference.doi) {
    return {
      url: `${CROSSREF_WORKS_API}/${encodeURIComponent(reference.doi)}`,
      byDoi: true,
    };
  }
  const query = normalizeWhitespace(reference.referenceText).slice(
    0,
    LOOKUP_QUERY_MAX_LENGTH,
  );
  if (!reference.titleGuess || !query) return null;
  return {
    url: `${CROSSREF_WORKS_API}?rows=${METADATA_SEARCH_ROWS}&query.bibliographic=${encodeURIComponent(
      query,
    )}`,
    byDoi: false,
  };
}

/** OpenAlex request for one reference, the fallback when Crossref fails. */
export function buildOpenAlexLookup(
  reference: ImportableReference,
): MetadataLookupRequest | null {
  if (reference.doi) {
    return {
      url: `${OPENALEX_WORKS_API}/doi:${encodeURI(reference.doi)}`,
      byDoi: true,
    };
  }
  const query = lookupQueryText(reference);
  if (!reference.titleGuess || !query) return null;
  return {
    url: `${OPENALEX_WORKS_API}?per-page=${METADATA_SEARCH_ROWS}&search=${encodeURIComponent(
      query,
    )}`,
    byDoi: false,
  };
}

/** Whether a search hit's title is the work the guess describes. */
export function isAcceptableTitleMatch(
  candidateTitle: unknown,
  titleGuess: unknown,
): boolean {
  return (
    scoreTitleMatch(candidateTitle, titleGuess) >= METADATA_MATCH_MIN_SCORE &&
    scoreTitleMatch(titleGuess, candidateTitle) >=
      METADATA_MATCH_MIN_REVERSE_SCORE
  );
}

function firstTitle(value: unknown): string {
  if (Array.isArray(value)) return normalizeWhitespace(value[0]);
  return normalizeWhitespace(value);
}

/**
 * The importable item from a Crossref response, or null.
 *
 * A DOI lookup is trusted as is; a search hit must carry the guessed title,
 * because Crossref always returns *something* for a bibliographic query.
 */
export function pickCrossrefItem(
  json: unknown,
  request: MetadataLookupRequest,
  titleGuess: string,
): ImportableBibliographicItem | null {
  const message = (json as Record<string, any> | null)?.message;
  if (!message || typeof message !== "object") return null;
  if (request.byDoi) return normalizeCrossrefToZoteroItem(message);
  const items: any[] = Array.isArray(message.items) ? message.items : [];
  for (const work of items) {
    if (!isAcceptableTitleMatch(firstTitle(work?.title), titleGuess)) continue;
    const item = normalizeCrossrefToZoteroItem(work);
    if (item) return item;
  }
  return null;
}

/** The importable item from an OpenAlex response, or null. */
export function pickOpenAlexItem(
  json: unknown,
  request: MetadataLookupRequest,
  titleGuess: string,
): ImportableBibliographicItem | null {
  if (!json || typeof json !== "object") return null;
  if (request.byDoi) {
    return normalizeOpenAlexToZoteroItem(json as Record<string, any>);
  }
  const results: any[] = Array.isArray((json as any).results)
    ? (json as any).results
    : [];
  for (const work of results) {
    const title = work?.title || work?.display_name;
    if (!isAcceptableTitleMatch(title, titleGuess)) continue;
    const item = normalizeOpenAlexToZoteroItem(work);
    if (item) return item;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// Duplicate detection
// ═══════════════════════════════════════════════════════════

/** Share of words two titles must share, both ways, to be the same work. */
export const DUPLICATE_TITLE_MIN_SCORE = 0.9;

/** DOI in the one form two records can be compared by. */
export function normalizeDoiKey(doi: unknown): string {
  return normalizeWhitespace(doi)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/[.,;)]+$/, "")
    .toLowerCase();
}

export type WorkIdentity = { DOI?: string | null; title?: string | null };

/**
 * Whether two records describe the same work: same DOI, or titles that cover
 * each other almost word for word. A differing DOI does not veto a title match,
 * because a preprint and its published version are one paper to the reader.
 */
export function isSameWork(a: WorkIdentity, b: WorkIdentity): boolean {
  const doiA = normalizeDoiKey(a?.DOI);
  const doiB = normalizeDoiKey(b?.DOI);
  if (doiA && doiB && doiA === doiB) return true;
  const titleA = normalizeWhitespace(a?.title);
  const titleB = normalizeWhitespace(b?.title);
  if (!titleA || !titleB) return false;
  return (
    scoreTitleMatch(titleA, titleB) >= DUPLICATE_TITLE_MIN_SCORE &&
    scoreTitleMatch(titleB, titleA) >= DUPLICATE_TITLE_MIN_SCORE
  );
}

/** The first existing record that is the same work as `item`, if any. */
export function findDuplicateWork<T extends WorkIdentity>(
  item: WorkIdentity,
  existing: T[],
): T | null {
  for (const candidate of existing || []) {
    if (candidate && isSameWork(item, candidate)) return candidate;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// Zotero field mapping
// ═══════════════════════════════════════════════════════════

export type MetadataSource = "Crossref" | "OpenAlex";

export type ZoteroItemDraft = {
  itemType: ImportableBibliographicItem["itemType"];
  /** `[field, value]` pairs, each valid for `itemType`. */
  fields: Array<[string, string]>;
  creators: ImportableCreator[];
  /** Lines for the Extra field, for data the item type has no field for. */
  extraLines: string[];
};

/** The field a type stores its venue in; `null` when it has none. */
export function venueFieldForItemType(
  itemType: ImportableBibliographicItem["itemType"],
): string | null {
  switch (itemType) {
    case "journalArticle":
      return "publicationTitle";
    case "conferencePaper":
      return "proceedingsTitle";
    case "preprint":
      return "repository";
    case "document":
      return "publisher";
    default:
      return null;
  }
}

/**
 * The fields to set on a new Zotero item for an importable record.
 *
 * `isValidField` asks Zotero whether a type has a field; everything a type
 * cannot hold is dropped, except the DOI, which goes to Extra as `DOI: …` the
 * way Zotero's own translators store it for such types.
 */
export function buildZoteroItemDraft(
  item: ImportableBibliographicItem,
  source: MetadataSource,
  isValidField: (itemType: string, field: string) => boolean = () => true,
): ZoteroItemDraft {
  const wanted: Array<[string, string | undefined]> = [
    ["title", item.title],
    ["date", item.date],
    ["volume", item.volume],
    ["issue", item.issue],
    ["pages", item.pages],
    ["DOI", item.DOI],
    ["url", item.url],
    ["abstractNote", item.abstractNote],
    ["libraryCatalog", source],
  ];
  const venueField = venueFieldForItemType(item.itemType);
  if (venueField) wanted.push([venueField, item.publicationTitle]);

  const fields: Array<[string, string]> = [];
  const extraLines: string[] = [];
  for (const [field, raw] of wanted) {
    const value = normalizeWhitespace(raw);
    if (!value) continue;
    let valid: boolean;
    try {
      valid = isValidField(item.itemType, field);
    } catch {
      valid = false;
    }
    if (valid) fields.push([field, value]);
    else if (field === "DOI") extraLines.push(`DOI: ${value}`);
  }
  return {
    itemType: item.itemType,
    fields,
    creators: (item.creators || []).filter((c) =>
      normalizeWhitespace(c.lastName),
    ),
    extraLines,
  };
}

// ═══════════════════════════════════════════════════════════
// Outcomes
// ═══════════════════════════════════════════════════════════

export type CitationImportOutcome =
  | { kind: "imported"; title: string; itemID: number }
  | { kind: "duplicate"; title: string; itemID: number }
  | { kind: "not-found"; label: string }
  | { kind: "failed"; label: string; failure: string };

export type CitationImportSummary = {
  imported: number;
  duplicates: number;
  notFound: number;
  failed: number;
  /** Failure kind shared by every failure, or null when they differ/none. */
  commonFailure: string | null;
  /** How the summary notice should look. */
  noticeKind: "success" | "warning" | "error";
};

/**
 * Tally a batch import. The notice is a success when every reference ended up
 * in the library (new or already there), an error when nothing did and at
 * least one request failed, and a warning in between.
 */
export function summarizeImportOutcomes(
  outcomes: CitationImportOutcome[],
): CitationImportSummary {
  let imported = 0;
  let duplicates = 0;
  let notFound = 0;
  let failed = 0;
  const failures = new Set<string>();
  for (const outcome of outcomes || []) {
    if (outcome.kind === "imported") imported += 1;
    else if (outcome.kind === "duplicate") duplicates += 1;
    else if (outcome.kind === "not-found") notFound += 1;
    else {
      failed += 1;
      failures.add(outcome.failure);
    }
  }
  const landed = imported + duplicates;
  const noticeKind: CitationImportSummary["noticeKind"] =
    notFound === 0 && failed === 0
      ? "success"
      : landed === 0 && failed > 0
        ? "error"
        : "warning";
  return {
    imported,
    duplicates,
    notFound,
    failed,
    commonFailure: failures.size === 1 ? Array.from(failures)[0] : null,
    noticeKind,
  };
}
