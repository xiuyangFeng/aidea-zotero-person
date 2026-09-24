/**
 * Empty-conversation guide — what an empty chat shows instead of a bare logo.
 *
 * A fresh conversation is the moment a new user has no idea what to type. The
 * guide offers a handful of one-click starting points, each of which is an
 * existing action: a guide entry only names the menu row it stands for, and
 * the panel's click handler presses that row, so there is exactly one
 * implementation of every action. A last line lists the configured global
 * hotkeys, which are otherwise only discoverable in Settings.
 *
 * Entry selection is pure so the rules can be tested without a DOM.
 */

import { createElement } from "../../utils/domHelpers";
import type { PanelI18n } from "./i18n";

export type EmptyGuideEntryId =
  | "paper-briefing"
  | "reading-card"
  | "ask-selection"
  | "annotation-summary"
  | "add-library-items"
  | "select-references"
  | "reading-menu";

export type EmptyGuideContext = {
  /** The conversation is about one paper (not a library-wide chat). */
  hasPaper: boolean;
  /** The panel sits beside an open reader, where a selection can exist. */
  isReader: boolean;
};

/**
 * Menu row each entry presses. `reading-menu` opens the menu itself and has
 * no row.
 */
export const EMPTY_GUIDE_ENTRY_TARGETS: Record<
  Exclude<EmptyGuideEntryId, "reading-menu">,
  string
> = {
  "paper-briefing": "#llm-slash-paper-briefing-option",
  "reading-card": "#llm-slash-reading-card-option",
  "ask-selection": "#llm-reading-explain-option",
  "annotation-summary": "#llm-slash-annotation-summary-option",
  "add-library-items": "#llm-slash-library-option",
  "select-references": "#llm-slash-reference-option",
};

/**
 * Starting points for this panel, most useful first.
 *
 * A reader panel leads with the briefing and the selection, since the paper
 * is open in front of the user. A paper conversation in the library has no
 * selection to ask about, so the reading card takes that place. A library-
 * wide conversation has no paper at all: its first step is bringing papers
 * in, and whole-paper actions would only fail there.
 */
export function selectEmptyGuideEntries(
  context: EmptyGuideContext,
): EmptyGuideEntryId[] {
  if (!context.hasPaper) {
    return ["add-library-items", "select-references", "reading-menu"];
  }
  if (context.isReader) {
    return [
      "paper-briefing",
      "ask-selection",
      "annotation-summary",
      "reading-menu",
    ];
  }
  return [
    "paper-briefing",
    "reading-card",
    "annotation-summary",
    "reading-menu",
  ];
}

export function isEmptyGuideEntryId(
  value: unknown,
): value is EmptyGuideEntryId {
  return (
    value === "reading-menu" ||
    (typeof value === "string" &&
      Object.prototype.hasOwnProperty.call(EMPTY_GUIDE_ENTRY_TARGETS, value))
  );
}

function entryLabel(id: EmptyGuideEntryId, i18n: PanelI18n): string {
  switch (id) {
    case "paper-briefing":
      return i18n.generatePaperBriefing;
    case "reading-card":
      return i18n.generateReadingCard;
    case "ask-selection":
      return i18n.emptyGuideAskSelection;
    case "annotation-summary":
      return i18n.summarizeMyAnnotations;
    case "add-library-items":
      return i18n.addSelectedLibraryItems;
    case "select-references":
      return i18n.selectReferences;
    case "reading-menu":
      return i18n.emptyGuideMoreTools;
  }
}

/**
 * Build the guide card. Entries carry `data-guide-action`; the panel's chat
 * click handler dispatches them.
 */
export function buildEmptyConversationGuide(
  doc: Document,
  params: {
    context: EmptyGuideContext;
    i18n: PanelI18n;
    /** Already-formatted hotkeys line; omitted when empty. */
    hotkeyHint?: string;
  },
): HTMLDivElement {
  const { context, i18n } = params;
  const card = createElement(doc, "div", "llm-empty-guide");
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", i18n.emptyGuideTitle);

  const title = createElement(doc, "div", "llm-empty-guide-title", {
    textContent: i18n.emptyGuideTitle,
  });
  const intro = createElement(doc, "div", "llm-empty-guide-intro", {
    textContent: context.hasPaper
      ? i18n.emptyGuideReaderIntro
      : i18n.emptyGuideLibraryIntro,
  });
  const list = createElement(doc, "div", "llm-empty-guide-list");
  for (const id of selectEmptyGuideEntries(context)) {
    const button = createElement(doc, "button", "llm-empty-guide-entry", {
      type: "button",
      textContent: entryLabel(id, i18n),
    });
    button.dataset.guideAction = id;
    list.appendChild(button);
  }
  card.append(title, intro, list);

  const hint = String(params.hotkeyHint || "").trim();
  if (hint) {
    card.appendChild(
      createElement(doc, "div", "llm-empty-guide-hotkeys", {
        textContent: hint,
      }),
    );
  }
  return card;
}
