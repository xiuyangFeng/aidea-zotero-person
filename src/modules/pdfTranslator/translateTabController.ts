/* ---------------------------------------------------------------------------
 * pdfTranslator/translateTabController.ts
 *
 * Wires up the Translate tab UI:
 *   - Populates the model selector from the shared model list
 *   - Persists per-tab model selection in Zotero prefs
 *   - Handles env setup / path / start / pause / clear button events
 * -------------------------------------------------------------------------*/

import { getModelChoices } from "../contextPanel/setupHandlers/controllers/modelSelectionController";
import {
  isFileDragEvent,
  isZoteroItemDragEvent,
  getZoteroDragItemIds,
} from "../contextPanel/setupHandlers/controllers/fileIntakeController";
import { getPanelI18n } from "../contextPanel/i18n";
import { cleanupTranslateTempCache } from "./tempCache";
import type { ProgressData, TranslationStats, WarningStats } from "./types";

/* ── Per-tab model pref key ── */

const TRANSLATE_MODEL_PREF = "lastUsedModelName.translate";
const TRANSLATE_PROVIDER_PREF = "lastUsedModelProvider.translate";
const TRANSLATE_PREFS = {
  sourceLang: "translate.sourceLang",
  targetLang: "translate.targetLang",
  outputMono: "translate.outputMono",
  outputDual: "translate.outputDual",
  skipRefsAuto: "translate.skipReferencesAuto",
  outputDir: "translate.outputDir",
  qps: "translate.qps",
  poolMaxWorker: "translate.poolMaxWorker",
  keepAppendixTranslated: "translate.keepAppendixTranslated",
  protectAuthorBlock: "translate.protectAuthorBlock",
  disableRichTextTranslate: "translate.disableRichTextTranslate",
  enhanceCompatibility: "translate.enhanceCompatibility",
  translateTableText: "translate.translateTableText",
  ocr: "translate.ocr",
  autoOcr: "translate.autoOcr",
  saveGlossary: "translate.saveGlossary",
  disableGlossary: "translate.disableGlossary",
  fontFamily: "translate.fontFamily",
  advancedCollapsed: "translate.advancedCollapsed",
  consoleCollapsed: "translate.consoleCollapsed",
  scrollTop: "translate.scrollTop",
} as const;

declare const Zotero: any;
declare const addon: any;
declare const Services: any;

const LOW_SIGNAL_ENGINE_DETAIL_RE =
  /(?:INFO:pdf2zh_next|INFO:babeldoc|WARNING:babeldoc|il_translator_llm_only\.py:(?:774|783|797|824))/i;

function getStageSummaryLabel(stage?: string, message?: string): string {
  switch (stage) {
    case "author_block":
      return "Analyzing author/affiliation block...";
    case "reference_detection":
      return "Detecting references/appendix pages...";
    case "initializing":
      return "Initializing translation engine...";
    case "finalizing":
      return "Finalizing translated PDF...";
    default:
      return message || "";
  }
}

function shouldLogEngineDetail(detail: string): boolean {
  if (!detail) return false;
  if (/\bERROR\b/i.test(detail)) return true;
  if (
    /(download|retry|overlay-translated|proxy|font subsetting|save with clean)/i.test(
      detail,
    )
  ) {
    return true;
  }
  return !LOW_SIGNAL_ENGINE_DETAIL_RE.test(detail);
}

function buildTranslationSummaryLine(stats?: TranslationStats): string {
  if (!stats || stats.total === undefined) return "";
  const parts = [`Paragraphs ${stats.total}`];
  if (stats.successful !== undefined)
    parts.push(`successful ${stats.successful}`);
  if (stats.fallback !== undefined) parts.push(`fallback ${stats.fallback}`);
  return parts.join(" | ");
}

function buildWarningSummaryLine(
  stats?: WarningStats,
  warningCount?: number,
): string {
  if (!stats || (!warningCount && Object.keys(stats).length === 0)) return "";
  const parts: string[] = [];
  if (stats.sameAsInput) parts.push(`same-as-input ${stats.sameAsInput}`);
  if (stats.lengthMismatch)
    parts.push(`length-mismatch ${stats.lengthMismatch}`);
  if (stats.editDistanceSmall)
    parts.push(`edit-distance ${stats.editDistanceSmall}`);
  if (stats.fallbackToSimple) parts.push(`fallback ${stats.fallbackToSimple}`);
  if (stats.other) parts.push(`other ${stats.other}`);
  const summary = parts.join(" | ");
  if (warningCount && summary) return `Warnings ${warningCount} | ${summary}`;
  if (warningCount) return `Warnings ${warningCount}`;
  return summary;
}

function prefKey(): string {
  return `${addon.data.config.prefsPrefix}.${TRANSLATE_MODEL_PREF}`;
}

function translatePrefKey(key: string): string {
  return `${addon.data.config.prefsPrefix}.${key}`;
}

function getBoolPref(key: string, defaultValue: boolean): boolean {
  try {
    const value = Zotero.Prefs.get(translatePrefKey(key), true);
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (v === "true" || v === "1") return true;
      if (v === "false" || v === "0") return false;
    }
  } catch {
    // ignore
  }
  return defaultValue;
}

function setBoolPref(key: string, value: boolean): void {
  try {
    Zotero.Prefs.set(translatePrefKey(key), value, true);
  } catch {
    // ignore
  }
}

function getStringPref(key: string, defaultValue = ""): string {
  try {
    const value = Zotero.Prefs.get(translatePrefKey(key), true);
    if (typeof value === "string") return value.trim();
  } catch {
    // ignore
  }
  return defaultValue;
}

function setStringPref(key: string, value: string): void {
  try {
    Zotero.Prefs.set(translatePrefKey(key), value.trim(), true);
  } catch {
    // ignore
  }
}

function getNumberPref(
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  try {
    const value = Zotero.Prefs.get(translatePrefKey(key), true);
    const parsed =
      typeof value === "number"
        ? value
        : parseInt(String(value ?? "").trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(max, Math.floor(parsed)));
    }
  } catch {
    // ignore
  }
  return defaultValue;
}

function setNumberPref(
  key: string,
  value: number,
  min: number,
  max: number,
): number {
  const normalized = Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : min;
  setStringPref(key, String(normalized));
  return normalized;
}

