import { config } from "../../../package.json";
import { createElement } from "../../utils/domHelpers";
import {
  UPLOAD_FILE_EXPANDED_LABEL,
  formatFigureCountLabel,
  formatFileCountLabel,
} from "./constants";
import type { ActionDropdownSpec } from "./types";
import { isGlobalPortalItem } from "./portalScope";
import { getPanelI18n, getPanelLang } from "./i18n";
import { getUiLanguageOption, TRANSLATION_LANGUAGE_OPTIONS } from "./languages";
import { pickChatInputPlaceholder } from "./placeholderTips";
import { applyCurrentThemeToRoot } from "./theme";
import { buildDiscussionComposer } from "./buildUI/composer";
import {
  createActionDropdown,
  createChatReadinessPrompt,
} from "./buildUI/primitives";
import { buildTranslatePanel } from "./buildUI/translatePanel";

type PanelTab = "discussion" | "translate" | "setting";

const PANEL_TABS: PanelTab[] = ["discussion", "translate", "setting"];
const TAB_ICON_MAP: Record<PanelTab, string> = {
  discussion: "chrome://aidea/content/icons/logo-talk.png",
  translate: "chrome://aidea/content/icons/logo-translate.png",
  setting: "chrome://aidea/content/icons/logo-setting.png",
};

function isPanelTab(value: unknown): value is PanelTab {
  return typeof value === "string" && PANEL_TABS.includes(value as PanelTab);
}

function getActiveTabPrefKey(body: Element): string {
  const tabType =
    (body as HTMLElement).dataset?.tabType === "reader" ? "reader" : "library";
  return `${config.prefsPrefix}.contextPanel.lastActiveTab.${tabType}`;
}

function getPersistedActiveTab(body: Element): PanelTab {
  try {
    const value = Zotero.Prefs.get(getActiveTabPrefKey(body), true);
    if (isPanelTab(value)) return value;
  } catch {
    /* pref may not be registered during early startup */
  }
  return "discussion";
}

function persistActiveTab(body: Element, tab: PanelTab): void {
  try {
    Zotero.Prefs.set(getActiveTabPrefKey(body), tab, true);
  } catch {
    /* ignore pref write failures */
  }
}

