/**
 * DOM builders for the sectioned settings page.
 *
 * `preferenceScript.ts` still owns every preference binding; this file only
 * builds the containers around them — the sticky section navigation, the
 * section shells, the keyboard-shortcut fields and the local-service scanner.
 */

import { HTML_NS } from "../../utils/domHelpers";
import type { DiscoveredLocalService } from "../../utils/localLlmDiscovery";
import { formatServiceMeta, sortDiscoveredServices } from "./localDiscovery";
import { isValidHotkeyString, normalizeHotkeyString } from "./hotkeys";

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElementNS(HTML_NS, tag) as HTMLElementTagNameMap[K];
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ────────────────────────────── Section shell ────────────────────────────── */

export interface SettingsSection {
  /** Scroll target and nav anchor. */
  wrapper: HTMLDivElement;
  /** Collapsible toggle carrying the section name. */
  head: HTMLDivElement;
  /** Holds the section's cards. */
  body: HTMLDivElement;
  setTitle: (title: string) => void;
}

/**
 * A section is a titled group of cards. The head doubles as the collapsible
 * toggle; `preferenceScript` wires it to the shared section-state pref.
 */
export function createSettingsSection(
  doc: Document,
  domId: string,
): SettingsSection {
  const wrapper = el(doc, "div", "llm-set-section");
  wrapper.id = domId;
  const head = el(
    doc,
    "div",
    "llm-set-section-head llm-set-collapsible-toggle",
  );
  const headText = el(doc, "span", "llm-set-section-head-text");
  head.appendChild(headText);
  const body = el(doc, "div", "llm-set-section-body");
  wrapper.append(head, body);
  return {
    wrapper,
    head,
    body,
    setTitle: (title: string) => {
      headText.textContent = title;
      head.title = title;
    },
  };
}

/* ─────────────────────────── Sticky section nav ─────────────────────────── */

export interface SettingsNavEntry {
  id: string;
  section: HTMLElement;
}

export interface SettingsSectionNavOptions {
  doc: Document;
  scrollContainer: HTMLElement;
  entries: SettingsNavEntry[];
  /** Runs before scrolling — used to expand a collapsed section. */
  onNavigate?: (id: string) => void;
}

export interface SettingsSectionNav {
  element: HTMLDivElement;
  setChipLabel: (id: string, label: string) => void;
  setAriaLabel: (label: string) => void;
  syncActive: () => void;
}

export function createSettingsSectionNav(
  options: SettingsSectionNavOptions,
): SettingsSectionNav {
  const { doc, scrollContainer, entries, onNavigate } = options;
  const element = el(doc, "div", "llm-set-nav");
  element.setAttribute("role", "tablist");
  const chips = new Map<string, HTMLButtonElement>();

  const topOf = (node: HTMLElement): number =>
    node.getBoundingClientRect().top -
    scrollContainer.getBoundingClientRect().top +
    scrollContainer.scrollTop;

  const scrollToSection = (entry: SettingsNavEntry) => {
    onNavigate?.(entry.id);
    const navHeight = element.getBoundingClientRect().height || 0;
    const target = Math.max(
      0,
      Math.floor(topOf(entry.section) - navHeight - 8),
    );
    try {
      scrollContainer.scrollTo({ top: target, behavior: "smooth" });
    } catch {
      scrollContainer.scrollTop = target;
    }
  };

  for (const entry of entries) {
    const chip = el(doc, "button", "llm-set-nav-chip") as HTMLButtonElement;
    chip.type = "button";
    chip.setAttribute("role", "tab");
    chip.dataset.sectionId = entry.id;
    chip.addEventListener("click", () => scrollToSection(entry));
    chips.set(entry.id, chip);
    element.appendChild(chip);
  }

  const setActive = (id: string) => {
    chips.forEach((chip, chipId) => {
      const active = chipId === id;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-selected", active ? "true" : "false");
    });
  };

  const syncActive = () => {
    if (!entries.length) return;
    const navHeight = element.getBoundingClientRect().height || 0;
    const probe = scrollContainer.scrollTop + navHeight + 16;
    let activeId = entries[0].id;
    for (const entry of entries) {
      if (topOf(entry.section) <= probe) activeId = entry.id;
    }
    // At the very bottom the last section may be too short to ever cross the
    // probe line, so pin it explicitly.
    const atBottom =
      scrollContainer.scrollTop + scrollContainer.clientHeight >=
      scrollContainer.scrollHeight - 4;
    if (atBottom) activeId = entries[entries.length - 1].id;
    setActive(activeId);
  };

  let scheduled = false;
  const win = doc.defaultView;
  scrollContainer.addEventListener("scroll", () => {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      syncActive();
    };
    if (win?.requestAnimationFrame) win.requestAnimationFrame(run);
    else run();
  });

  return {
    element,
    setChipLabel: (id: string, label: string) => {
      const chip = chips.get(id);
      if (!chip) return;
      chip.textContent = label;
      chip.title = label;
    },
    setAriaLabel: (label: string) => element.setAttribute("aria-label", label),
    syncActive,
  };
}