function readStepperValue(
  el: HTMLElement | null,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const parsed = parseInt(el?.textContent || String(defaultValue), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function bindCheckboxPref(
  body: Element,
  id: string,
  key: string,
  defaultValue: boolean,
): HTMLInputElement | null {
  const el = body.querySelector(`#${id}`) as HTMLInputElement | null;
  if (!el) return null;
  el.checked = getBoolPref(key, defaultValue);
  el.addEventListener("change", () => setBoolPref(key, !!el.checked));
  return el;
}

function setDropdownValue(
  dropdown: HTMLElement | null,
  value: string,
  fallbackValue: string,
): void {
  if (!dropdown) return;
  const items = Array.from(
    dropdown.querySelectorAll(".llm-tr-dropdown-item"),
  ) as HTMLElement[];
  const selected =
    items.find((item) => item.dataset.value === value) ||
    items.find((item) => item.dataset.value === fallbackValue) ||
    items[0];
  if (!selected) return;
  const selectedValue = selected.dataset.value || fallbackValue;
  const trigger = dropdown.querySelector(
    ".llm-tr-dropdown-trigger",
  ) as HTMLElement | null;
  const menu = dropdown.querySelector(
    ".llm-tr-dropdown-menu",
  ) as HTMLElement | null;
  dropdown.dataset.value = selectedValue;
  if (trigger) {
    const arrow = trigger.querySelector(".llm-tr-dropdown-arrow");
    trigger.textContent = selected.textContent || selectedValue;
    if (arrow) trigger.appendChild(arrow);
  }
  for (const item of items) {
    item.classList.toggle("selected", item === selected);
  }
  if (menu) menu.style.display = "none";
  dropdown.classList.remove("open");
}

function bindDropdownPref(
  body: Element,
  id: string,
  key: string,
  fallbackValue: string,
): HTMLElement | null {
  const dropdown = body.querySelector(`#${id}`) as HTMLElement | null;
  if (!dropdown) return null;
  setDropdownValue(dropdown, getStringPref(key, fallbackValue), fallbackValue);
  dropdown.addEventListener("click", (event: Event) => {
    const target = event.target as Element | null;
    const item = target?.closest?.(
      ".llm-tr-dropdown-item",
    ) as HTMLElement | null;
    if (!item || !dropdown.contains(item)) return;
    setStringPref(key, item.dataset.value || fallbackValue);
  });
  return dropdown;
}

function bindStepperPref(
  body: Element,
  id: string,
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): HTMLElement | null {
  const el = body.querySelector(`#${id}`) as HTMLElement | null;
  if (!el) return null;
  const apply = (value: number) => {
    const normalized = setNumberPref(key, value, min, max);
    el.textContent = String(normalized);
  };
  apply(getNumberPref(key, defaultValue, min, max));
  const persist = () => apply(readStepperValue(el, defaultValue, min, max));
  el.addEventListener("input", persist);
  el.addEventListener("blur", persist);
  el.parentElement?.addEventListener("click", () => {
    const win = el.ownerDocument?.defaultView;
    if (win) {
      win.setTimeout(persist, 0);
    } else {
      persist();
    }
  });
  return el;
}

function setTranslateCollapsible(
  toggle: HTMLElement | null,
  body: HTMLElement | null,
  collapsed: boolean,
): void {
  if (!toggle || !body) return;
  toggle.dataset.collapsed = collapsed ? "true" : "false";
  body.style.display = collapsed ? "none" : "";
}

function bindCollapsiblePref(
  root: Element,
  toggleId: string,
  bodyId: string,
  key: string,
  defaultCollapsed: boolean,
): void {
  const toggle = root.querySelector(`#${toggleId}`) as HTMLElement | null;
  const content = root.querySelector(`#${bodyId}`) as HTMLElement | null;
  if (!toggle || !content) return;
  setTranslateCollapsible(toggle, content, getBoolPref(key, defaultCollapsed));
  toggle.addEventListener("click", () => {
    setBoolPref(key, toggle.dataset.collapsed === "true");
  });
}

function bindTranslateScrollPref(body: Element): void {
  const scroll = body.querySelector(
    "#llm-translate-scroll",
  ) as HTMLElement | null;
  if (!scroll) return;
  const saved = getNumberPref(TRANSLATE_PREFS.scrollTop, 0, 0, 1000000);
  const win = scroll.ownerDocument?.defaultView;
  if (saved > 0) {
    const restore = () => {
      scroll.scrollTop = saved;
    };
    if (win) win.setTimeout(restore, 0);
    else restore();
  }
  let saveTimer = 0;
  scroll.addEventListener("scroll", () => {
    if (!win) {
      setNumberPref(
        TRANSLATE_PREFS.scrollTop,
        scroll.scrollTop || 0,
        0,
        1000000,
      );
      return;
    }
    if (saveTimer) win.clearTimeout(saveTimer);
    saveTimer = win.setTimeout(() => {
      setNumberPref(
        TRANSLATE_PREFS.scrollTop,
        scroll.scrollTop || 0,
        0,
        1000000,
      );
      saveTimer = 0;
    }, 150);
  });
}

function persistCurrentTranslateOptions(body: Element): void {
  const checkboxPrefs: Array<[string, string]> = [
    ["llm-tr-mono", TRANSLATE_PREFS.outputMono],
    ["llm-tr-dual", TRANSLATE_PREFS.outputDual],
    ["llm-tr-skip-refs-auto", TRANSLATE_PREFS.skipRefsAuto],
    ["llm-tr-keep-appendix", TRANSLATE_PREFS.keepAppendixTranslated],
    ["llm-tr-protect-author", TRANSLATE_PREFS.protectAuthorBlock],
    ["llm-tr-disable-rich-text", TRANSLATE_PREFS.disableRichTextTranslate],
    ["llm-tr-enhance-compat", TRANSLATE_PREFS.enhanceCompatibility],
    ["llm-tr-translate-table", TRANSLATE_PREFS.translateTableText],
    ["llm-tr-ocr", TRANSLATE_PREFS.ocr],
    ["llm-tr-auto-ocr", TRANSLATE_PREFS.autoOcr],
    ["llm-tr-save-glossary", TRANSLATE_PREFS.saveGlossary],
    ["llm-tr-disable-glossary", TRANSLATE_PREFS.disableGlossary],
  ];
  for (const [id, key] of checkboxPrefs) {
    const el = body.querySelector(`#${id}`) as HTMLInputElement | null;
    if (el) setBoolPref(key, !!el.checked);
  }

  const dropdownPrefs: Array<[string, string, string]> = [
    ["llm-tr-source-lang", TRANSLATE_PREFS.sourceLang, "en"],
    ["llm-tr-target-lang", TRANSLATE_PREFS.targetLang, "zh-CN"],
    ["llm-tr-font-family", TRANSLATE_PREFS.fontFamily, "auto"],
  ];
  for (const [id, key, fallback] of dropdownPrefs) {
    const el = body.querySelector(`#${id}`) as HTMLElement | null;
    setStringPref(key, el?.dataset.value || fallback);
  }

  setNumberPref(
    TRANSLATE_PREFS.qps,
    readStepperValue(
      body.querySelector("#llm-tr-qps") as HTMLElement | null,
      10,
      1,
      100,
    ),
    1,
    100,
  );
  setNumberPref(
    TRANSLATE_PREFS.poolMaxWorker,
    readStepperValue(
      body.querySelector("#llm-tr-pool-max-worker") as HTMLElement | null,
      1,
      1,
      32,
    ),
    1,
    32,
  );
}

function getPersistedTranslateModel(): string {
  try {
    return String(Zotero.Prefs.get(prefKey(), true) || "").trim();
  } catch {
    return "";
  }
}

function getPersistedTranslateProvider(): string {
  try {
    return String(
      Zotero.Prefs.get(
        `${addon.data.config.prefsPrefix}.${TRANSLATE_PROVIDER_PREF}`,
        true,
      ) || "",
    ).trim();
  } catch {
    return "";
  }
}

function persistTranslateModel(name: string): void {
  try {
    Zotero.Prefs.set(prefKey(), name, true);
  } catch {
    /* ignore */
  }
}

function persistTranslateProvider(providerId: string): void {
  try {
    Zotero.Prefs.set(
      `${addon.data.config.prefsPrefix}.${TRANSLATE_PROVIDER_PREF}`,
      providerId,
      true,
    );
  } catch {
    /* ignore */
  }
}

/**
 * Populate the translate tab's custom dropdown with the same models
 * available in the chat tab.
 *
 * @param dropdownEl  the #llm-tr-model custom dropdown div element
 * @returns           the currently selected model name
 */
export function populateTranslateModelSelector(
  dropdownEl: HTMLElement,
): string {
  const { choices } = getModelChoices();
  const persisted = getPersistedTranslateModel();
  const persistedProvider = getPersistedTranslateProvider();
  const prevValue = dropdownEl.dataset.value || persisted;
  const prevProvider = dropdownEl.dataset.providerId || persistedProvider;

  const trigger = dropdownEl.querySelector(
    ".llm-tr-dropdown-trigger",
  ) as HTMLElement | null;
  const menu = dropdownEl.querySelector(
    ".llm-tr-dropdown-menu",
  ) as HTMLElement | null;
  if (!trigger || !menu) return "";

  // Clear menu
  menu.innerHTML = "";

  if (!choices.length) {
    if (trigger) {
      // Keep arrow
      const arrow = trigger.querySelector(".llm-tr-dropdown-arrow");
      trigger.textContent = "—";
      if (arrow) trigger.appendChild(arrow);
    }
    dropdownEl.dataset.value = "";
    dropdownEl.dataset.providerId = "";
    return "";
  }

  // Group by provider
  let lastProvider = "";
  let selectedModel = "";
  let selectedProviderId = "";
  const doc = dropdownEl.ownerDocument!;

  const selectItem = (model: string, providerId: string) => {
    dropdownEl.dataset.value = model;
    dropdownEl.dataset.providerId = providerId;
    // Update trigger text
    const arrow = trigger!.querySelector(".llm-tr-dropdown-arrow");
    trigger!.textContent = model;
    if (arrow) trigger!.appendChild(arrow);
    // Update selected highlight
    menu!.querySelectorAll(".llm-tr-dropdown-item").forEach((el: Element) => {
      const elModel = (el as HTMLElement).dataset.value || "";
      const elProvider = (el as HTMLElement).dataset.providerId || "";
      (el as HTMLElement).classList.toggle(
        "selected",
        elModel === model && elProvider === providerId,
      );
    });
    // Close menu
    menu!.style.display = "none";
    dropdownEl.classList.remove("open");
    // Persist
    persistTranslateModel(model);
    persistTranslateProvider(providerId);
  };

  for (const entry of choices) {
    const provider = entry.provider || "";
    if (provider && provider !== lastProvider) {
      lastProvider = provider;
      const groupLabel = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      ) as HTMLDivElement;
      groupLabel.className = "llm-tr-dropdown-group";
      groupLabel.textContent = provider;
      menu.appendChild(groupLabel);
    }

    const item = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLDivElement;
    item.className = "llm-tr-dropdown-item";
    item.dataset.value = entry.model;
    item.dataset.providerId = entry.providerId || "";
    item.textContent = entry.model;
    item.addEventListener("click", () =>
      selectItem(entry.model, entry.providerId || ""),
    );
    menu.appendChild(item);

    // Match by model + providerId for disambiguation
    if (
      (entry.model === prevValue ||
        entry.model.toLowerCase() === prevValue.toLowerCase()) &&
      (!prevProvider || entry.providerId === prevProvider)
    ) {
      selectedModel = entry.model;
      selectedProviderId = entry.providerId || "";
    } else if (
      !selectedModel &&
      (entry.model === prevValue ||
        entry.model.toLowerCase() === prevValue.toLowerCase())
    ) {
      selectedModel = entry.model;
      selectedProviderId = entry.providerId || "";
    }
  }

  // Apply selection
  if (!selectedModel) {
    selectedModel = choices[0]?.model || "";
    selectedProviderId = choices[0]?.providerId || "";
  }
  if (selectedModel) {
    selectItem(selectedModel, selectedProviderId);
  }

  return selectedModel;
}

/**
 * Get the currently selected translate model name.
 */
export function getTranslateModel(dropdownEl: HTMLElement): string {
  return dropdownEl.dataset.value || "";
}

/* ── Init: wire up event listeners ── */

/**
 * Initialize the translate tab controller.
 * Call this once after buildUI completes and the DOM is ready.
 *
 * @param body  the panel body element (contains #llm-main)
 */
export function initTranslateTab(body: Element): void {
  const modelSelect = body.querySelector("#llm-tr-model") as HTMLElement | null;
  if (!modelSelect) return;

  const outputDirEl = body.querySelector(
    "#llm-tr-output-dir",
  ) as HTMLInputElement | null;

  // Populate on init
  populateTranslateModelSelector(modelSelect);

  // Restore persisted translate options
  bindDropdownPref(
    body,
    "llm-tr-source-lang",
    TRANSLATE_PREFS.sourceLang,
    "en",
  );
  bindDropdownPref(
    body,
    "llm-tr-target-lang",
    TRANSLATE_PREFS.targetLang,
    "zh-CN",
  );
  bindDropdownPref(
    body,
    "llm-tr-font-family",
    TRANSLATE_PREFS.fontFamily,
    "auto",
  );
  bindCheckboxPref(body, "llm-tr-mono", TRANSLATE_PREFS.outputMono, true);
  bindCheckboxPref(body, "llm-tr-dual", TRANSLATE_PREFS.outputDual, true);
  bindCheckboxPref(
    body,
    "llm-tr-skip-refs-auto",
    TRANSLATE_PREFS.skipRefsAuto,
    true,
  );
  bindCheckboxPref(
    body,
    "llm-tr-keep-appendix",
    TRANSLATE_PREFS.keepAppendixTranslated,
    true,
  );
  bindCheckboxPref(
    body,
    "llm-tr-protect-author",
    TRANSLATE_PREFS.protectAuthorBlock,
    true,
  );
  bindCheckboxPref(
    body,
    "llm-tr-disable-rich-text",
    TRANSLATE_PREFS.disableRichTextTranslate,
    false,
  );
  bindCheckboxPref(
    body,
    "llm-tr-enhance-compat",
    TRANSLATE_PREFS.enhanceCompatibility,
    false,
  );
  bindCheckboxPref(
    body,
    "llm-tr-translate-table",
    TRANSLATE_PREFS.translateTableText,
    false,
  );
  bindCheckboxPref(body, "llm-tr-ocr", TRANSLATE_PREFS.ocr, false);
  bindCheckboxPref(body, "llm-tr-auto-ocr", TRANSLATE_PREFS.autoOcr, false);
  bindCheckboxPref(
    body,
    "llm-tr-save-glossary",
    TRANSLATE_PREFS.saveGlossary,
    true,
  );
  bindCheckboxPref(
    body,
    "llm-tr-disable-glossary",
    TRANSLATE_PREFS.disableGlossary,
    false,
  );
  bindStepperPref(body, "llm-tr-qps", TRANSLATE_PREFS.qps, 10, 1, 100);
  bindStepperPref(
    body,
    "llm-tr-pool-max-worker",
    TRANSLATE_PREFS.poolMaxWorker,
    1,
    1,
    32,
  );
  bindCollapsiblePref(
    body,
    "llm-tr-advanced-toggle",
    "llm-tr-advanced-body",
    TRANSLATE_PREFS.advancedCollapsed,
    true,
  );
  bindCollapsiblePref(
    body,
    "llm-tr-console-toggle",
    "llm-tr-console",
    TRANSLATE_PREFS.consoleCollapsed,
    false,
  );
  bindTranslateScrollPref(body);
  if (outputDirEl)
    outputDirEl.value = getStringPref(TRANSLATE_PREFS.outputDir, "");

  // Persist translate options on change
  outputDirEl?.addEventListener("change", () =>
    setStringPref(TRANSLATE_PREFS.outputDir, outputDirEl.value || ""),
  );
  outputDirEl?.addEventListener("blur", () =>
    setStringPref(TRANSLATE_PREFS.outputDir, outputDirEl.value || ""),
  );

  // Model selection persistence is handled internally by the custom dropdown

  // Re-populate when tab becomes visible (models may have been added/removed)
  const tabBtn = body.querySelector(
    "#llm-tab-btn-translate",
  ) as HTMLButtonElement | null;
  if (tabBtn) {
    tabBtn.addEventListener("click", () => {
      populateTranslateModelSelector(modelSelect);
      updatePdfSourceFromItem(body);
    });
  }
  const panelRoot = body.querySelector("#llm-main") as HTMLElement | null;
  if (panelRoot?.dataset.activeTab === "translate") {
    void updatePdfSourceFromItem(body);
  }

  // ── Language swap button ──
  const langSwapBtn = body.querySelector(
    "#llm-tr-lang-swap",
  ) as HTMLButtonElement | null;
  if (langSwapBtn) {
    langSwapBtn.addEventListener("click", () => {
      const srcDD = body.querySelector(
        "#llm-tr-source-lang",
      ) as HTMLElement | null;
      const tgtDD = body.querySelector(
        "#llm-tr-target-lang",
      ) as HTMLElement | null;
      if (srcDD && tgtDD) {
        const srcVal = srcDD.dataset.value || "";
        const tgtVal = tgtDD.dataset.value || "";
        // Swap by clicking the matching items
        const srcItem = tgtDD.querySelector(
          `.llm-tr-dropdown-item[data-value="${srcVal}"]`,
        ) as HTMLElement | null;
        const tgtItem = srcDD.querySelector(
          `.llm-tr-dropdown-item[data-value="${tgtVal}"]`,
        ) as HTMLElement | null;
        if (srcItem) srcItem.click();
        if (tgtItem) tgtItem.click();
      }
    });
  }

  // ── File picker button ──
  const pickFileBtn = body.querySelector(
    "#llm-tr-pick-file",
  ) as HTMLButtonElement | null;
  if (pickFileBtn) {
    pickFileBtn.addEventListener("click", async () => {
      try {
        const { pickPdfFile } = await import("./nativePicker");
        const win = (body.ownerDocument as any)?.defaultView;
        if (!win) return;
        const path = await pickPdfFile(win);
        if (path) {
          setSelectedPdfPath(body, path, true);
        }
      } catch (err) {
        const i18n = getPanelI18n();
        consoleLog(body, `❌ ${i18n.trLogError(String(err))}`, "error");
      }
    });
  }

  // ── Drag & drop PDF / library item anywhere on the translate tab ──
  bindPdfDropTarget(body);

  // ── Editable input path field (paste / type a path, Enter to apply) ──
  const pdfPathInput = body.querySelector(
    "#llm-tr-pdf-name",
  ) as HTMLInputElement | null;
  if (pdfPathInput) {
    const commitPdfPathInput = () => {
      const value = (pdfPathInput.value || "").trim();
      const session = getTranslationSession(body);
      if (value === session.selectedPdfPath) return;
      const revert = () => {
        pdfPathInput.value = session.selectedPdfPath;
        pdfPathInput.scrollLeft = pdfPathInput.scrollWidth;
      };
      if (!value) {
        // Cleared — resume auto-detecting the selected item's PDF
        session.selectedPdfPath = "";
        session.pdfSourceManual = false;
        pdfPathInput.title = pdfPathInput.placeholder || "";
        pdfPathInput
          .closest(".llm-tr-pdf-name")
          ?.setAttribute("data-empty", "true");
        return;
      }
      const isPdfPath = /\.pdf$/i.test(value.split(/[\\/]/).pop() || "");
      void (async () => {
        let valid = isPdfPath;
        if (valid) {
          try {
            valid = await IOUtils.exists(value);
          } catch {
            // Existence check failed — let the translation engine decide
            valid = true;
          }
        }
        if (!valid) {
          const i18n = getPanelI18n();
          consoleLog(body, `⚠️ ${i18n.trLogInvalidPdfPath(value)}`, "error");
          revert();
          return;
        }
        setSelectedPdfPath(body, value, true);
      })();
    };
    pdfPathInput.addEventListener("change", commitPdfPathInput);
    pdfPathInput.addEventListener("blur", commitPdfPathInput);
    pdfPathInput.addEventListener("keydown", (e: Event) => {
      if ((e as KeyboardEvent).key === "Enter") {
        e.preventDefault();
        pdfPathInput.blur();
      }
    });
  }

  // ── Browse output directory ──
  const browseDirBtn = body.querySelector(
    "#llm-tr-browse-dir",
  ) as HTMLButtonElement | null;
  if (browseDirBtn) {
    browseDirBtn.addEventListener("click", async () => {
      try {
        const { pickDirectory } = await import("./nativePicker");
        const win = (body.ownerDocument as any)?.defaultView;
        if (!win) return;
        const path = await pickDirectory(win);
        if (path) {
          const dirInput = body.querySelector(
            "#llm-tr-output-dir",
          ) as HTMLInputElement | null;
          if (dirInput) {
            dirInput.value = path;
            setStringPref(TRANSLATE_PREFS.outputDir, path);
          }
        }
      } catch (err) {
        const i18n = getPanelI18n();
        consoleLog(body, `❌ ${i18n.trLogError(String(err))}`, "error");
      }
    });
  }

  // ── Console clear button ──
  const consoleClearBtn = body.querySelector(
    "#llm-tr-console-clear",
  ) as HTMLButtonElement | null;
  if (consoleClearBtn) {
    consoleClearBtn.addEventListener("click", () => {
      clearConsole(body);
    });
  }

  // ── Console copy button ──
  const consoleCopyBtn = body.querySelector(
    "#llm-tr-console-copy",
  ) as HTMLButtonElement | null;
  if (consoleCopyBtn) {
    consoleCopyBtn.addEventListener("click", () => {
      copyConsole(body);
    });
  }

  // ── Install environment button ──
  const installBtn = body.querySelector(
    "#llm-tr-install-env",
  ) as HTMLButtonElement | null;
  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      const i18n = getPanelI18n();
      installBtn.disabled = true;
      consoleLog(body, i18n.trLogEnvironmentSetupStarting, "info");
      try {
        const { installEnvironment } = await import("./envManager");
        await installEnvironment((step, detail) => {
          consoleLog(
            body,
            detail,
            detail.startsWith("✅") ? "success" : "info",
          );
        });
        consoleLog(body, `✅ ${i18n.trLogEnvironmentSetupComplete}`, "success");
      } catch (err) {
        consoleLog(body, `❌ ${i18n.trLogError(String(err))}`, "error");
        // Try to read the stderr log for more details
        try {
          const tempDir = String(PathUtils.tempDir || "").trim();
          const logPath = tempDir
            ? PathUtils.join(tempDir, "aidea-cmd.log")
            : "";
          if (logPath && (await IOUtils.exists(logPath))) {
            const logText = await IOUtils.readUTF8(logPath);
            if (logText.trim()) {
              consoleLog(
                body,
                `📝 ${i18n.trLogDetails(logText.trim())}`,
                "error",
              );
            }
          }
        } catch {
          /* ignore log read failure */
        }
      } finally {
        installBtn.disabled = false;
      }
    });
  }

  // ── Start translation button ──
  const startBtn = body.querySelector(
    "#llm-tr-start",
  ) as HTMLButtonElement | null;
  const pauseBtn = body.querySelector(
    "#llm-tr-pause",
  ) as HTMLButtonElement | null;
  const clearBtn = body.querySelector(
    "#llm-tr-clear",
  ) as HTMLButtonElement | null;
  if (startBtn) {
    startBtn.addEventListener("click", async () => {
      startBtn.disabled = true;
      try {
        await startTranslation(body);
      } catch (err) {
        const i18n = getPanelI18n();
        consoleLog(body, `❌ ${i18n.trLogError(String(err))}`, "error");
      } finally {
        startBtn.disabled = false;
      }
    });
  }

  // ── Pause / Resume button ──
  if (pauseBtn) {
    pauseBtn.addEventListener("click", async () => {
      const session = getTranslationSession(body);
      if (!session.activeController) return;
      try {
        if (session.isPaused) {
          // Resume — re-start translation to continue from cache
          session.isPaused = false;
          const i18n = getPanelI18n();
          pauseBtn.textContent = `⏸ ${i18n.trPause}`;
          pauseBtn.className = "llm-tr-btn llm-tr-btn-warning";
          consoleLog(body, `▶️ ${i18n.trLogResumed}`, "info");
        } else {
          // Pause
          session.activeController.pause();
          session.isPaused = true;
          const i18n = getPanelI18n();
          pauseBtn.textContent = `▶ ${i18n.trResume}`;
          pauseBtn.className = "llm-tr-btn llm-tr-btn-primary";
          consoleLog(body, `⏸ ${i18n.trLogPaused}`, "info");
        }
      } catch (err) {
        const i18n = getPanelI18n();
        consoleLog(body, `❌ ${i18n.trLogPauseError(String(err))}`, "error");
      }
    });
  }

  // ── Clear cache button ──
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      // Block clearing while translation is actively running
      const session = getTranslationSession(body);
      const activeState = session.activeController?.getState?.();
      if (activeState === "running" && !session.isPaused) {
        const i18n = getPanelI18n();
        consoleLog(body, `⚠️ ${i18n.trLogCannotClearRunning}`, "error");
        return;
      }
      clearBtn.disabled = true;
      try {
        // Stop active controller if paused
        if (session.activeController) {
          try {
            session.activeController.abort?.();
          } catch {
            /* ignore */
          }
        }
        const cleared = await clearTranslateTempCache();
        const i18n = getPanelI18n();
        consoleLog(
          body,
          i18n.trLogCacheDetails(cleared.removed, cleared.skippedRunning),
          "info",
        );
        consoleLog(body, `🗑 ${i18n.trLogClearDone}`, "info");
      } catch (err) {
        const i18n = getPanelI18n();
        consoleLog(body, `❌ ${i18n.trLogClearError(String(err))}`, "error");
      } finally {
        resetTranslationSessionUi(session, body);
      }
    });
  }
}

