/**
 * Persistence for concept cards.
 *
 * Deliberately a sibling of `memoryStore` rather than a category inside it.
 * The two answer different questions: a memory is one free-text sentence
 * matched by overall similarity, a concept card is a keyed term with a
 * definition and a provenance, matched by whether the user named the term.
 * Sharing one table would mean concept rows crowding the memory recall window
 * (and the reverse), and would leave the term with nowhere to be unique. What
 * is shared is everything that can be: the library resolution, the injection
 * shape, and the prompt-injection guard all come from `memoryStore` and
 * `conceptCards`.
 */

import {
  CONCEPT_DEFINITION_MAX_CHARS,
  CONCEPT_RECALL_LIMIT,
  CONCEPT_RECALL_MIN_SCORE,
  CONCEPT_TERM_MAX_CHARS,
  conceptTermKey,
  normalizeConceptDefinition,
  normalizeConceptTerm,
  scoreConceptCard,
  type ConceptCard,
  type ConceptCardDraft,
} from "./conceptCards";
import { resolveMemoryLibraryID } from "./memoryStore";

/** Concept cards live in the same library scope as memories. */
export { resolveMemoryLibraryID as resolveConceptLibraryID } from "./memoryStore";

const CONCEPT_TABLE = "zotero_ai_concepts";
const CONCEPT_LIBRARY_INDEX = "zotero_ai_concepts_library_idx";
const CONCEPT_TERM_INDEX = "zotero_ai_concepts_term_idx";

/** Rows scored per recall. Beyond this the oldest cards stop competing. */
const CONCEPT_SEARCH_CANDIDATES = 400;
/** Rows a glossary export may carry; well past any hand-built library. */
const CONCEPT_LIST_LIMIT = 5000;

const CONCEPT_COLUMNS = `id,
            library_id AS libraryID,
            term,
            term_norm AS termKey,
            definition,
            source_item_id AS sourceItemId,
            source_title AS sourceTitle,
            source_page AS sourcePage,
            created_at AS createdAt,
            updated_at AS updatedAt,
            hit_count AS hitCount,
            last_hit_at AS lastHitAt`;

function normalizePositiveInt(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const int = Math.floor(num);
  return int > 0 ? int : null;
}

function rowToConceptCard(row: Record<string, unknown>): ConceptCard | null {
  const id = normalizePositiveInt(row.id);
  const libraryID = normalizePositiveInt(row.libraryID);
  const term = normalizeConceptTerm(row.term);
  const definition = normalizeConceptDefinition(row.definition);
  if (!id || !libraryID || !term || !definition) return null;
  const createdAt = Number(row.createdAt);
  const updatedAt = Number(row.updatedAt);
  const hitCount = Number(row.hitCount);
  const lastHitAt = Number(row.lastHitAt);
  return {
    id,
    libraryID,
    term,
    termKey: String(row.termKey || conceptTermKey(term)),
    definition,
    sourceItemId: normalizePositiveInt(row.sourceItemId) || undefined,
    sourceTitle:
      typeof row.sourceTitle === "string" && row.sourceTitle.trim()
        ? row.sourceTitle.trim()
        : undefined,
    page: normalizePositiveInt(row.sourcePage) || undefined,
    createdAt: Number.isFinite(createdAt) ? Math.floor(createdAt) : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? Math.floor(updatedAt) : Date.now(),
    hitCount: Number.isFinite(hitCount) ? Math.max(0, Math.floor(hitCount)) : 0,
    lastHitAt: Number.isFinite(lastHitAt) ? Math.floor(lastHitAt) : undefined,
  };
}

