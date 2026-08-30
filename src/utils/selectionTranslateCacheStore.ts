import { fnv1aHex } from "./hash";
import { NO_TERM_PROTECTION_FINGERPRINT } from "./selectionTermProtection";

export type SelectionTranslateColdStartCache = {
  itemId: number;
  libraryID: number;
  targetLang: string;
  sourceFingerprint: string;
  model?: string;
  provider?: string;
  cacheText: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
};

const SELECTION_TRANSLATE_CACHE_TABLE = "zotero_ai_selection_translate_cache";
const SELECTION_TRANSLATE_CACHE_INDEX =
  "zotero_ai_selection_translate_cache_lookup_idx";
export const SELECTION_TRANSLATE_CACHE_SCHEMA_VERSION = 2;

function normalizePositiveInt(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const int = Math.floor(num);
  return int > 0 ? int : null;
}

function normalizeNonNegativeInt(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return (
    value
      // eslint-disable-next-line no-control-regex -- strips unsafe cached characters
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength)
  );
}

function rowToCache(
  row: Record<string, unknown>,
): SelectionTranslateColdStartCache | null {
  const itemId = normalizePositiveInt(row.itemID);
  const targetLang = normalizeText(row.targetLang, 32);
  const sourceFingerprint = normalizeText(row.sourceFingerprint, 160);
  const cacheText =
    typeof row.cacheText === "string" ? row.cacheText.trim() : "";
  if (!itemId || !targetLang || !sourceFingerprint || !cacheText) return null;
  const createdAt = normalizeNonNegativeInt(row.createdAt) || Date.now();
  const updatedAt = normalizeNonNegativeInt(row.updatedAt) || createdAt;
  return {
    itemId,
    libraryID: normalizeNonNegativeInt(row.libraryID),
    targetLang,
    sourceFingerprint,
    model: normalizeText(row.model, 256) || undefined,
    provider: normalizeText(row.provider, 128) || undefined,
    cacheText,
    createdAt,
    updatedAt,
    schemaVersion:
      normalizeNonNegativeInt(row.schemaVersion) ||
      SELECTION_TRANSLATE_CACHE_SCHEMA_VERSION,
  };
}