/**
 * Refresh the translate model selector (e.g., after OAuth model list update).
 */
export function refreshTranslateModels(body: Element): void {
  const modelSelect = body.querySelector("#llm-tr-model") as HTMLElement | null;
  if (modelSelect) populateTranslateModelSelector(modelSelect);
}

/* ── Internal helpers ── */

/** Store the currently selected PDF path as a data attribute */
interface TranslationSession {
  selectedPdfPath: string;
  /** True once the user explicitly picked / dropped a PDF in this panel */
  pdfSourceManual: boolean;
  translationStartTime: number;
  isPaused: boolean;
  activeController: any;
  progressTimer: ReturnType<typeof setInterval> | null;
  targetProgressPct: number;
  displayProgressPct: number;
  translationBody: Element | null;
  heartbeatCounter: number;
  lastKnownCurrentPage: number | null;
  lastKnownTotalPages: number | null;
  recentPageDurationsSec: number[];
  lastPageBoundaryAt: number;
  lastPageBoundaryPage: number | null;
}

const _translationSessions = new WeakMap<Element, TranslationSession>();

function createTranslationSession(): TranslationSession {
  return {
    selectedPdfPath: "",
    pdfSourceManual: false,
    translationStartTime: 0,
    isPaused: false,
    activeController: null,
    progressTimer: null,
    targetProgressPct: 0,
    displayProgressPct: 0,
    translationBody: null,
    heartbeatCounter: 0,
    lastKnownCurrentPage: null,
    lastKnownTotalPages: null,
    recentPageDurationsSec: [],
    lastPageBoundaryAt: 0,
    lastPageBoundaryPage: null,
  };
}

