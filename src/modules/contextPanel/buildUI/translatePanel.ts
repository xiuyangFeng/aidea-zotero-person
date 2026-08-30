import { createElement } from "../../../utils/domHelpers";
import type { getPanelI18n } from "../i18n";
import { TRANSLATION_LANGUAGE_OPTIONS } from "../languages";

type PanelI18n = ReturnType<typeof getPanelI18n>;

/**
 * Build the "Translate" tab: the full-document translation form, its
 * collapsible option sections, progress area, and console.
 *
 * Self-contained — it only needs the document, the localized strings, and
 * which tab starts visible.
 */
export function buildTranslatePanel(
  doc: Document,
  i18n: PanelI18n,
  initialActiveTab: string,
): HTMLDivElement {
  const translatePanel = createElement(
    doc,
    "div",
    `llm-tab-panel${initialActiveTab === "translate" ? " visible" : ""}`,
    {
      id: "llm-tab-panel-translate",
    },
  );
  translatePanel.dataset.tab = "translate";

  const translateScroll = createElement(doc, "div", "llm-translate-scroll", {
    id: "llm-translate-scroll",
  });

  // Root container
  const trRoot = createElement(doc, "div", "llm-tr-root");

  // ── Helper: create a collapsible section (title + body) ──
  const buildSection = (id: string, label: string, defaultOpen: boolean) => {
    const title = createElement(
      doc,
      "div",
      "llm-tr-title llm-tr-collapsible-toggle",
      { id: `${id}-toggle` },
    );
    title.textContent = label;
    title.dataset.collapsed = defaultOpen ? "false" : "true";
    const body = createElement(doc, "div", "llm-tr-section-body", {
      id: `${id}-body`,
    });
    if (!defaultOpen) body.style.display = "none";
    title.addEventListener("click", () => {
      const isOpen = title.dataset.collapsed === "false";
      title.dataset.collapsed = isOpen ? "true" : "false";
      body.style.display = isOpen ? "none" : "";
    });
    return { title, body };
  };

  // ═══════════════════════════════════════════════════════════
  // Section 1: 基础配置 (Basic Config) — default open
  // ═══════════════════════════════════════════════════════════
  const sec1 = buildSection("llm-tr-sec-basic", i18n.trSectionBasic, true);

  // Input path row: [label] [input] [select file btn] + drop hint
  const trInputPathSection = createElement(doc, "div", "llm-tr-path-block", {
    id: "llm-tr-input-path-block",
  });
  const trInputPathLabel = createElement(doc, "div", "llm-tr-field-label", {
    id: "llm-tr-input-path-label",
    textContent: i18n.trInputPath,
  });
  const trInputPathRow = createElement(doc, "div", "llm-tr-row");
  const trPdfNameWrap = createElement(doc, "div", "llm-tr-pdf-name", {
    id: "llm-tr-pdf-name-wrap",
  });
  trPdfNameWrap.setAttribute("data-empty", "true");
  // Editable so the user can paste / type a path, or drop a file on it
  // (Gecko fills text inputs with the dropped file's path natively)
  const trPdfName = createElement(doc, "input", "llm-tr-pdf-input", {
    id: "llm-tr-pdf-name",
    type: "text",
    spellcheck: false,
    placeholder: i18n.trNoPdfFound,
  }) as HTMLInputElement;
  trPdfName.title = i18n.trPdfDropHint;
  trPdfNameWrap.append(trPdfName);
  const trPickFileBtn = createElement(
    doc,
    "button",
    "llm-tr-btn llm-tr-btn-primary llm-tr-btn-small",
    {
      id: "llm-tr-pick-file",
      type: "button",
      textContent: i18n.trSelectLocalPdf,
    },
  );
  const trDropHint = createElement(doc, "div", "llm-tr-drop-hint", {
    id: "llm-tr-drop-hint",
    textContent: i18n.trPdfDropHint,
  });
  trInputPathRow.append(trPdfName, trPickFileBtn);
  trInputPathSection.append(trInputPathLabel, trInputPathRow, trDropHint);

  // Save path row: [label] [input] [browse btn] — aligned with input path
  const trSavePathSection = createElement(doc, "div", "llm-tr-path-block");
  const trSavePathLabel = createElement(doc, "div", "llm-tr-field-label", {
    id: "llm-tr-save-path-label",
    textContent: i18n.trSavePath,
  });
  const trSavePathRow = createElement(doc, "div", "llm-tr-row");
  const trPathInput = createElement(doc, "input", "llm-tr-input", {
    id: "llm-tr-output-dir",
    type: "text",
    placeholder: i18n.requiredOutputFolder,
  }) as HTMLInputElement;
  const trPathBrowseBtn = createElement(
    doc,
    "button",
    "llm-tr-btn llm-tr-btn-primary llm-tr-btn-small",
    {
      id: "llm-tr-browse-dir",
      type: "button",
      textContent: i18n.trBrowsePath,
    },
  );
  trSavePathRow.append(trPathInput, trPathBrowseBtn);
  trSavePathSection.append(trSavePathLabel, trSavePathRow);

  // Model selector row — custom dropdown to avoid native select styling issues
  const trModelRow = createElement(doc, "div", "llm-tr-path-block");
  const trModelLabel = createElement(doc, "div", "llm-tr-field-label", {
    id: "llm-tr-model-label",
    textContent: i18n.modelSelectHint,
  });
  // Custom dropdown wrapper
  const trModelDropdown = createElement(doc, "div", "llm-tr-dropdown", {
    id: "llm-tr-model",
  }) as HTMLDivElement;
  const trModelTrigger = createElement(
    doc,
    "div",
    "llm-tr-dropdown-trigger",
  ) as HTMLDivElement;
  trModelTrigger.textContent = "—";
  const trModelArrow = createElement(
    doc,
    "span",
    "llm-tr-dropdown-arrow",
  ) as HTMLSpanElement;
  trModelArrow.textContent = "▾";
  trModelTrigger.appendChild(trModelArrow);
  const trModelMenu = createElement(
    doc,
    "div",
    "llm-tr-dropdown-menu",
  ) as HTMLDivElement;
  trModelMenu.style.display = "none";
  trModelDropdown.append(trModelTrigger, trModelMenu);
  // Toggle menu on trigger click
  trModelTrigger.addEventListener("click", () => {
    const open = trModelMenu.style.display !== "none";
    trModelMenu.style.display = open ? "none" : "block";
    trModelDropdown.classList.toggle("open", !open);
  });
  // Close on outside click
  doc.addEventListener("click", (e: Event) => {
    if (!trModelDropdown.contains(e.target as Node)) {
      trModelMenu.style.display = "none";
      trModelDropdown.classList.remove("open");
    }
  });
  trModelRow.append(trModelLabel, trModelDropdown);

  // ── Reusable custom dropdown builder ──
  const buildDropdown = (
    id: string,
    options: { value: string; label: string }[],
    defaultValue: string,
  ) => {
    const dd = createElement(doc, "div", "llm-tr-dropdown", {
      id,
    }) as HTMLDivElement;
    const trigger = createElement(
      doc,
      "div",
      "llm-tr-dropdown-trigger",
    ) as HTMLDivElement;
    const arrow = createElement(
      doc,
      "span",
      "llm-tr-dropdown-arrow",
    ) as HTMLSpanElement;
    arrow.textContent = "▾";
    trigger.textContent = "—";
    trigger.appendChild(arrow);
    const menu = createElement(
      doc,
      "div",
      "llm-tr-dropdown-menu",
    ) as HTMLDivElement;
    menu.style.display = "none";
    dd.append(trigger, menu);

    const selectItem = (value: string, label: string) => {
      dd.dataset.value = value;
      const arrowEl = trigger.querySelector(".llm-tr-dropdown-arrow");
      trigger.textContent = label;
      if (arrowEl) trigger.appendChild(arrowEl);
      menu.querySelectorAll(".llm-tr-dropdown-item").forEach((el: Element) => {
        (el as HTMLElement).classList.toggle(
          "selected",
          (el as HTMLElement).dataset.value === value,
        );
      });
      menu.style.display = "none";
      dd.classList.remove("open");
    };

    for (const opt of options) {
      const item = createElement(
        doc,
        "div",
        "llm-tr-dropdown-item",
      ) as HTMLDivElement;
      item.dataset.value = opt.value;
      item.textContent = opt.label;
      item.addEventListener("click", () => selectItem(opt.value, opt.label));
      menu.appendChild(item);
    }

    // Set default
    const defaultOpt =
      options.find((o) => o.value === defaultValue) || options[0];
    if (defaultOpt) selectItem(defaultOpt.value, defaultOpt.label);

    trigger.addEventListener("click", () => {
      const open = menu.style.display !== "none";
      menu.style.display = open ? "none" : "block";
      dd.classList.toggle("open", !open);
    });
    doc.addEventListener("click", (e: Event) => {
      if (!dd.contains(e.target as Node)) {
        menu.style.display = "none";
        dd.classList.remove("open");
      }
    });

    return dd;
  };

  // Language selectors with swap button
  const trLangRow = createElement(doc, "div", "llm-tr-lang-row");
  const trSrcLangSection = createElement(doc, "div", "llm-tr-lang-half");
  const trSrcLangLabel = createElement(doc, "div", "llm-tr-field-label", {
    id: "llm-tr-src-lang-label",
    textContent: i18n.trSourceLang,
  });

  const trTgtLangSection = createElement(doc, "div", "llm-tr-lang-half");
  const trTgtLangLabel = createElement(doc, "div", "llm-tr-field-label", {
    id: "llm-tr-tgt-lang-label",
    textContent: i18n.trTargetLang,
  });

  const trLangSwapBtn = createElement(doc, "button", "llm-tr-lang-swap", {
    id: "llm-tr-lang-swap",
    type: "button",
    textContent: "⇄",
    title: i18n.swapLanguages,
  });

  const langDropdownOpts = TRANSLATION_LANGUAGE_OPTIONS.map((language) => ({
    value: language.code,
    label: language.label,
  }));

  const trSrcLangSelect = buildDropdown(
    "llm-tr-source-lang",
    langDropdownOpts,
    "en",
  );
  const trTgtLangSelect = buildDropdown(
    "llm-tr-target-lang",
    langDropdownOpts,
    "zh-CN",
  );

  trSrcLangSection.append(trSrcLangLabel, trSrcLangSelect);
  trTgtLangSection.append(trTgtLangLabel, trTgtLangSelect);
  trLangRow.append(trSrcLangSection, trLangSwapBtn, trTgtLangSection);

  // Assemble section 1
  sec1.body.append(
    trInputPathSection,
    trSavePathSection,
    trModelRow,
    trLangRow,
  );

  // ═══════════════════════════════════════════════════════════
  // Section 2: 翻译引擎 (Translation Engine) — default open
  // ═══════════════════════════════════════════════════════════
  const sec2 = buildSection("llm-tr-sec-engine", i18n.trSectionEngine, true);

  // Output format checkboxes
  const trOptionsTitle = createElement(doc, "div", "llm-tr-subtitle", {
    id: "llm-tr-output-title",
    textContent: i18n.trOutputFormat,
  });
  const trFormatRow = createElement(doc, "div", "llm-tr-row llm-tr-format-row");
  const trMonoLabel = createElement(doc, "label", "llm-tr-checkbox-label", {
    id: "llm-tr-mono-label",
  });
  const trMonoInput = createElement(doc, "input", "", {
    id: "llm-tr-mono",
    type: "checkbox",
  }) as HTMLInputElement;
  trMonoInput.checked = true;
  const trMonoText = doc.createTextNode(` ${i18n.trOutputMono}`);
  trMonoLabel.append(trMonoInput, trMonoText);

  const trDualLabel = createElement(doc, "label", "llm-tr-checkbox-label", {
    id: "llm-tr-dual-label",
  });
  const trDualInput = createElement(doc, "input", "", {
    id: "llm-tr-dual",
    type: "checkbox",
  }) as HTMLInputElement;
  trDualInput.checked = true;
  const trDualText = doc.createTextNode(` ${i18n.trOutputDual}`);
  trDualLabel.append(trDualInput, trDualText);

  const trSkipRefsLabel = createElement(doc, "label", "llm-tr-checkbox-label");
  const trSkipRefsInput = createElement(doc, "input", "", {
    id: "llm-tr-skip-refs-auto",
    type: "checkbox",
  }) as HTMLInputElement;
  trSkipRefsInput.checked = true;
  trSkipRefsLabel.title = i18n.trHintSkipReferences;
  trSkipRefsLabel.append(
    trSkipRefsInput,
    doc.createTextNode(` ${i18n.trSkipReferencesAuto}`),
  );

  trFormatRow.append(trMonoLabel, trDualLabel, trSkipRefsLabel);

  // Helper: build a numeric stepper (label + ‹ [input] ›)
  const buildStepper = (
    id: string,
    label: string,
    defaultVal: number,
    min: number,
    max: number,
    step: number,
  ) => {
    const wrapper = createElement(doc, "div", "llm-tr-stepper");
    const lbl = createElement(doc, "span", "llm-tr-stepper-label", {
      textContent: label,
    });
    const group = createElement(doc, "div", "llm-tr-stepper-group");

    // Arrow style helper
    const makeArrow = (text: string) => {
      const arrow = createElement(doc, "span", "") as HTMLSpanElement;
      arrow.textContent = text;
      Object.assign(arrow.style, {
        color: "#888",
        fontSize: "14px",
        fontWeight: "700",
        cursor: "pointer",
        userSelect: "none",
        padding: "0 3px",
        lineHeight: "20px",
        transition: "color 0.15s ease",
      });
      arrow.addEventListener("mouseenter", () => {
        arrow.style.color = "#ccc";
      });
      arrow.addEventListener("mouseleave", () => {
        arrow.style.color = "#888";
      });
      return arrow;
    };

    const btnDec = makeArrow("‹");
    const btnInc = makeArrow("›");

    // Editable value
    const valInput = createElement(doc, "div", "llm-tr-stepper-value", {
      id,
    }) as HTMLDivElement;
    valInput.setAttribute("contenteditable", "true");
    valInput.textContent = String(defaultVal);
    Object.assign(valInput.style, {
      width: "40px",
      height: "20px",
      lineHeight: "20px",
      padding: "0 4px",
      margin: "0",
      border: "1px solid rgba(128,128,128,0.25)",
      borderRadius: "4px",
      color: "inherit",
      fontSize: "10px",
      fontFamily: "inherit",
      textAlign: "center",
      boxSizing: "border-box",
      cursor: "text",
      overflow: "hidden",
      whiteSpace: "nowrap",
    });
    valInput.style.setProperty(
      "background",
      "color-mix(in srgb, var(--material-sidepane, #2b2b2b) 92%, var(--fill-primary, #fff) 8%)",
    );

    const clamp = () => {
      let v = parseInt(valInput.textContent || String(defaultVal), 10);
      if (isNaN(v)) v = defaultVal;
      valInput.textContent = String(Math.max(min, Math.min(max, v)));
    };

    btnDec.addEventListener("click", () => {
      clamp();
      const v = parseInt(valInput.textContent || String(defaultVal), 10);
      valInput.textContent = String(Math.max(min, v - step));
    });
    btnInc.addEventListener("click", () => {
      clamp();
      const v = parseInt(valInput.textContent || String(defaultVal), 10);
      valInput.textContent = String(Math.min(max, v + step));
    });
    valInput.addEventListener("keydown", (e: Event) => {
      if ((e as KeyboardEvent).key === "Enter") {
        e.preventDefault();
        clamp();
        (valInput as HTMLElement).blur();
      }
    });
    valInput.addEventListener("blur", clamp);

    group.append(btnDec, valInput, btnInc);
    wrapper.append(lbl, group);
    return wrapper;
  };

  // Collapsible Advanced sub-section (collapsed by default)
  const trAdvTitle = createElement(
    doc,
    "div",
    "llm-tr-subtitle llm-tr-collapsible-toggle",
    {
      id: "llm-tr-advanced-toggle",
    },
  );
  trAdvTitle.textContent = i18n.trAdvanced;
  trAdvTitle.dataset.collapsed = "true";

  const trAdvBody = createElement(doc, "div", "llm-tr-advanced-body", {
    id: "llm-tr-advanced-body",
  });
  trAdvBody.style.display = "none";

  trAdvTitle.addEventListener("click", () => {
    const isOpen = trAdvTitle.dataset.collapsed === "false";
    trAdvTitle.dataset.collapsed = isOpen ? "true" : "false";
    trAdvBody.style.display = isOpen ? "none" : "";
  });

  // Helper to create advanced checkbox with tooltip
  const advCheck = (
    id: string,
    label: string,
    checked: boolean,
    tooltip?: string,
  ) => {
    const row = createElement(
      doc,
      "label",
      "llm-tr-checkbox-label llm-tr-adv-label",
    );
    if (tooltip) row.title = tooltip;
    const inp = createElement(doc, "input", "", {
      id,
      type: "checkbox",
    }) as HTMLInputElement;
    inp.checked = checked;
    row.append(inp, doc.createTextNode(` ${label}`));
    return row;
  };

  // Pool stepper & QPS stepper
  const trPoolStepper = buildStepper(
    "llm-tr-pool-max-worker",
    i18n.trPoolMaxWorker,
    1,
    1,
    32,
    1,
  );
  trPoolStepper.title = i18n.trHintPoolMaxWorker;
  const advQpsStepper = buildStepper("llm-tr-qps", i18n.trQps, 10, 1, 100, 1);
  advQpsStepper.title = i18n.trHintQps;

  // Advanced checkboxes
  const advKeepAppendix = advCheck(
    "llm-tr-keep-appendix",
    i18n.trKeepAppendixTranslated,
    true,
    i18n.trHintKeepAppendix,
  );
  const advProtectAuthor = advCheck(
    "llm-tr-protect-author",
    i18n.trProtectAuthorBlock,
    true,
    i18n.trHintProtectAuthor,
  );
  const advDisableRichText = advCheck(
    "llm-tr-disable-rich-text",
    i18n.trDisableRichTextTranslate,
    false,
    i18n.trHintDisableRichText,
  );
  const advEnhanceCompat = advCheck(
    "llm-tr-enhance-compat",
    i18n.trEnhanceCompatibility,
    false,
    i18n.trHintEnhanceCompat,
  );
  const advTranslateTable = advCheck(
    "llm-tr-translate-table",
    i18n.trTranslateTableText,
    false,
    i18n.trHintTranslateTable,
  );
  const advOcr = advCheck("llm-tr-ocr", i18n.trOCR, false, i18n.trHintOcr);
  const advAutoOcr = advCheck(
    "llm-tr-auto-ocr",
    i18n.trAutoOCR,
    true,
    i18n.trHintAutoOcr,
  );
  const advSaveGlossary = advCheck(
    "llm-tr-save-glossary",
    i18n.trSaveGlossary,
    true,
    i18n.trHintSaveGlossary,
  );
  const advDisableGlossary = advCheck(
    "llm-tr-disable-glossary",
    i18n.trDisableGlossary,
    false,
    i18n.trHintDisableGlossary,
  );

  // Font family drop-down (custom dropdown)
  const advFontRow = createElement(
    doc,
    "div",
    "llm-tr-row llm-tr-adv-font-row",
  );
  advFontRow.title = i18n.trHintFontFamily;
  const advFontLabel = createElement(doc, "span", "llm-tr-adv-font-label", {
    id: "llm-tr-font-label",
    textContent: i18n.trFontFamily,
  });
  const advFontSelect = buildDropdown(
    "llm-tr-font-family",
    [
      { value: "auto", label: i18n.trFontFamilyAuto },
      { value: "serif", label: i18n.trFontFamilySerif },
      { value: "sans-serif", label: i18n.trFontFamilySansSerif },
      { value: "script", label: i18n.trFontFamilyScript },
    ],
    "auto",
  );
  advFontRow.append(advFontLabel, advFontSelect);

  trAdvBody.append(
    trPoolStepper,
    advQpsStepper,
    advKeepAppendix,
    advProtectAuthor,
    advDisableRichText,
    advEnhanceCompat,
    advTranslateTable,
    advOcr,
    advAutoOcr,
    advSaveGlossary,
    advDisableGlossary,
    advFontRow,
  );

  // Assemble section 2
  sec2.body.append(trOptionsTitle, trFormatRow, trAdvTitle, trAdvBody);

  // ═══════════════════════════════════════════════════════════
  // Section 3: 执行 (Execute) — default open
  // ═══════════════════════════════════════════════════════════
  const sec3 = buildSection("llm-tr-sec-exec", i18n.trSectionExecute, true);

  // Progress bar
  const trProgressSection = createElement(
    doc,
    "div",
    "llm-tr-progress-section",
    {
      id: "llm-tr-progress-section",
    },
  );
  const trProgressBarOuter = createElement(doc, "div", "llm-tr-progress-bar");
  const trProgressBarInner = createElement(doc, "div", "llm-tr-progress-fill", {
    id: "llm-tr-progress-fill",
  });
  trProgressBarOuter.appendChild(trProgressBarInner);
  trProgressSection.appendChild(trProgressBarOuter);

  // Console (collapsible, default EXPANDED)
  const SVG_NS = "http://www.w3.org/2000/svg";
  const trConsoleTitle = createElement(
    doc,
    "div",
    "llm-tr-subtitle llm-tr-collapsible-toggle",
    {
      id: "llm-tr-console-toggle",
    },
  );
  trConsoleTitle.textContent = i18n.console;
  trConsoleTitle.dataset.collapsed = "false";

  const trConsole = createElement(doc, "div", "llm-tr-console", {
    id: "llm-tr-console",
  });
  // default expanded — no display:none

  trConsoleTitle.addEventListener("click", () => {
    const isOpen = trConsoleTitle.dataset.collapsed === "false";
    trConsoleTitle.dataset.collapsed = isOpen ? "true" : "false";
    trConsole.style.display = isOpen ? "none" : "";
  });

  const trConsoleHeader = createElement(doc, "div", "llm-tr-console-header");
  const trConsoleActions = createElement(doc, "div", "llm-tr-console-actions");

  // Copy button with SVG icon
  const trConsoleCopyBtn = createElement(
    doc,
    "button",
    "llm-tr-console-icon-btn",
    {
      id: "llm-tr-console-copy",
      type: "button",
      title: i18n.copyAll,
    },
  );
  const copySvg = doc.createElementNS(SVG_NS, "svg");
  copySvg.setAttribute("viewBox", "0 0 16 16");
  for (const d of [
    "M4 4V2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2",
    "M2 6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6z",
  ]) {
    const p = doc.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    copySvg.appendChild(p);
  }
  trConsoleCopyBtn.appendChild(copySvg);

  // Clear button with SVG icon
  const trConsoleClearBtn = createElement(
    doc,
    "button",
    "llm-tr-console-icon-btn",
    {
      id: "llm-tr-console-clear",
      type: "button",
      title: i18n.clear,
    },
  );
  const trashSvg = doc.createElementNS(SVG_NS, "svg");
  trashSvg.setAttribute("viewBox", "0 0 16 16");
  for (const d of [
    "M2 4h12",
    "M5.333 4V2.667a1.333 1.333 0 0 1 1.334-1.334h2.666a1.333 1.333 0 0 1 1.334 1.334V4",
    "M3.333 4v9.333a1.333 1.333 0 0 0 1.334 1.334h6.666a1.333 1.333 0 0 0 1.334-1.334V4",
    "M6.667 7.333v4",
    "M9.333 7.333v4",
  ]) {
    const p = doc.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    trashSvg.appendChild(p);
  }
  trConsoleClearBtn.appendChild(trashSvg);

  trConsoleActions.append(trConsoleCopyBtn, trConsoleClearBtn);
  trConsoleHeader.appendChild(trConsoleActions);
  const trConsoleBody = createElement(doc, "div", "llm-tr-console-body", {
    id: "llm-tr-console-body",
  });
  trConsole.append(trConsoleHeader, trConsoleBody);

  // Action buttons: [Install] ... spacer ... [Start / Pause] [Clear]
  const trInstallBtn = createElement(
    doc,
    "button",
    "llm-tr-btn llm-tr-btn-pink llm-tr-btn-action",
    {
      id: "llm-tr-install-env",
      type: "button",
      textContent: `⚙ ${i18n.trInstallEnv}`,
    },
  );
  const trStartBtn = createElement(
    doc,
    "button",
    "llm-tr-btn llm-tr-btn-primary llm-tr-btn-action",
    {
      id: "llm-tr-start",
      type: "button",
      textContent: `▶ ${i18n.trStartTranslation}`,
    },
  );
  const trPauseBtn = createElement(
    doc,
    "button",
    "llm-tr-btn llm-tr-btn-warning llm-tr-btn-action",
    {
      id: "llm-tr-pause",
      type: "button",
      textContent: `⏸ ${i18n.trPause}`,
    },
  );
  trPauseBtn.style.display = "none";
  const trClearBtn = createElement(
    doc,
    "button",
    "llm-tr-btn llm-tr-btn-danger llm-tr-btn-action",
    {
      id: "llm-tr-clear",
      type: "button",
      textContent: `🗑 ${i18n.trClearCache}`,
    },
  );
  const trActions = createElement(doc, "div", "llm-tr-actions");
  const trActionsSpacer = createElement(doc, "div", "llm-tr-actions-spacer");
  trActions.append(
    trInstallBtn,
    trActionsSpacer,
    trStartBtn,
    trPauseBtn,
    trClearBtn,
  );

  // Assemble section 3
  sec3.body.append(trProgressSection, trConsoleTitle, trConsole, trActions);

  // ═══════════════════════════════════════════════════════════
  // Assemble all sections into root
  // ═══════════════════════════════════════════════════════════
  const trDisclaimer = createElement(doc, "div", "llm-tr-disclaimer", {
    id: "llm-tr-disclaimer",
    textContent: i18n.trFormatDisclaimer,
  });
  trRoot.append(
    trDisclaimer,
    sec1.title,
    sec1.body,
    sec2.title,
    sec2.body,
    sec3.title,
    sec3.body,
  );
  translateScroll.appendChild(trRoot);
  translatePanel.appendChild(translateScroll);

  return translatePanel as HTMLDivElement;
}