export async function initSelectionTranslateCacheStore(): Promise<void> {
  await Zotero.DB.executeTransaction(async () => {
    await Zotero.DB.queryAsync(
      `CREATE TABLE IF NOT EXISTS ${SELECTION_TRANSLATE_CACHE_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        library_id INTEGER NOT NULL DEFAULT 0,
        target_lang TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        model TEXT,
        provider TEXT,
        cache_text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT ${SELECTION_TRANSLATE_CACHE_SCHEMA_VERSION}
      )`,
    );
    await Zotero.DB.queryAsync(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${SELECTION_TRANSLATE_CACHE_INDEX}
       ON ${SELECTION_TRANSLATE_CACHE_TABLE}
       (item_id, target_lang, source_fingerprint, schema_version)`,
    );
    await Zotero.DB.queryAsync(
      `DELETE FROM ${SELECTION_TRANSLATE_CACHE_TABLE}
       WHERE schema_version < ?`,
      [SELECTION_TRANSLATE_CACHE_SCHEMA_VERSION],
    );
  });
}

export async function loadSelectionTranslateColdStartCache(params: {
  itemId: number;
  targetLang: string;
  sourceFingerprint: string;
}): Promise<SelectionTranslateColdStartCache | null> {
  const itemId = normalizePositiveInt(params.itemId);
  const targetLang = normalizeText(params.targetLang, 32);
  const sourceFingerprint = normalizeText(params.sourceFingerprint, 160);
  if (!itemId || !targetLang || !sourceFingerprint) return null;
  const rows = (await Zotero.DB.queryAsync(
    `SELECT item_id AS itemID,
            library_id AS libraryID,
            target_lang AS targetLang,
            source_fingerprint AS sourceFingerprint,
            model,
            provider,
            cache_text AS cacheText,
            created_at AS createdAt,
            updated_at AS updatedAt,
            schema_version AS schemaVersion
     FROM ${SELECTION_TRANSLATE_CACHE_TABLE}
     WHERE item_id = ?
       AND target_lang = ?
       AND source_fingerprint = ?
       AND schema_version = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [
      itemId,
      targetLang,
      sourceFingerprint,
      SELECTION_TRANSLATE_CACHE_SCHEMA_VERSION,
    ],
  )) as Array<Record<string, unknown>> | undefined;
  const first = rows?.[0];
  return first ? rowToCache(first) : null;
}

export async function saveSelectionTranslateColdStartCache(
  cache: SelectionTranslateColdStartCache,
): Promise<void> {
  const itemId = normalizePositiveInt(cache.itemId);
  const targetLang = normalizeText(cache.targetLang, 32);
  const sourceFingerprint = normalizeText(cache.sourceFingerprint, 160);
  const cacheText =
    typeof cache.cacheText === "string" ? cache.cacheText.trim() : "";
  if (!itemId || !targetLang || !sourceFingerprint || !cacheText) return;
  const libraryID = normalizeNonNegativeInt(cache.libraryID);
  const now = Date.now();
  const createdAt = normalizeNonNegativeInt(cache.createdAt) || now;
  const updatedAt = normalizeNonNegativeInt(cache.updatedAt) || now;
  await Zotero.DB.executeTransaction(async () => {
    const existing = (await Zotero.DB.queryAsync(
      `SELECT id
       FROM ${SELECTION_TRANSLATE_CACHE_TABLE}
       WHERE item_id = ?
         AND target_lang = ?
         AND source_fingerprint = ?
         AND schema_version = ?
       LIMIT 1`,
      [
        itemId,
        targetLang,
        sourceFingerprint,
        SELECTION_TRANSLATE_CACHE_SCHEMA_VERSION,
      ],
    )) as Array<{ id?: unknown }> | undefined;
    const existingId = normalizePositiveInt(existing?.[0]?.id);
    if (existingId) {
      await Zotero.DB.queryAsync(
        `UPDATE ${SELECTION_TRANSLATE_CACHE_TABLE}
         SET library_id = ?,
             model = ?,
             provider = ?,
             cache_text = ?,
             updated_at = ?
         WHERE id = ?`,
        [
          libraryID,
          normalizeText(cache.model, 256),
          normalizeText(cache.provider, 128),
          cacheText,
          updatedAt,
          existingId,
        ],
      );
      return;
    }
    await Zotero.DB.queryAsync(
      `INSERT INTO ${SELECTION_TRANSLATE_CACHE_TABLE}
       (item_id,
        library_id,
        target_lang,
        source_fingerprint,
        model,
        provider,
        cache_text,
        created_at,
        updated_at,
        schema_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemId,
        libraryID,
        targetLang,
        sourceFingerprint,
        normalizeText(cache.model, 256),
        normalizeText(cache.provider, 128),
        cacheText,
        createdAt,
        updatedAt,
        SELECTION_TRANSLATE_CACHE_SCHEMA_VERSION,
      ],
    );
  });
}

export async function clearSelectionTranslateColdStartCache(): Promise<number> {
  const rows = (await Zotero.DB.queryAsync(
    `SELECT COUNT(*) AS count FROM ${SELECTION_TRANSLATE_CACHE_TABLE}`,
  )) as Array<{ count?: unknown }> | undefined;
  const count = normalizeNonNegativeInt(rows?.[0]?.count);
  await Zotero.DB.queryAsync(`DELETE FROM ${SELECTION_TRANSLATE_CACHE_TABLE}`);
  clearSelectionTranslateResultCache();
  return count;
}

// ===========================================================================
// Translated-selection memo
//
// The cold-start cache above is per document; this one is per selection. It is
// deliberately in memory only: a translation is cheap to redo across sessions
// and expensive to get wrong, and the point of the memo is the reader who
// re-selects the same paragraph a minute later, not the reader who comes back
// tomorrow.
// ===========================================================================

/** Entries kept before the oldest is evicted. */
const SELECTION_TRANSLATE_RESULT_CACHE_LIMIT = 32;
/** Selected text is hashed rather than keyed whole; this bounds the input. */
const SELECTION_TRANSLATE_RESULT_KEY_TEXT_LIMIT = 12000;

export type SelectionTranslateResultCacheEntry = {
  translation: string;
  model: string;
  provider?: string;
};

export type BuildSelectionTranslateResultCacheKeyParams = {
  itemId: number;
  sourceLang: string;
  targetLang: string;
  model: string;
  provider?: string;
  contextMode: string;
  /** The context block the prompt carries, so a rebuilt cold start invalidates. */
  contextText?: string;
  selectedText: string;
  /**
   * `buildTermProtectionFingerprint` of the injected terms. Folding it in is
   * what stops a translation made under a term rule from being replayed for a
   * request that carries none — the two prompts differ, so their answers must
   * not share a key.
   */
  termFingerprint?: string;
};

/**
 * Key one translated selection.
 *
 * Every input that can change the answer is in the key: the document, both
 * languages, the model that will write it, the context block it will read, the
 * text itself and the terms the prompt protects. Long fields are hashed so the
 * key stays short whatever the reader selected.
 */
export function buildSelectionTranslateResultCacheKey(
  params: BuildSelectionTranslateResultCacheKeyParams,
): string {
  const selectedText = String(params.selectedText || "").slice(
    0,
    SELECTION_TRANSLATE_RESULT_KEY_TEXT_LIMIT,
  );
  const contextText = String(params.contextText || "").slice(
    0,
    SELECTION_TRANSLATE_RESULT_KEY_TEXT_LIMIT,
  );
  return [
    SELECTION_TRANSLATE_CACHE_SCHEMA_VERSION,
    normalizeNonNegativeInt(params.itemId),
    normalizeText(params.sourceLang, 32),
    normalizeText(params.targetLang, 32),
    normalizeText(params.model, 256),
    normalizeText(params.provider, 128),
    normalizeText(params.contextMode, 64),
    normalizeText(params.termFingerprint, 64) || NO_TERM_PROTECTION_FINGERPRINT,
    `c${contextText.length}-${fnv1aHex(contextText)}`,
    `s${selectedText.length}-${fnv1aHex(selectedText)}`,
  ].join("|");
}

const selectionTranslateResultCache = new Map<
  string,
  SelectionTranslateResultCacheEntry
>();

/** A memoized translation, refreshed to most-recent on every hit. */
export function readSelectionTranslateResultCache(
  key: string,
): SelectionTranslateResultCacheEntry | null {
  if (!key) return null;
  const entry = selectionTranslateResultCache.get(key);
  if (!entry) return null;
  selectionTranslateResultCache.delete(key);
  selectionTranslateResultCache.set(key, entry);
  return { ...entry };
}

export function writeSelectionTranslateResultCache(
  key: string,
  entry: SelectionTranslateResultCacheEntry,
): void {
  if (!key || !entry?.translation?.trim()) return;
  selectionTranslateResultCache.delete(key);
  selectionTranslateResultCache.set(key, { ...entry });
  while (
    selectionTranslateResultCache.size > SELECTION_TRANSLATE_RESULT_CACHE_LIMIT
  ) {
    const oldest = selectionTranslateResultCache.keys().next().value;
    if (oldest === undefined) break;
    selectionTranslateResultCache.delete(oldest);
  }
}

export function clearSelectionTranslateResultCache(): void {
  selectionTranslateResultCache.clear();
}