function getTranslationSession(body: Element): TranslationSession {
  let session = _translationSessions.get(body);
  if (!session) {
    session = createTranslationSession();
    _translationSessions.set(body, session);
  }
  return session;
}

/** Track translation start time for elapsed/remaining calculations */

/** Track pause state */

/** Active controller instance for pause/resume/clear */

/** Independent progress bar refresh timer (1s) */
/** Last known progress percentage for timer-based refresh */
/** Reference to body element for timer-based updates */
/** Heartbeat counter — log every 15s when idle */

const PROGRESS_TIMER_INTERVAL_MS = 250;
const PROGRESS_SMOOTHING_FACTOR = 0.18;
const PROGRESS_MIN_STEP = 0.25;
const PAGE_DURATION_HISTORY_LIMIT = 8;

/**
 * Sessions with live translation work (progress timer and/or running
 * subprocess). The plugin shutdown hook drains this set so no interval keeps
 * ticking on detached DOM and no pdf2zh/python subprocess outlives Zotero.
 */
const activeProgressSessions = new Set<TranslationSession>();

function setSelectedPdfPath(
  body: Element,
  pdfPath: string,
  manual = false,
): void {
  const session = getTranslationSession(body);
  session.selectedPdfPath = pdfPath;
  if (manual) session.pdfSourceManual = true;
  const nameEl = body.querySelector(
    "#llm-tr-pdf-name",
  ) as HTMLInputElement | null;
  if (nameEl) {
    nameEl.value = pdfPath;
    nameEl.title = pdfPath || nameEl.placeholder || "";
    // Keep the filename (end of the path) visible in the narrow box
    nameEl.scrollLeft = nameEl.scrollWidth;
    nameEl
      .closest(".llm-tr-pdf-name")
      ?.setAttribute("data-empty", pdfPath ? "false" : "true");
  }
}

