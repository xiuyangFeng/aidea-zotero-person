/**
 * Bilingual (source-above-translation) state for the selection popup.
 *
 * The mode costs nothing to enter or leave: the source text is already in hand
 * when the popup opens, so switching only decides whether its block is shown.
 * That is why the toggle never re-translates, and why this module is pure — the
 * popup owns the DOM, the preference owns the default, and everything between
 * them is the small amount of state resolved here.
 */

/** Preference deciding whether the popup opens in bilingual mode. */
export const SELECTION_TRANSLATE_BILINGUAL_PREF_KEY =
  "selectionTranslate.bilingual";

/** Preference gating the concept-library term rule in the translate prompt. */
export const SELECTION_TRANSLATE_TERM_PROTECTION_PREF_KEY =
  "selectionTranslate.termProtection";

/**
 * Read a stored flag.
 *
 * Zotero preferences come back as booleans, as strings, or as nothing at all
 * depending on how they were written, so every caller that reads one has to
 * fold the three; doing it here keeps the popup and the settings page agreeing
 * on what a malformed value means.
 */
export function normalizeSelectionBilingual(
  value: unknown,
  fallback: boolean = false,
): boolean {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true" || normalized === "1" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "off") {
    return false;
  }
  return fallback;
}

/** The value the toggle writes back, from whatever the preference held. */
export function toggleSelectionBilingual(current: unknown): boolean {
  return !normalizeSelectionBilingual(current);
}

/**
 * The source block's text.
 *
 * Line breaks are kept — a selection spanning two columns reads as nonsense
 * without them — while carriage returns and trailing blanks are not, because
 * they only ever come from the PDF layer.
 */
export function normalizeSelectionSourceText(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type SelectionBilingualLabels = {
  showSource: string;
  hideSource: string;
};

export type SelectionBilingualViewState = {
  bilingual: boolean;
  /** False when the mode is off *or* there is no source text worth showing. */
  showSourceBlock: boolean;
  sourceText: string;
  /** Tooltip and accessible name of the toggle: what a click will do. */
  toggleLabel: string;
  /** `aria-pressed`, i.e. whether the mode is currently on. */
  togglePressed: boolean;
};

/**
 * Everything the popup needs to render one bilingual state.
 *
 * An empty selection hides the block even in bilingual mode: an empty bordered
 * box above the translation is chrome that explains nothing. The label always
 * names the action rather than the state, so the button reads the same way as
 * the rest of the popup's controls.
 */
export function resolveSelectionBilingualViewState(params: {
  bilingual: unknown;
  sourceText: unknown;
  labels: SelectionBilingualLabels;
}): SelectionBilingualViewState {
  const bilingual = normalizeSelectionBilingual(params.bilingual);
  const sourceText = normalizeSelectionSourceText(params.sourceText);
  return {
    bilingual,
    showSourceBlock: bilingual && Boolean(sourceText),
    sourceText,
    toggleLabel: bilingual
      ? params.labels.hideSource
      : params.labels.showSource,
    togglePressed: bilingual,
  };
}