function buildUI(body: Element, item?: Zotero.Item | null) {
  body.textContent = "";
  const doc = body.ownerDocument!;
  const hasItem = Boolean(item);
  const isGlobalMode = Boolean(item && isGlobalPortalItem(item));
  const conversationItemId =
    hasItem && item
      ? item.isAttachment() && item.parentID
        ? item.parentID
        : item.id
      : 0;
  const i18n = getPanelI18n();
  const languageOption = getUiLanguageOption(getPanelLang());
  const initialActiveTab = getPersistedActiveTab(body);

  // Disable CSS scroll anchoring on the Zotero-provided panel body so that
  // Gecko doesn't fight with our programmatic scroll management.
  if (body instanceof (doc.defaultView?.HTMLElement || HTMLElement)) {
    const hostBody = body as HTMLElement;
    hostBody.style.overflowAnchor = "none";
    // Keep panel host width-bound: descendants (e.g., long KaTeX blocks)
    // must never raise the side panel's minimum width.
    hostBody.style.minWidth = "0";
    hostBody.style.width = "100%";
    hostBody.style.maxWidth = "100%";
    hostBody.style.overflowX = "hidden";
    hostBody.style.boxSizing = "border-box";
    hostBody.lang = languageOption.htmlLang;
    hostBody.dir = languageOption.dir;
  }

  // Main container
  const container = createElement(doc, "div", "llm-panel", { id: "llm-main" });
  container.lang = languageOption.htmlLang;
  container.dir = languageOption.dir;
  container.dataset.itemId =
    conversationItemId > 0 ? `${conversationItemId}` : "";
  container.dataset.libraryId = hasItem && item ? `${item.libraryID}` : "";
  container.dataset.activeTab = initialActiveTab;
  applyCurrentThemeToRoot(container);

  // ═══════════════════════════════════════════════════════════
  // Tab Navigation
  // ═══════════════════════════════════════════════════════════
  const tabNav = createElement(doc, "div", "llm-tab-nav", {
    id: "llm-tab-nav",
  });
  // Apply auto-hide if user preference is set
  try {
    const hideNav = Zotero.Prefs.get(`${config.prefsPrefix}.hideTabNav`, true);
    if (hideNav === true || String(hideNav).toLowerCase() === "true") {
      tabNav.classList.add("llm-tab-nav--auto-hide");
    }
  } catch {
    /* pref not yet registered */
  }
  const tabDiscussionBtn = createElement(
    doc,
    "button",
    `llm-tab-btn${initialActiveTab === "discussion" ? " active" : ""}`,
    {
      id: "llm-tab-btn-discussion",
      type: "button",
      textContent: i18n.tabDiscussion,
    },
  );
  tabDiscussionBtn.dataset.tab = "discussion";
  const tabSettingBtn = createElement(
    doc,
    "button",
    `llm-tab-btn${initialActiveTab === "setting" ? " active" : ""}`,
    {
      id: "llm-tab-btn-setting",
      type: "button",
      textContent: i18n.tabSetting,
    },
  );
  tabSettingBtn.dataset.tab = "setting";
  const tabTranslateBtn = createElement(
    doc,
    "button",
    `llm-tab-btn${initialActiveTab === "translate" ? " active" : ""}`,
    {
      id: "llm-tab-btn-translate",
      type: "button",
      textContent: i18n.tabTranslate,
    },
  );
  tabTranslateBtn.dataset.tab = "translate";
  tabNav.append(tabDiscussionBtn, tabTranslateBtn, tabSettingBtn);

  // ═══════════════════════════════════════════════════════════
  // Tab Content Wrapper (upper area — shared, resize: vertical via CSS)
  // ═══════════════════════════════════════════════════════════
  const contentWrapper = createElement(doc, "div", "llm-tab-content-wrapper", {
    id: "llm-tab-content-wrapper",
  });

  // ── Discussion Panel (upper) ──
  const discussionPanel = createElement(
    doc,
    "div",
    `llm-tab-panel${initialActiveTab === "discussion" ? " visible" : ""}`,
    {
      id: "llm-tab-panel-discussion",
    },
  );
  discussionPanel.dataset.tab = "discussion";

  // Header section
  const header = createElement(doc, "div", "llm-header");
  const headerTop = createElement(doc, "div", "llm-header-top");
  const headerInfo = createElement(doc, "div", "llm-header-info");
  const headerIcon = createElement(doc, "img", "llm-header-icon", {
    alt: "AIdea",
    src: TAB_ICON_MAP[initialActiveTab],
  }) as HTMLImageElement;
  headerIcon.style.width = "28px";
  headerIcon.style.height = "28px";
  headerIcon.style.borderRadius = "4px";
  // const title = createElement(doc, "div", "llm-title", {
  //   textContent: "LLM Assistant",
  // });
  const title = createElement(doc, "div", "llm-title", {
    id: "llm-title-static",
    textContent: i18n.title,
  });
  if (hasItem) {
    title.style.display = "none";
  }
  const historyBar = createElement(doc, "div", "llm-history-bar", {
    id: "llm-history-bar",
  });
  historyBar.style.display = hasItem ? "inline-flex" : "none";
  const historyNewBtn = createElement(doc, "button", "llm-history-new", {
    id: "llm-history-new",
    type: "button",
    textContent: "",
    title: i18n.newChat,
  });
  historyNewBtn.setAttribute("aria-label", i18n.newChat);
  const historyToggleBtn = createElement(doc, "button", "llm-history-toggle", {
    id: "llm-history-toggle",
    type: "button",
    textContent: "",
    title: i18n.history,
  });
  historyToggleBtn.setAttribute("aria-haspopup", "menu");
  historyToggleBtn.setAttribute("aria-expanded", "false");
  const historyModeIndicator = createElement(
    doc,
    "span",
    "llm-history-mode-indicator",
    {
      id: "llm-history-mode-indicator",
      textContent: "",
    },
  );
  historyModeIndicator.setAttribute("aria-live", "polite");
  historyBar.append(historyNewBtn, historyToggleBtn, historyModeIndicator);

  const exportBtn = createElement(
    doc,
    "button",
    "llm-btn-icon llm-export-btn llm-discussion-only",
    {
      id: "llm-export",
      type: "button",
      textContent: "",
      title: i18n.export,
      disabled: !hasItem,
    },
  );
  const clearBtn = createElement(
    doc,
    "button",
    "llm-btn-icon llm-clear-btn llm-discussion-only",
    {
      id: "llm-clear",
      type: "button",
      textContent: "",
      title: i18n.clear,
    },
  );

  headerInfo.append(headerIcon, title, exportBtn, clearBtn);
  headerTop.appendChild(headerInfo);

  headerTop.appendChild(tabNav);

  const headerActions = createElement(
    doc,
    "div",
    "llm-header-actions llm-discussion-only",
  );
  headerActions.append(historyBar);
  headerTop.appendChild(headerActions);
  header.appendChild(headerTop);
  const historyMenu = createElement(doc, "div", "llm-history-menu", {
    id: "llm-history-menu",
  });
  historyMenu.style.display = "none";
  header.appendChild(historyMenu);

  const historyUndo = createElement(doc, "div", "llm-history-undo", {
    id: "llm-history-undo",
  });
  historyUndo.style.display = "none";
  const historyUndoText = createElement(doc, "span", "llm-history-undo-text", {
    id: "llm-history-undo-text",
    textContent: "",
  });
  const historyUndoBtn = createElement(doc, "button", "llm-history-undo-btn", {
    id: "llm-history-undo-btn",
    type: "button",
    textContent: i18n.undo,
    title: i18n.undo,
  });
  historyUndo.append(historyUndoText, historyUndoBtn);
  header.appendChild(historyUndo);

  container.appendChild(header);

  // Chat display area
  const chatShell = createElement(doc, "div", "llm-chat-shell", {
    id: "llm-chat-shell",
  });
  const chatBox = createElement(doc, "div", "llm-messages", {
    id: "llm-chat-box",
  });
  const chatReadinessEmpty = createChatReadinessPrompt(
    doc,
    "llm-chat-readiness-empty",
    "llm-chat-readiness-empty",
    i18n,
  );
  const scrollBottomBtn = createElement(
    doc,
    "button",
    "llm-scroll-bottom-btn",
    {
      id: "llm-scroll-bottom",
      type: "button",
      title: i18n.scrollToBottom,
    },
  );
  chatShell.append(chatBox, chatReadinessEmpty, scrollBottomBtn);
  discussionPanel.appendChild(chatShell);

  contentWrapper.appendChild(discussionPanel);

  // ── Setting Panel (upper) ──
  const settingPanel = createElement(
    doc,
    "div",
    `llm-tab-panel${initialActiveTab === "setting" ? " visible" : ""}`,
    {
      id: "llm-tab-panel-setting",
    },
  );
  settingPanel.dataset.tab = "setting";

  const settingScroll = createElement(doc, "div", "llm-setting-scroll", {
    id: "llm-setting-scroll",
  });
  // Setting content will be populated by settingTab.ts in Phase 2
  const settingPlaceholder = createElement(doc, "div", "llm-tab-placeholder", {
    id: "llm-setting-placeholder",
    textContent: `⚙️ ${i18n.settingPanelLoading}`,
  });
  settingScroll.appendChild(settingPlaceholder);

  settingPanel.append(settingScroll);

  contentWrapper.appendChild(settingPanel);

  // ── Translate Panel (upper) ──
  const translatePanel = buildTranslatePanel(doc, i18n, initialActiveTab);
  contentWrapper.appendChild(translatePanel);
  container.appendChild(contentWrapper);

  // ═══════════════════════════════════════════════════════════
  // Context Menus (absolute positioned, attached to container)
  // ═══════════════════════════════════════════════════════════

  // Shortcut context menu
  const shortcutMenu = createElement(doc, "div", "llm-shortcut-menu", {
    id: "llm-shortcut-menu",
  });
  shortcutMenu.style.display = "none";
  const menuEditBtn = createElement(doc, "button", "llm-shortcut-menu-item", {
    id: "llm-shortcut-menu-edit",
    type: "button",
    textContent: i18n.edit,
  });
  const menuDeleteBtn = createElement(doc, "button", "llm-shortcut-menu-item", {
    id: "llm-shortcut-menu-delete",
    type: "button",
    textContent: i18n.delete,
  });
  const menuAddBtn = createElement(doc, "button", "llm-shortcut-menu-item", {
    id: "llm-shortcut-menu-add",
    type: "button",
    textContent: i18n.add,
  });
  const menuMoveBtn = createElement(doc, "button", "llm-shortcut-menu-item", {
    id: "llm-shortcut-menu-move",
    type: "button",
    textContent: i18n.move,
  });
  const menuResetBtn = createElement(doc, "button", "llm-shortcut-menu-item", {
    id: "llm-shortcut-menu-reset",
    type: "button",
    textContent: i18n.reset,
  });
  shortcutMenu.append(
    menuEditBtn,
    menuDeleteBtn,
    menuAddBtn,
    menuMoveBtn,
    menuResetBtn,
  );
  container.appendChild(shortcutMenu);

  // Response context menu
  const responseMenu = createElement(doc, "div", "llm-response-menu", {
    id: "llm-response-menu",
  });
  responseMenu.style.display = "none";
  const responseMenuCopyBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-response-menu-copy",
      type: "button",
      textContent: i18n.copy,
    },
  );
  const responseMenuNoteBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-response-menu-note",
      type: "button",
      textContent: i18n.saveAsNote,
    },
  );
  const responseMenuExportImageBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-response-menu-export-image",
      type: "button",
      textContent: i18n.export,
    },
  );
  responseMenuExportImageBtn.style.display = "none";
  responseMenu.append(
    responseMenuCopyBtn,
    responseMenuNoteBtn,
    responseMenuExportImageBtn,
  );
  container.appendChild(responseMenu);

  // Prompt context menu
  const promptMenu = createElement(doc, "div", "llm-response-menu", {
    id: "llm-prompt-menu",
  });
  promptMenu.style.display = "none";
  const promptMenuEditBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-prompt-menu-edit",
      type: "button",
      textContent: i18n.edit,
    },
  );
  promptMenu.append(promptMenuEditBtn);
  container.appendChild(promptMenu);

  // Export menu
  const exportMenu = createElement(doc, "div", "llm-response-menu", {
    id: "llm-export-menu",
  });
  exportMenu.style.display = "none";
  const exportMenuCopyBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-export-copy",
      type: "button",
      textContent: i18n.copyChatMd,
    },
  );
  const exportMenuNoteBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-export-note",
      type: "button",
      textContent: i18n.saveChatAsNote,
    },
  );
  exportMenu.append(exportMenuCopyBtn, exportMenuNoteBtn);
  container.appendChild(exportMenu);

  const slashMenu = createElement(
    doc,
    "div",
    "llm-response-menu llm-slash-menu",
    {
      id: "llm-slash-menu",
    },
  );
  slashMenu.style.display = "none";
  const slashUploadBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-slash-upload-option",
      type: "button",
      textContent: i18n.uploadFiles,
    },
  );
  const slashReferenceBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-slash-reference-option",
      type: "button",
      textContent: i18n.selectReferences,
    },
  );
  const slashLibraryBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-slash-library-option",
      type: "button",
      textContent: i18n.addSelectedLibraryItems,
    },
  );
  const slashAnnotationsBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-slash-annotations-option",
      type: "button",
      textContent: i18n.addMyAnnotations,
    },
  );
  const slashAnnotationSummaryBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-slash-annotation-summary-option",
      type: "button",
      textContent: i18n.summarizeMyAnnotations,
    },
  );
  const slashPaperBriefingBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-slash-paper-briefing-option",
      type: "button",
      textContent: i18n.generatePaperBriefing,
    },
  );
  const slashReadingCardBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-slash-reading-card-option",
      type: "button",
      textContent: i18n.generateReadingCard,
    },
  );
  const slashFigureNavigatorBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-slash-figure-navigator-option",
      type: "button",
      textContent: i18n.figureNavigator,
    },
  );
  const slashCitationInsightBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-slash-citation-insight-option",
      type: "button",
      textContent: i18n.explainSelectedCitations,
    },
  );
  const slashConceptExtractBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-slash-concept-extract-option",
      type: "button",
      textContent: i18n.extractConceptCards,
    },
  );
  const slashConceptRecordBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-slash-concept-record-option",
      type: "button",
      textContent: i18n.recordConceptCard,
    },
  );
  const slashGlossaryExportBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-slash-glossary-export-option",
      type: "button",
      textContent: i18n.exportGlossary,
    },
  );
  const slashWritingDraftBtn = createElement(
    doc,
    "button",
    "llm-response-menu-item",
    {
      id: "llm-slash-writing-draft-option",
      type: "button",
      textContent: i18n.exportWritingDraft,
    },
  );
  const makeSlashGroupLabel = (textContent: string) =>
    createElement(doc, "div", "llm-slash-group-label", { textContent });
  slashMenu.append(
    makeSlashGroupLabel(i18n.slashGroupContext),
    slashUploadBtn,
    slashReferenceBtn,
    slashLibraryBtn,
    slashAnnotationsBtn,
    makeSlashGroupLabel(i18n.slashGroupReading),
    slashPaperBriefingBtn,
    slashAnnotationSummaryBtn,
    slashReadingCardBtn,
    slashFigureNavigatorBtn,
    slashCitationInsightBtn,
    slashConceptExtractBtn,
    slashConceptRecordBtn,
    makeSlashGroupLabel(i18n.slashGroupExport),
    slashGlossaryExportBtn,
    slashWritingDraftBtn,
  );
  container.appendChild(slashMenu);

  // Figure navigator — the document's Figure/Table captions as a jump list.
  // Built empty and filled on open, like the history and model menus.
  const figureMenu = createElement(
    doc,
    "div",
    "llm-response-menu llm-figure-menu",
    {
      id: "llm-figure-menu",
    },
  );
  figureMenu.style.display = "none";
  container.appendChild(figureMenu);

  // Retry model menu (opened from latest assistant retry action)
  const retryModelMenu = createElement(doc, "div", "llm-model-menu", {
    id: "llm-retry-model-menu",
  });
  retryModelMenu.style.display = "none";
  container.appendChild(retryModelMenu);

  // ═══════════════════════════════════════════════════════════
  // Tab Bottom Wrapper (lower area — shared, resize: vertical via CSS)
  // ═══════════════════════════════════════════════════════════
  const bottomWrapper = createElement(doc, "div", "llm-tab-bottom-wrapper", {
    id: "llm-tab-bottom-wrapper",
  });

  // ── Discussion Bottom ──
  const { discussionBottom, paperPicker } = buildDiscussionComposer({
    doc,
    i18n,
    hasItem,
    isGlobalMode,
    initialActiveTab,
  });
  bottomWrapper.appendChild(discussionBottom);

  // ── Setting Bottom (spacer to maintain height) ──
  const settingBottom = createElement(
    doc,
    "div",
    `llm-tab-bottom${initialActiveTab === "setting" ? " visible" : ""}`,
    {
      id: "llm-tab-bottom-setting",
    },
  );
  settingBottom.dataset.tab = "setting";
  // Setting tab uses the bottom as a spacer — no content needed,
  // but it fills the space so wrapper height stays linked.
  bottomWrapper.appendChild(settingBottom);

  // ── Translate Bottom (spacer to maintain height, like Setting) ──
  const translateBottom = createElement(
    doc,
    "div",
    `llm-tab-bottom${initialActiveTab === "translate" ? " visible" : ""}`,
    {
      id: "llm-tab-bottom-translate",
    },
  );
  translateBottom.dataset.tab = "translate";
  // Console + actions are now inside translateScroll (contentWrapper),
  // so this bottom panel is an empty spacer — same as settingBottom.
  bottomWrapper.appendChild(translateBottom);

  container.appendChild(bottomWrapper);
  // Keep the @ paper picker outside the bottom wrapper so upward expansion is
  // not clipped by the wrapper's resize/overflow boundary.
  container.appendChild(paperPicker);

  // ═══════════════════════════════════════════════════════════
  // Status line + final assembly
  // ═══════════════════════════════════════════════════════════
  const statusLine = createElement(doc, "div", "llm-status", {
    id: "llm-status",
    textContent: hasItem
      ? isGlobalMode
        ? i18n.statusNoContext
        : i18n.statusReady
      : i18n.statusSelectItem,
  });
  container.appendChild(statusLine);
  body.appendChild(container);

  // ═══════════════════════════════════════════════════════════
  // Tab switching logic
  // ═══════════════════════════════════════════════════════════
  const tabBtns = [tabDiscussionBtn, tabTranslateBtn, tabSettingBtn];
  const tabPanels = [discussionPanel, settingPanel, translatePanel];
  const tabBottoms = [discussionBottom, settingBottom, translateBottom];
  for (const btn of tabBtns) {
    btn.addEventListener("click", () => {
      const tab = isPanelTab(btn.dataset.tab) ? btn.dataset.tab : "discussion";
      // Track active tab on container for CSS-driven visibility
      container.dataset.activeTab = tab;
      persistActiveTab(body, tab);
      // Update button active state
      for (const b of tabBtns) b.classList.toggle("active", b === btn);
      // Toggle panel visibility (upper)
      for (const p of tabPanels)
        p.classList.toggle("visible", p.dataset.tab === tab);
      // Toggle bottom visibility (lower) — wrapper always visible, height stays linked
      for (const b of tabBottoms)
        b.classList.toggle("visible", b.dataset.tab === tab);
      // Swap header icon based on active tab
      (headerIcon as HTMLImageElement).src = TAB_ICON_MAP[tab];
    });
  }
}

export { buildUI };