function resetProgressTracking(session: TranslationSession): void {
  session.targetProgressPct = 0;
  session.displayProgressPct = 0;
  session.lastKnownCurrentPage = null;
  session.lastKnownTotalPages = null;
  session.recentPageDurationsSec = [];
  session.lastPageBoundaryAt = 0;
  session.lastPageBoundaryPage = null;
}

function recordPageProgress(
  session: TranslationSession,
  current?: number,
  total?: number,
): void {
  if (
    typeof current !== "number" ||
    !Number.isFinite(current) ||
    typeof total !== "number" ||
    !Number.isFinite(total) ||
    current <= 0 ||
    total <= 0
  ) {
    return;
  }

  session.lastKnownCurrentPage = current;
  session.lastKnownTotalPages = total;

  const now = Date.now();
  if (
    session.lastPageBoundaryPage !== null &&
    current > session.lastPageBoundaryPage &&
    session.lastPageBoundaryAt > 0
  ) {
    const deltaPages = current - session.lastPageBoundaryPage;
    const deltaSec = (now - session.lastPageBoundaryAt) / 1000;
    if (deltaPages > 0 && deltaSec > 0) {
      session.recentPageDurationsSec.push(deltaSec / deltaPages);
      if (session.recentPageDurationsSec.length > PAGE_DURATION_HISTORY_LIMIT) {
        session.recentPageDurationsSec = session.recentPageDurationsSec.slice(
          -PAGE_DURATION_HISTORY_LIMIT,
        );
      }
    }
  }

  if (
    session.lastPageBoundaryPage === null ||
    current !== session.lastPageBoundaryPage
  ) {
    session.lastPageBoundaryPage = current;
    session.lastPageBoundaryAt = now;
  }
}

function updateProgress(
  session: TranslationSession,
  body: Element,
  pct: number,
  _text: string,
  opts?: { current?: number; total?: number; force?: boolean },
): void {
  const safePct = Math.max(0, Math.min(100, pct));
  if (opts?.force) {
    session.targetProgressPct = safePct;
    session.displayProgressPct = safePct;
  } else {
    session.targetProgressPct = Math.max(session.targetProgressPct, safePct);
  }
  recordPageProgress(session, opts?.current, opts?.total);
  _refreshProgressBar(session, body);
}

function estimateRemainingSeconds(
  session: TranslationSession,
  elapsedSeconds: number,
): number | null {
  if (session.displayProgressPct >= 100) return 0;

  if (
    session.lastKnownCurrentPage !== null &&
    session.lastKnownTotalPages !== null &&
    session.recentPageDurationsSec.length > 0
  ) {
    const remainingPages = Math.max(
      0,
      session.lastKnownTotalPages - session.lastKnownCurrentPage,
    );
    const avgPerPage =
      session.recentPageDurationsSec.reduce((sum, value) => sum + value, 0) /
      session.recentPageDurationsSec.length;
    return remainingPages * avgPerPage;
  }

  if (session.displayProgressPct > 0 && elapsedSeconds > 0) {
    const totalEstimated = elapsedSeconds / (session.displayProgressPct / 100);
    return Math.max(0, totalEstimated - elapsedSeconds);
  }

  return null;
}

function advanceDisplayedProgress(session: TranslationSession): void {
  if (session.displayProgressPct >= session.targetProgressPct) return;
  const delta = session.targetProgressPct - session.displayProgressPct;
  const step =
    session.targetProgressPct >= 100
      ? delta
      : Math.max(PROGRESS_MIN_STEP, delta * PROGRESS_SMOOTHING_FACTOR);
  session.displayProgressPct = Math.min(
    session.targetProgressPct,
    session.displayProgressPct + step,
  );
}

/** Refresh progress bar time display (called by both poller and timer) */
function _refreshProgressBar(session: TranslationSession, body: Element): void {
  const fill = body.querySelector(
    "#llm-tr-progress-fill",
  ) as HTMLElement | null;
  if (fill) {
    const pct = Math.max(0, Math.min(100, session.displayProgressPct));
    fill.style.width = `${pct}%`;
    const i18n = getPanelI18n();
    const elapsed =
      session.translationStartTime > 0
        ? (Date.now() - session.translationStartTime) / 1000
        : 0;
    const elapsedStr = formatDuration(elapsed);
    let remainStr = "--:--";
    const remaining = estimateRemainingSeconds(session, elapsed);
    if (remaining !== null && pct < 100) {
      remainStr = formatDuration(remaining);
    } else if (pct >= 100) {
      remainStr = "00:00";
    }
    const isZh = i18n.tabTranslate === "缈昏瘧";
    const elapsedLabel = isZh ? "宸茬敤" : "Elapsed";
    const remainLabel = isZh ? "鍓╀綑" : "Remaining";
    const pageText =
      session.lastKnownCurrentPage !== null &&
      session.lastKnownTotalPages !== null &&
      session.lastKnownTotalPages > 0
        ? ` | Page ${session.lastKnownCurrentPage}/${session.lastKnownTotalPages}`
        : "";
    fill.textContent =
      pct > 0
        ? `${Math.round(pct)}%${pageText} | ${elapsedLabel}: ${elapsedStr} | ${remainLabel}: ${remainStr}`
        : "";
  }
}

/** Start the independent 1s progress bar timer */
function _startProgressTimer(session: TranslationSession, body: Element): void {
  _stopProgressTimer(session);
  session.translationBody = body;
  session.heartbeatCounter = 0;
  activeProgressSessions.add(session);
  session.progressTimer = setInterval(() => {
    const translationBody = session.translationBody;
    if (!translationBody) return;
    if (!translationBody.isConnected) {
      // The panel host (and its window) went away — stop ticking on
      // detached DOM instead of leaking the interval until shutdown.
      _stopProgressTimer(session);
      return;
    }
    if (session.translationStartTime > 0) {
      advanceDisplayedProgress(session);
      _refreshProgressBar(session, translationBody);
    }
  }, PROGRESS_TIMER_INTERVAL_MS);
}

/** Stop the progress bar timer */
function _stopProgressTimer(session: TranslationSession): void {
  if (session.progressTimer) {
    clearInterval(session.progressTimer);
    session.progressTimer = null;
  }
  session.translationBody = null;
  session.heartbeatCounter = 0;
  activeProgressSessions.delete(session);
}

/** Stop every live progress timer (used on plugin shutdown). */
export function stopAllProgressTimers(): void {
  for (const session of Array.from(activeProgressSessions)) {
    _stopProgressTimer(session);
  }
}

/**
 * Abort translation work that belongs to `win`'s document (used when a
 * main window closes while a job runs in it).
 */
export function abortTranslationsForWindow(win: Window): void {
  for (const session of Array.from(activeProgressSessions)) {
    const sessionWin = session.translationBody?.ownerDocument?.defaultView;
    if (sessionWin !== win) continue;
    try {
      session.activeController?.abort?.();
    } catch (err) {
      ztoolkit.log("LLM: failed to abort translation on window unload", err);
    }
    _stopProgressTimer(session);
  }
}

function restoreTranslationControls(body: Element): void {
  const i18n = getPanelI18n();
  const startBtn = body.querySelector(
    "#llm-tr-start",
  ) as HTMLButtonElement | null;
  const pauseBtn = body.querySelector(
    "#llm-tr-pause",
  ) as HTMLButtonElement | null;
  const clearBtn = body.querySelector(
    "#llm-tr-clear",
  ) as HTMLButtonElement | null;

  if (startBtn) {
    startBtn.style.display = "";
    startBtn.disabled = false;
  }
  if (pauseBtn) {
    pauseBtn.style.display = "none";
    pauseBtn.disabled = false;
    pauseBtn.textContent = `鈴?${i18n.trPause}`;
    pauseBtn.className = "llm-tr-btn llm-tr-btn-warning";
  }
  if (clearBtn) clearBtn.disabled = false;
}