export async function initConceptStore(): Promise<void> {
  await Zotero.DB.executeTransaction(async () => {
    await Zotero.DB.queryAsync(
      `CREATE TABLE IF NOT EXISTS ${CONCEPT_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER NOT NULL,
        term TEXT NOT NULL,
        term_norm TEXT NOT NULL,
        definition TEXT NOT NULL,
        source_item_id INTEGER,
        source_title TEXT,
        source_page INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        last_hit_at INTEGER
      )`,
    );
    // One card per term per library is the whole dedup contract; enforcing it
    // in the schema means a racing second extraction cannot slip a twin in.
    await Zotero.DB.queryAsync(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${CONCEPT_TERM_INDEX}
       ON ${CONCEPT_TABLE} (library_id, term_norm)`,
    );
    await Zotero.DB.queryAsync(
      `CREATE INDEX IF NOT EXISTS ${CONCEPT_LIBRARY_INDEX}
       ON ${CONCEPT_TABLE} (library_id, updated_at DESC, id DESC)`,
    );
  });
}

async function findConceptCardByKey(
  libraryID: number,
  termKey: string,
): Promise<ConceptCard | null> {
  const rows = (await Zotero.DB.queryAsync(
    `SELECT ${CONCEPT_COLUMNS}
     FROM ${CONCEPT_TABLE}
     WHERE library_id = ? AND term_norm = ?
     LIMIT 1`,
    [libraryID, termKey],
  )) as Array<Record<string, unknown>> | undefined;
  return rows?.length ? rowToConceptCard(rows[0]) : null;
}

export type StoreConceptCardsParams = {
  libraryID: number;
  cards: readonly ConceptCardDraft[];
  /** Attachment the cards were extracted from, when there is one. */
  sourceItemId?: number | null;
  sourceTitle?: string | null;
};

export type StoreConceptCardsResult = {
  created: number;
  /** Terms that already existed; their definition was left untouched. */
  skipped: number;
};

/**
 * Write a batch of parsed cards.
 *
 * An existing term keeps its definition. The first capture is the one the user
 * has already seen and may have curated, and model wording drifts between
 * runs, so re-extracting the same paper must not churn the library. What a
 * repeat does contribute is provenance: a card stored without a source or page
 * takes them from the new sighting, which is how a card recorded by hand later
 * gains its citation.
 */
export async function storeConceptCards(
  params: StoreConceptCardsParams,
): Promise<StoreConceptCardsResult> {
  const result: StoreConceptCardsResult = { created: 0, skipped: 0 };
  const libraryID = normalizePositiveInt(params.libraryID);
  if (!libraryID || !params.cards?.length) return result;

  const sourceItemId = normalizePositiveInt(params.sourceItemId);
  const sourceTitle = String(params.sourceTitle || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CONCEPT_DEFINITION_MAX_CHARS);
  const seen = new Set<string>();

  for (const card of params.cards) {
    const term = normalizeConceptTerm(card?.term).slice(
      0,
      CONCEPT_TERM_MAX_CHARS,
    );
    const definition = normalizeConceptDefinition(card?.definition);
    const termKey = conceptTermKey(term);
    if (!term || !definition || !termKey || seen.has(termKey)) continue;
    seen.add(termKey);
    const page = normalizePositiveInt(card?.page);
    const now = Date.now();

    const existing = await findConceptCardByKey(libraryID, termKey);
    if (existing) {
      const nextSourceItemId = existing.sourceItemId || sourceItemId || null;
      const nextSourceTitle =
        existing.sourceTitle || (sourceItemId ? sourceTitle : "") || null;
      const nextPage = existing.page || page || null;
      await Zotero.DB.queryAsync(
        `UPDATE ${CONCEPT_TABLE}
         SET source_item_id = ?,
             source_title = ?,
             source_page = ?,
             updated_at = ?,
             hit_count = hit_count + 1,
             last_hit_at = ?
         WHERE id = ?`,
        [nextSourceItemId, nextSourceTitle, nextPage, now, now, existing.id],
      );
      result.skipped++;
      continue;
    }

    await Zotero.DB.queryAsync(
      `INSERT INTO ${CONCEPT_TABLE}
        (library_id, term, term_norm, definition, source_item_id, source_title,
         source_page, created_at, updated_at, hit_count, last_hit_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
      [
        libraryID,
        term,
        termKey,
        definition,
        sourceItemId,
        sourceItemId ? sourceTitle || null : null,
        page,
        now,
        now,
      ],
    );
    result.created++;
  }
  return result;
}

/** Every card in a library, newest first; the glossary export sorts it. */
export async function listConceptCards(
  libraryID: number,
  limit = CONCEPT_LIST_LIMIT,
): Promise<ConceptCard[]> {
  const normalizedLibraryID = normalizePositiveInt(libraryID);
  if (!normalizedLibraryID) return [];
  const rows = (await Zotero.DB.queryAsync(
    `SELECT ${CONCEPT_COLUMNS}
     FROM ${CONCEPT_TABLE}
     WHERE library_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [normalizedLibraryID, Math.max(1, Math.floor(limit))],
  )) as Array<Record<string, unknown>> | undefined;
  if (!rows?.length) return [];
  const cards: ConceptCard[] = [];
  for (const row of rows) {
    const card = rowToConceptCard(row);
    if (card) cards.push(card);
  }
  return cards;
}

export type SearchConceptCardsParams = {
  libraryID: number;
  query: string;
  limit?: number;
  minScore?: number;
};

/**
 * Cards the user's message names, best match first.
 *
 * Scoring is in JS rather than SQL for the same reason `memoryStore` does it:
 * the match has to fold width, case and punctuation, which SQLite's LIKE
 * cannot. A hit bumps the card's counters so frequently used terms keep
 * winning ties.
 */
export async function searchConceptCards(
  params: SearchConceptCardsParams,
): Promise<ConceptCard[]> {
  const libraryID = normalizePositiveInt(params.libraryID);
  const query = String(params.query || "").trim();
  if (!libraryID || !query) return [];
  const limit = Math.max(
    1,
    Math.min(
      CONCEPT_RECALL_LIMIT,
      Math.floor(params.limit || CONCEPT_RECALL_LIMIT),
    ),
  );
  const minScore = Number.isFinite(params.minScore)
    ? Number(params.minScore)
    : CONCEPT_RECALL_MIN_SCORE;

  const candidates = await listConceptCards(
    libraryID,
    CONCEPT_SEARCH_CANDIDATES,
  );
  if (!candidates.length) return [];
  const now = Date.now();
  const scored = candidates
    .map((card) => ({ card, score: scoreConceptCard(query, card, now) }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.card);

  if (scored.length) {
    const ids = scored.map((card) => card.id);
    const placeholders = ids.map(() => "?").join(", ");
    await Zotero.DB.queryAsync(
      `UPDATE ${CONCEPT_TABLE}
       SET hit_count = hit_count + 1, last_hit_at = ?
       WHERE id IN (${placeholders})`,
      [now, ...ids],
    );
  }
  return scored;
}

/** How many cards a library holds, for status text before a full export. */
export async function countConceptCards(libraryID: number): Promise<number> {
  const normalizedLibraryID = normalizePositiveInt(libraryID);
  if (!normalizedLibraryID) return 0;
  const rows = (await Zotero.DB.queryAsync(
    `SELECT COUNT(*) AS total FROM ${CONCEPT_TABLE} WHERE library_id = ?`,
    [normalizedLibraryID],
  )) as Array<Record<string, unknown>> | undefined;
  const total = Number(rows?.[0]?.total);
  return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
}