/* ───────────────────────── Keyboard shortcut fields ──────────────────────── */

export interface HotkeyFieldSpec {
  /** Suffix for the DOM id, e.g. `focus-composer`. */
  id: string;
  labelKey: string;
  /** Shown as the placeholder, and written back when the field is cleared. */
  defaultValue: string;
  read: () => string;
  write: (value: string) => void;
}

export interface HotkeyCardOptions {
  doc: Document;
  idPrefix: string;
  fields: HotkeyFieldSpec[];
  getText: (key: string) => string;
  /** What `accel` resolves to on this platform ("⌘" or "Ctrl"). */
  accelLabel: string;
}

export interface HotkeyCard {
  element: HTMLDivElement;
  renderStaticText: () => void;
  /** Re-read every field from the prefs (used by "restore defaults"). */
  refreshValues: () => void;
}

export function createHotkeyFieldsCard(options: HotkeyCardOptions): HotkeyCard {
  const { doc, idPrefix, fields, getText, accelLabel } = options;
  const element = el(doc, "div", "llm-set-card llm-set-hotkeys-card");
  const rows: Array<{
    spec: HotkeyFieldSpec;
    label: HTMLLabelElement;
    input: HTMLInputElement;
    error: HTMLSpanElement;
  }> = [];

  for (const spec of fields) {
    const field = el(doc, "div", "llm-set-field llm-set-hotkey-field");
    const label = el(doc, "label", "llm-set-label");
    label.setAttribute("for", `${idPrefix}-${spec.id}`);
    const input = el(doc, "input", "llm-set-input") as HTMLInputElement;
    input.id = `${idPrefix}-${spec.id}`;
    input.type = "text";
    input.spellcheck = false;
    input.setAttribute("autocomplete", "off");
    input.placeholder = spec.defaultValue;
    input.value = spec.read();
    const error = el(doc, "span", "llm-set-hint llm-set-hint--error");
    error.hidden = true;

    const commit = () => {
      const raw = input.value.trim();
      input.value = raw;
      if (!raw) {
        // Clearing the field is how you get the default back, so the pref
        // always holds a usable accelerator.
        error.hidden = true;
        input.classList.remove("llm-set-input--error");
        input.value = spec.defaultValue;
        spec.write(spec.defaultValue);
        return;
      }
      if (!isValidHotkeyString(raw)) {
        error.textContent = getText("hotkeysInvalid");
        error.hidden = false;
        input.classList.add("llm-set-input--error");
        return;
      }
      const normalized = normalizeHotkeyString(raw);
      input.value = normalized;
      error.hidden = true;
      input.classList.remove("llm-set-input--error");
      spec.write(normalized);
    };

    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    field.append(label, input, error);
    element.appendChild(field);
    rows.push({ spec, label, input, error });
  }

  const hint = el(doc, "span", "llm-set-hint");
  const escHint = el(doc, "span", "llm-set-hint");
  const accelLine = el(doc, "div", "llm-set-status llm-set-hotkey-accel");
  element.append(hint, escHint, accelLine);

  const renderStaticText = () => {
    for (const row of rows) {
      row.label.textContent = getText(row.spec.labelKey);
      if (!row.error.hidden) row.error.textContent = getText("hotkeysInvalid");
    }
    hint.textContent = getText("hotkeysHint");
    escHint.textContent = getText("hotkeysEscHint");
    accelLine.textContent = getText("hotkeysAccelLine").replace(
      "{label}",
      accelLabel,
    );
  };
  renderStaticText();

  const refreshValues = () => {
    for (const row of rows) {
      row.input.value = row.spec.read();
      row.input.classList.remove("llm-set-input--error");
      row.error.hidden = true;
    }
  };

  return { element, renderStaticText, refreshValues };
}