function resetTranslationSessionUi(
  session: TranslationSession,
  body: Element,
): void {
  _stopProgressTimer(session);
  session.translationStartTime = 0;
  session.isPaused = false;
  session.activeController = null;
  resetProgressTracking(session);
  updateProgress(session, body, 0, "", { force: true });
  restoreTranslationControls(body);
}
async function clearTranslateTempCache(): Promise<{
  removed: number;
  skippedRunning: number;
}> {
  return cleanupTranslateTempCache();
}

/** Format seconds to MM:SS or HH:MM:SS */
function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Append a timestamped line to the console log area. */
function consoleLog(
  body: Element,
  msg: string,
  level: "info" | "success" | "error" = "info",
): void {
  const consoleBody = body.querySelector(
    "#llm-tr-console-body",
  ) as HTMLElement | null;
  if (!consoleBody) return;
  const doc = body.ownerDocument;
  if (!doc) return;

  // Auto-expand console if it is collapsed
  const consoleToggle = body.querySelector(
    "#llm-tr-console-toggle",
  ) as HTMLElement | null;
  const consoleEl = body.querySelector("#llm-tr-console") as HTMLElement | null;
  if (
    consoleToggle &&
    consoleToggle.dataset.collapsed === "true" &&
    consoleEl
  ) {
    consoleToggle.dataset.collapsed = "false";
    consoleEl.style.display = "";
  }

  const line = doc.createElement("div");
  line.className = `llm-tr-console-line ${level}`;

  const time = doc.createElement("span");
  time.className = "llm-tr-console-time";
  const now = new Date();
  time.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  const msgSpan = doc.createElement("span");
  msgSpan.className = "llm-tr-console-msg";
  msgSpan.textContent = msg;

  line.append(time, msgSpan);
  consoleBody.appendChild(line);

  // Auto-scroll to bottom
  consoleBody.scrollTop = consoleBody.scrollHeight;
}

/** Clear all console log lines. */
function clearConsole(body: Element): void {
  const consoleBody = body.querySelector(
    "#llm-tr-console-body",
  ) as HTMLElement | null;
  if (consoleBody) consoleBody.textContent = "";
}

/** Copy all console text to clipboard. */
function copyConsole(body: Element): void {
  const consoleBody = body.querySelector(
    "#llm-tr-console-body",
  ) as HTMLElement | null;
  if (!consoleBody) return;
  const lines = consoleBody.querySelectorAll(".llm-tr-console-line");
  const text = (Array.from(lines) as Element[])
    .map((line) => {
      const time =
        line.querySelector(".llm-tr-console-time")?.textContent || "";
      const msg = line.querySelector(".llm-tr-console-msg")?.textContent || "";
      return `${time}  ${msg}`;
    })
    .join("\n");
  // Use Zotero's built-in clipboard helper
  try {
    const clipboardHelper = (Components.classes as any)[
      "@mozilla.org/widget/clipboardhelper;1"
    ]?.getService((Components.interfaces as any).nsIClipboardHelper);
    if (clipboardHelper) {
      clipboardHelper.copyString(text);
    }
  } catch {
    // Fallback: modern clipboard API
    try {
      (body.ownerDocument as any)?.defaultView?.navigator?.clipboard?.writeText(
        text,
      );
    } catch {
      /* ignore */
    }
  }
}

/* ── Drag & drop PDF onto the translate tab ── */

/**
 * Accept PDF file drops (from the OS) and Zotero item drops (from the
 * library pane) on the translate tab, mirroring the chat input's drag &
 * drop behavior. Handlers attach to both the input path row (so a drop
 * directly on the box always works) and the whole tab panel.
 */
function bindPdfDropTarget(body: Element): void {
  const dropHighlight = body.querySelector(
    "#llm-tr-input-path-block",
  ) as HTMLElement | null;
  const targets = [
    dropHighlight,
    body.querySelector("#llm-tab-panel-translate"),
  ].filter((el): el is HTMLElement => el instanceof Element && !!el);
  if (!targets.length) return;
  ztoolkit.log("LLM: translate tab drop targets bound", targets.length);

  for (const target of targets) {
    let dragDepth = 0;
    const setDragOver = (active: boolean) => {
      dropHighlight?.classList.toggle("llm-tr-dragover", active);
    };

    target.addEventListener("dragenter", (e: Event) => {
      const dragEvent = e as DragEvent;
      if (!isFileDragEvent(dragEvent) && !isZoteroItemDragEvent(dragEvent)) {
        return;
      }
      dragEvent.preventDefault();
      dragEvent.stopPropagation();
      dragDepth += 1;
      setDragOver(true);
    });

    target.addEventListener("dragover", (e: Event) => {
      const dragEvent = e as DragEvent;
      if (!isFileDragEvent(dragEvent) && !isZoteroItemDragEvent(dragEvent)) {
        return;
      }
      dragEvent.preventDefault();
      dragEvent.stopPropagation();
      if (dragEvent.dataTransfer) dragEvent.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    });

    target.addEventListener("dragleave", (e: Event) => {
      const dragEvent = e as DragEvent;
      if (!isFileDragEvent(dragEvent) && !isZoteroItemDragEvent(dragEvent)) {
        return;
      }
      dragEvent.preventDefault();
      dragEvent.stopPropagation();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragOver(false);
    });

    target.addEventListener("drop", (e: Event) => {
      const dragEvent = e as DragEvent;
      if (!isFileDragEvent(dragEvent) && !isZoteroItemDragEvent(dragEvent)) {
        return;
      }
      dragEvent.preventDefault();
      dragEvent.stopPropagation();
      dragDepth = 0;
      setDragOver(false);
      void handlePdfDrop(body, dragEvent);
    });
  }
}

/**
 * Resolve a dropped PDF / Zotero item to a filesystem path and select it.
 */
async function handlePdfDrop(body: Element, event: DragEvent): Promise<void> {
  const i18n = getPanelI18n();
  const dt = event.dataTransfer;
  if (!dt) return;

  // 1) OS file drop — resolve the real filesystem path of the dropped PDF
  if (isFileDragEvent(event)) {
    const pdfs = await collectDroppedPdfCandidates(dt);
    if (pdfs.length) {
      const firstWithPath = pdfs.find((pdf) => pdf.path);
      if (firstWithPath?.path) {
        setSelectedPdfPath(body, firstWithPath.path, true);
        consoleLog(
          body,
          `📥 ${i18n.trLogDroppedPdf(firstWithPath.name)}`,
          "success",
        );
        return;
      }
      consoleLog(body, `⚠️ ${i18n.trLogDropPathUnavailable}`, "error");
      return;
    }
    consoleLog(body, `⚠️ ${i18n.trLogDropNoPdf}`, "error");
    return;
  }

  // 2) Zotero item drag — resolve the best PDF attachment of the dropped item
  if (isZoteroItemDragEvent(event)) {
    const ids = getZoteroDragItemIds(event);
    const items = ids
      .map((id) => Zotero.Items.get(id))
      .filter((item: any) => !!item);
    try {
      const { resolveItemPdfPath } = await import("./pdfSourceResolver");
      for (const item of items) {
        const path = await resolveItemPdfPath(item);
        if (!path) continue;
        setSelectedPdfPath(body, path, true);
        const basename = path.split(/[\\/]/).pop() || path;
        consoleLog(
          body,
          `📥 ${i18n.trLogDroppedItemResolved(basename)}`,
          "success",
        );
        return;
      }
    } catch (err) {
      ztoolkit.log("LLM: Failed to resolve dropped Zotero item PDF", err);
    }
    consoleLog(body, `⚠️ ${i18n.trLogDropNoPdf}`, "error");
  }
}

/** A PDF found in a drop: a display name and its local path (if resolvable) */
interface DroppedPdfCandidate {
  name: string;
  path: string | null;
}

/**
 * Collect PDFs from a file drop. Two sources, mirroring Zotero's own
 * drag-drop handling:
 *   - `dataTransfer.files` — Gecko exposes the real path on File objects
 *     in chrome context (`file.path`).
 *   - `application/x-moz-file` — nsIFile objects via `mozGetDataAt`, the
 *     flavor Zotero's collection tree uses for OS file drops.
 */