/* ────────────────────────── Local service scanner ───────────────────────── */

export interface LocalDiscoveryCardOptions {
  doc: Document;
  idPrefix: string;
  getText: (key: string) => string;
  /** Ports listed in the "nothing found" message. */
  scannedPorts: string;
  scan: () => Promise<DiscoveredLocalService[]>;
  onSelect: (service: DiscoveredLocalService) => void | Promise<void>;
}

export interface LocalDiscoveryCard {
  element: HTMLDivElement;
  renderStaticText: () => void;
}

export function createLocalDiscoveryCard(
  options: LocalDiscoveryCardOptions,
): LocalDiscoveryCard {
  const { doc, idPrefix, getText, scannedPorts, scan, onSelect } = options;

  const element = el(doc, "div", "llm-set-field llm-set-local-scan");
  const titleRow = el(doc, "div", "llm-set-row llm-set-gap-sm");
  const title = el(doc, "label", "llm-set-label");
  const button = el(
    doc,
    "button",
    "llm-set-btn llm-set-btn--pill llm-set-btn--secondary",
  ) as HTMLButtonElement;
  button.type = "button";
  button.id = `${idPrefix}-local-scan-button`;
  titleRow.append(title, button);
  const hint = el(doc, "span", "llm-set-hint");
  const status = el(doc, "div", "llm-set-status");
  const list = el(doc, "div", "llm-set-local-scan-list");
  element.append(titleRow, hint, status, list);

  let results: DiscoveredLocalService[] = [];
  let busy = false;

  const renderResults = () => {
    list.textContent = "";
    for (const service of results) {
      const row = el(
        doc,
        "button",
        "llm-set-local-scan-row",
      ) as HTMLButtonElement;
      row.type = "button";
      const main = el(doc, "span", "llm-set-local-scan-main");
      const badge = el(
        doc,
        "span",
        "llm-set-local-scan-badge",
        service.serviceType,
      );
      const url = el(doc, "span", "llm-set-local-scan-url", service.apiBase);
      main.append(badge, url);
      const meta = el(
        doc,
        "span",
        "llm-set-local-scan-meta",
        formatServiceMeta(service, getText("localScanModelCount")),
      );
      row.append(main, meta);
      row.addEventListener("click", () => {
        status.textContent = getText("localScanApplied").replace(
          "{url}",
          service.apiBase,
        );
        status.classList.remove("is-error");
        void Promise.resolve(onSelect(service)).catch(() => {
          /* the caller reports its own failures inline */
        });
      });
      list.appendChild(row);
    }
  };

  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    results = [];
    list.textContent = "";
    status.classList.remove("is-error");
    status.textContent = getText("localScanRunning");
    try {
      results = sortDiscoveredServices(await scan());
      if (results.length) {
        status.textContent = getText("localScanFound").replace(
          "{n}",
          String(results.length),
        );
        renderResults();
      } else {
        status.textContent = getText("localScanEmpty").replace(
          "{ports}",
          scannedPorts,
        );
      }
    } catch {
      // Probing localhost must never surface as an exception in the UI.
      results = [];
      status.textContent = getText("localScanFailed");
      status.classList.add("is-error");
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = getText("localScanButton");
    }
  });

  const renderStaticText = () => {
    title.textContent = getText("localScanTitle");
    if (!busy) button.textContent = getText("localScanButton");
    hint.textContent = getText("localScanHint");
    renderResults();
  };
  renderStaticText();

  return { element, renderStaticText };
}