async function collectDroppedPdfCandidates(
  dt: DataTransfer,
): Promise<DroppedPdfCandidate[]> {
  const candidates: DroppedPdfCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = async (name: unknown, path: unknown) => {
    const normalizedPath = String(path ?? "").trim();
    const displayName =
      String(name ?? "").trim() ||
      normalizedPath.split(/[\\/]/).pop() ||
      normalizedPath;
    if (!displayName || !/\.pdf$/i.test(displayName)) return;
    const dedupeKey = (normalizedPath || displayName).toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    let resolvedPath: string | null = normalizedPath || null;
    // On macOS a file URL can keep percent escapes when its strict URI
    // parser chokes on the path — unescape if the escaped path is not on
    // disk (same workaround as Zotero.DragDrop.getDataFromDataTransfer).
    if (
      resolvedPath &&
      Zotero.isMac &&
      /%[0-9A-F]{2}/i.test(resolvedPath) &&
      !(await IOUtils.exists(resolvedPath))
    ) {
      try {
        resolvedPath = decodeURIComponent(resolvedPath);
      } catch {
        /* keep the escaped path */
      }
    }
    candidates.push({ name: displayName, path: resolvedPath });
  };

  const files = Array.from(dt.files || []) as File[];
  for (const file of files) {
    const fileLike = file as File & { mozFullPath?: string; path?: string };
    try {
      await addCandidate(fileLike.name, fileLike.path ?? fileLike.mozFullPath);
    } catch {
      /* skip unreadable entry */
    }
  }

  if (dt.types.includes("application/x-moz-file")) {
    const count = (dt as any).mozItemCount || 1;
    for (let i = 0; i < count; i++) {
      let entry: any;
      try {
        entry = (dt as any).mozGetDataAt("application/x-moz-file", i);
      } catch {
        continue;
      }
      if (!entry) continue;
      try {
        entry.QueryInterface(Components.interfaces.nsIFile);
      } catch {
        /* not an nsIFile — ignore */
      }
      try {
        if (typeof entry.isDirectory === "function" && entry.isDirectory()) {
          continue;
        }
      } catch {
        /* fall through — treat as a file */
      }
      await addCandidate(entry.leafName, entry.path);
    }
  }

  // Some drag sources (browsers, archive tools) only provide a file URL
  try {
    const mozUrl = String(dt.getData("text/x-moz-url") || "")
      .split("\n")[0]
      ?.trim();
    if (mozUrl && mozUrl.startsWith("file://")) {
      const file = Services.io
        .newURI(mozUrl)
        .QueryInterface(Components.interfaces.nsIFileURL).file;
      if (file) await addCandidate(file.leafName, file.path);
    }
  } catch {
    /* not a local file URL — ignore */
  }

  return candidates;
}

/**
 * Auto-detect PDF from the current Zotero item.
 */
async function updatePdfSourceFromItem(body: Element): Promise<void> {
  try {
    // An explicit user choice (file picker / drag & drop) wins over
    // auto-detect, so switching tabs doesn't silently replace it.
    if (getTranslationSession(body).pdfSourceManual) return;
    const { resolveItemPdfPath } = await import("./pdfSourceResolver");
    // Get current item from Zotero
    const pane = (Zotero as any).getActiveZoteroPane?.();
    const items = pane?.getSelectedItems?.() || [];
    const item = items[0];
    if (item) {
      const path = await resolveItemPdfPath(item);
      if (path) {
        setSelectedPdfPath(body, path);
        return;
      }
    }
  } catch {
    // ignore — user can always pick manually
  }
}

/**
 * Main translation flow.
 */
async function startTranslation(body: Element): Promise<void> {
  const i18n = getPanelI18n();
  const session = getTranslationSession(body);
  const activeState = session.activeController?.getState?.();
  if (activeState === "running") {
    consoleLog(body, i18n.trLogError(i18n.trTranslating), "error");
    return;
  }

  // Gather parameters
  const modelSelect = body.querySelector("#llm-tr-model") as HTMLElement | null;
  const modelName = modelSelect?.dataset.value || "";
  const modelProviderId = modelSelect?.dataset.providerId || "";
  if (!modelName) {
    consoleLog(body, i18n.trLogError(i18n.modelNoModels), "error");
    return;
  }
  if (!session.selectedPdfPath) {
    consoleLog(body, i18n.trLogError(i18n.trNoPdfFound), "error");
    return;
  }

  const srcLang =
    (body.querySelector("#llm-tr-source-lang") as HTMLElement)?.dataset.value ||
    "en";
  const tgtLang =
    (body.querySelector("#llm-tr-target-lang") as HTMLElement)?.dataset.value ||
    "zh-CN";
  const monoChecked =
    (body.querySelector("#llm-tr-mono") as HTMLInputElement)?.checked ?? true;
  const dualChecked =
    (body.querySelector("#llm-tr-dual") as HTMLInputElement)?.checked ?? true;
  const outputDirInput = (
    (body.querySelector("#llm-tr-output-dir") as HTMLInputElement)?.value || ""
  ).trim();
  const skipReferencesAuto =
    (body.querySelector("#llm-tr-skip-refs-auto") as HTMLInputElement)
      ?.checked ?? true;
  // ── Performance inputs ──
  const qps = readStepperValue(
    body.querySelector("#llm-tr-qps") as HTMLElement | null,
    10,
    1,
    100,
  );
  const poolMaxWorker = readStepperValue(
    body.querySelector("#llm-tr-pool-max-worker") as HTMLElement | null,
    1,
    1,
    32,
  );

  // ── Advanced settings (read from collapsible panel) ──
  const keepAppendixTranslated =
    (body.querySelector("#llm-tr-keep-appendix") as HTMLInputElement)
      ?.checked ?? true;
  const protectAuthorBlock =
    (body.querySelector("#llm-tr-protect-author") as HTMLInputElement)
      ?.checked ?? true;
  const disableRichTextTranslate =
    (body.querySelector("#llm-tr-disable-rich-text") as HTMLInputElement)
      ?.checked ?? false;
  const enhanceCompatibility =
    (body.querySelector("#llm-tr-enhance-compat") as HTMLInputElement)
      ?.checked ?? false;
  const translateTableText =
    (body.querySelector("#llm-tr-translate-table") as HTMLInputElement)
      ?.checked ?? false;
  const ocrEl = body.querySelector("#llm-tr-ocr") as HTMLInputElement | null;
  const autoOcrEl = body.querySelector(
    "#llm-tr-auto-ocr",
  ) as HTMLInputElement | null;
  const ocr = ocrEl?.checked ?? getBoolPref(TRANSLATE_PREFS.ocr, false);
  const autoOcr =
    autoOcrEl?.checked ?? getBoolPref(TRANSLATE_PREFS.autoOcr, false);
  const saveGlossary =
    (body.querySelector("#llm-tr-save-glossary") as HTMLInputElement)
      ?.checked ?? true;
  const disableGlossary =
    (body.querySelector("#llm-tr-disable-glossary") as HTMLInputElement)
      ?.checked ?? false;
  const fontFamily = ((body.querySelector("#llm-tr-font-family") as HTMLElement)
    ?.dataset.value || "auto") as "auto" | "serif" | "sans-serif" | "script";
  persistCurrentTranslateOptions(body);

  if (!outputDirInput) {
    consoleLog(body, `⚠️ ${i18n.requiredOutputFolder}`, "error");
    return;
  }
  setStringPref(TRANSLATE_PREFS.outputDir, outputDirInput);
  const outputDir = outputDirInput;

  // Detailed console logging
  const pdfBasename =
    session.selectedPdfPath.split(/[\\/]/).pop() || session.selectedPdfPath;
  consoleLog(body, `─── ${i18n.trLogJobStarted} ───`, "info");
  consoleLog(body, `📄 ${i18n.trLogPdfLabel}: ${pdfBasename}`, "info");
  consoleLog(
    body,
    `   ${i18n.trLogFullPath}: ${session.selectedPdfPath}`,
    "info",
  );
  consoleLog(body, `🤖 ${i18n.trLogModelLabel}: ${modelName}`, "info");
  consoleLog(
    body,
    `🌐 ${i18n.trLogLanguageLabel}: ${srcLang} → ${tgtLang}`,
    "info",
  );
  consoleLog(body, `📁 ${i18n.trLogOutputLabel}: ${outputDir}`, "info");
  consoleLog(
    body,
    `📝 ${i18n.trLogOutputFormat(monoChecked, dualChecked)}`,
    "info",
  );
  consoleLog(
    body,
    `⚙️ ${i18n.trLogAdvancedOptions(
      skipReferencesAuto,
      enhanceCompatibility,
      ocr,
      autoOcr,
    )}`,
    "info",
  );

  // Resolve model credentials
  consoleLog(body, `🔑 ${i18n.trLogResolvingCredentials}`, "info");
  const { resolveModelCredentialsOrThrow } = await import("./modelResolver");
  let creds;
  try {
    creds = await resolveModelCredentialsOrThrow(
      modelName,
      modelProviderId || undefined,
    );
  } catch (err) {
    consoleLog(
      body,
      `❌ ${i18n.trLogFailedToResolveCredentials(String(err))}`,
      "error",
    );
    return;
  }
  const authMode = creds.oauthProxy
    ? creds.oauthProxy.provider === "openai-compatible"
      ? "API Key (proxied)"
      : `OAuth (${creds.oauthProxy.provider})`
    : "API Key";
  consoleLog(body, `🔑 ${i18n.trLogAuthLabel}: ${authMode}`, "success");
  consoleLog(body, `   ${i18n.trLogModelIdLabel}: ${creds.modelId}`, "info");
  consoleLog(body, `   ${i18n.trLogApiBaseLabel}: ${creds.apiUrl}`, "info");

  // Check environment
  consoleLog(body, `🔍 ${i18n.trLogCheckingEnvironment}`, "info");
  const { checkEnvironment } = await import("./envManager");
  const envStatus = await checkEnvironment();
  if (envStatus.status !== "ready") {
    consoleLog(
      body,
      `❌ ${i18n.trLogEnvironmentNotReady(envStatus.status)}`,
      "error",
    );
    if (envStatus.diagnostics?.length) {
      for (const line of envStatus.diagnostics) {
        consoleLog(body, `   ${line}`, "info");
      }
    }
    consoleLog(body, `   ${i18n.trLogInstallEnvironmentInstruction}`, "error");
    return;
  }
  consoleLog(
    body,
    `✅ ${i18n.trLogEnvironmentReady(envStatus.venvDir)}`,
    "success",
  );
  consoleLog(
    body,
    `   ${i18n.trLogPythonLabel}: ${envStatus.pythonBin}`,
    "info",
  );
  consoleLog(
    body,
    `   ${i18n.trLogPdf2zhLabel}: ${envStatus.pdf2zhBin}`,
    "info",
  );

  // Reset timer and pause state
  session.translationStartTime = Date.now();
  session.isPaused = false;
  resetProgressTracking(session);
  updateProgress(session, body, 0, "", { force: true });
  _startProgressTimer(session, body);

  // Show pause button, hide start button
  const startBtn = body.querySelector(
    "#llm-tr-start",
  ) as HTMLButtonElement | null;
  const pauseBtn = body.querySelector(
    "#llm-tr-pause",
  ) as HTMLButtonElement | null;
  if (startBtn) startBtn.style.display = "none";
  if (pauseBtn) {
    pauseBtn.style.display = "";
    pauseBtn.textContent = `⏸ ${i18n.trPause}`;
    pauseBtn.className = "llm-tr-btn llm-tr-btn-warning";
  }

  // Use TranslateController to run the translation
  const { TranslateController } = await import("./index");
  let lastStageLogged = "";

  const controller = new TranslateController((event) => {
    switch (event.type) {
      case "progress": {
        const pct = event.data.progress;
        const msg = event.data.message || "";
        const status = event.data.status || "";
        const stage = event.data.stage || "";
        const detail = event.data.detail || "";
        updateProgress(session, body, pct, msg, {
          current: event.data.current,
          total: event.data.total,
        });

        const stageSummary = getStageSummaryLabel(stage, msg);
        if (
          stage &&
          stage !== lastStageLogged &&
          stageSummary &&
          event.data.current === undefined &&
          status === "running"
        ) {
          lastStageLogged = stage;
          consoleLog(body, `🔄 ${stageSummary}`, "info");
        }

        // Log page transitions (when page number is present)
        if (
          event.data.current !== undefined &&
          event.data.total !== undefined
        ) {
          lastStageLogged = "translating";
          const elapsed =
            session.translationStartTime > 0
              ? (Date.now() - session.translationStartTime) / 1000
              : 0;
          consoleLog(
            body,
            `📊 ${i18n.trLogPageProgress(
              event.data.current,
              event.data.total,
              pct,
              formatDuration(elapsed),
            )}`,
            "info",
          );
        }

        // Show engine output detail (raw line from pdf2zh_next stdout)
        if (detail && detail !== msg && shouldLogEngineDetail(detail)) {
          // Detect log level from engine output (e.g. "ERROR:pdf2zh_next...")
          const detailLevel: "info" | "error" = /\bERROR\b/i.test(detail)
            ? "error"
            : "info";
          const detailIcon = detailLevel === "error" ? "❌" : "🔧";
          consoleLog(body, `${detailIcon} ${detail}`, detailLevel);
        } else if (
          msg &&
          event.data.current === undefined &&
          stageSummary !== msg
        ) {
          // Non-page messages from bridge (init, detecting refs, etc.)
          consoleLog(body, `🔄 ${msg}`, "info");
        }

        // Log output files on completion
        if (status === "done" && event.data.outputFiles?.length) {
          for (const f of event.data.outputFiles) {
            consoleLog(body, `   📄 ${i18n.trLogOutputFile(f)}`, "success");
          }
        }
        if (status === "done") {
          const translationSummary = buildTranslationSummaryLine(
            event.data.translationStats,
          );
          if (translationSummary) {
            consoleLog(body, `📈 ${translationSummary}`, "info");
          }
          const warningSummary = buildWarningSummaryLine(
            event.data.warningStats,
            event.data.warningCount,
          );
          if (warningSummary) {
            consoleLog(body, `⚠ ${warningSummary}`, "info");
          }
        }
        // Warn if translation completed but engine logged errors
        if (status === "done" && event.data.hasErrors) {
          const errCount = event.data.errorCount || 0;
          const errLines: string[] = event.data.errorLines || [];
          consoleLog(
            body,
            `⚠️ ${i18n.trLogCompletedWithErrors(errCount)}`,
            "error",
          );
          for (const errLine of errLines.slice(0, 10)) {
            consoleLog(body, `   ${errLine}`, "error");
          }
          if (event.data.logFile) {
            consoleLog(
              body,
              `   📝 ${i18n.trLogFullLog(event.data.logFile)}`,
              "info",
            );
          }
        }

        // Log errors with full detail
        if (status === "error") {
          const errMsg =
            event.data.message || event.data.error || i18n.trLogUnknownError;
          consoleLog(body, `❌ ${i18n.trLogBridgeError(errMsg)}`, "error");
          if (event.data.errorDetail) {
            const lines = event.data.errorDetail.split("\n").slice(-10);
            for (const line of lines) {
              if (line.trim()) consoleLog(body, `   ${line.trim()}`, "error");
            }
          }
          if (event.data.logFile) {
            consoleLog(
              body,
              `   📝 ${i18n.trLogFullLog(event.data.logFile)}`,
              "info",
            );
          }
        }
        break;
      }
      case "state":
        if (event.state === "done") {
          const totalElapsed =
            session.translationStartTime > 0
              ? (Date.now() - session.translationStartTime) / 1000
              : 0;
          updateProgress(session, body, 100, "", { force: true });
          consoleLog(
            body,
            `✅ ${i18n.trDone}! ${i18n.trLogTotalTime(formatDuration(totalElapsed))}`,
            "success",
          );
          consoleLog(body, `─── ${i18n.trLogJobFinished} ───`, "success");
          session.translationStartTime = 0;
          session.activeController = null;
          session.isPaused = false;
          _stopProgressTimer(session);
          restoreTranslationControls(body);
        } else if (event.state === "error") {
          consoleLog(
            body,
            `❌ ${i18n.trError} - ${i18n.trLogSeeDetailsAbove}`,
            "error",
          );
          session.translationStartTime = 0;
          session.activeController = null;
          session.isPaused = false;
          _stopProgressTimer(session);
          restoreTranslationControls(body);
        } else if (event.state === "running") {
          lastStageLogged = "";
          consoleLog(body, `⏳ ${i18n.trLogEngineStarted}`, "info");
        } else if (event.state === "paused") {
          consoleLog(body, `⏸ ${i18n.trLogPausedCached}`, "info");
        } else if (event.state === "idle") {
          resetTranslationSessionUi(session, body);
        }
        break;
      case "error":
        consoleLog(body, `❌ ${i18n.trLogError(event.message)}`, "error");
        break;
      case "env_progress":
        consoleLog(body, `🔧 ${event.detail}`, "info");
        break;
    }
  });
  session.activeController = controller;

  consoleLog(body, `⏳ ${i18n.trLogLaunchingEngine}`, "info");

  try {
    await controller.start(
      {
        pdfPath: session.selectedPdfPath,
        outputDir,
        sourceLang: srcLang,
        targetLang: tgtLang,
        modelId: creds.modelId,
        generateMono: monoChecked,
        generateDual: dualChecked,
        qps,
        poolMaxWorker,
        disableRichTextTranslate,
        enhanceCompatibility,
        translateTableText,
        fontFamily,
        ocr,
        autoOcr,
        saveGlossary,
        disableGlossary,
        noWatermark: true,
        dualMode: "LR",
        transFirst: false, // LR mode: original left, translation right
        skipClean: false,
        skipReferencesAuto,
        keepAppendixTranslated,
        protectAuthorBlock,
      },
      creds,
    );
  } catch (err) {
    if (err instanceof Error && err.stack) {
      consoleLog(body, `${i18n.trLogStackTrace}:\n${err.stack}`, "error");
    }
    consoleLog(body, `❌ ${i18n.trLogError(String(err))}`, "error");
    session.translationStartTime = 0;
    _stopProgressTimer(session);
    restoreTranslationControls(body);
  }
}
