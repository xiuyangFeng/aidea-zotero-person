/**
 * Auto briefing — the opening card a paper answers with before it is read.
 *
 * Opening a PDF in the reader is the one moment where the plugin knows what
 * the user wants without being told: a short, structured account of what this
 * document is. The briefing is produced through the normal chat path — the
 * panel assembles a prompt here, drops it into the composer, and the answer
 * arrives as an ordinary assistant message — so it can be saved as a note,
 * followed up on, and its `[p.N]` anchors clicked like any other answer.
 *
 * Because the answer is an ordinary message it is also persisted with the
 * conversation, which is what makes the whole feature idempotent: the trigger
 * only fires on an empty conversation, so reopening the same paper shows the
 * stored briefing and costs nothing. Everything about *whether* to fire is
 * expressed here as two pure predicates — one at schedule time, one after the
 * delay — so the panel module only has to gather facts.
 *
 * Everything in this module is pure string and predicate handling apart from
 * `getAutoBriefingMode`, which reads its preference defensively so the module
 * stays usable without a Zotero runtime.
 */

import { config } from "../../package.json";
import { buildSuggestedQuestionsInstruction } from "./suggestedQuestions";

/** Preference choosing when a briefing is generated. */
export const AUTO_BRIEFING_MODE_PREF_KEY = "autoBriefing.mode";

/**
 * What the user asked for.
 *
 * `auto` writes a briefing the first time a paper's conversation is opened
 * empty; `manual` keeps the + menu action but never fires by itself; `off`
 * is `manual` plus the intent to be left alone, and is kept distinct so the
 * setting reads as a real three-way choice rather than a checkbox.
 */
export type AutoBriefingMode = "auto" | "manual" | "off";

export const AUTO_BRIEFING_MODES: readonly AutoBriefingMode[] = [
  "auto",
  "manual",
  "off",
];

/**
 * How long the panel waits before an automatic briefing is sent.
 *
 * Opening five PDFs to find the right one is a normal way to use Zotero, and
 * each of those tabs bootstraps a panel. The delay makes the trigger survive
 * that: a tab the user leaves within a couple of seconds never reaches the
 * second check, so only the paper actually settled on spends a request.
 */
export const AUTO_BRIEFING_TRIGGER_DELAY_MS = 2500;

export type AutoBriefingLang = "en-US" | "zh-CN";

/**
 * Briefing copy exists in English and Simplified Chinese only. Other panel
 * languages fall back to English, matching how the shortcut prompt files
 * resolve.
 */
export function resolveAutoBriefingLang(
  lang: string | null | undefined,
): AutoBriefingLang {
  return String(lang || "")
    .trim()
    .toLowerCase()
    .startsWith("zh")
    ? "zh-CN"
    : "en-US";
}

/** Title line the briefing must open with. */
export const PAPER_BRIEFING_TITLE: Record<AutoBriefingLang, string> = {
  "en-US": "Paper Briefing",
  "zh-CN": "论文速览",
};

export function normalizeAutoBriefingMode(value: unknown): AutoBriefingMode {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "manual") return "manual";
  if (normalized === "off") return "off";
  return "auto";
}

/**
 * Configured briefing mode. Defaults to `auto`, including when no Zotero
 * runtime is available.
 */
export function getAutoBriefingMode(): AutoBriefingMode {
  try {
    const prefs = (globalThis as { Zotero?: { Prefs?: { get?: unknown } } })
      .Zotero?.Prefs;
    if (typeof prefs?.get !== "function") return "auto";
    const value = (prefs.get as (key: string, global?: boolean) => unknown)(
      `${config.prefsPrefix}.${AUTO_BRIEFING_MODE_PREF_KEY}`,
      true,
    );
    return normalizeAutoBriefingMode(value);
  } catch {
    return "auto";
  }
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

type PaperBriefingCopy = {
  titleRule: (title: string) => string;
  lengthRule: string;
  pageRule: string;
  noPageRule: string;
};

const PAPER_BRIEFING_COPY: Record<AutoBriefingLang, PaperBriefingCopy> = {
  "en-US": {
    titleRule: (title) =>
      `Open the answer with the single line "# ${title}" and put nothing above it.`,
    lengthRule:
      "Keep the whole briefing under 400 words. This is the first thing I read about the paper, not a summary of it — cut anything that does not help me decide how to read it.",
    pageRule:
      "Cite the page of every key claim and number inline as [p.N], right where the claim is made. Leave the citation out rather than guessing a page.",
    noPageRule:
      "This document carries no page numbers, so do not write [p.N] citations. Quote a short locating phrase from the text instead.",
  },
  "zh-CN": {
    titleRule: (title) =>
      `回答的第一行必须是“# ${title}”，其上不要有任何内容。`,
    lengthRule:
      "整份速览控制在 600 字以内。这是我读这篇论文前看到的第一份材料，不是全文摘要——凡是无助于我决定怎么读它的内容都删掉。",
    pageRule:
      "每个关键论断和数字都要在原地用 [p.N] 标注页码；无法确定页码时宁可省略，不要猜。",
    noPageRule:
      "这份文档没有页码，因此不要使用 [p.N] 页码引用，改为引用原文中一小段可定位的措辞。",
  },
};

/**
 * Slot the bundled template reserves for the follow-up question instruction.
 *
 * The instruction is optional — it is a preference away from being dropped —
 * so the template marks where it belongs instead of containing it. Substituting
 * an empty string is what "turned off" looks like, and it leaves a template
 * that reads exactly as it did before the feature existed.
 */
export const PAPER_BRIEFING_QUESTIONS_PLACEHOLDER = "{{QUESTIONS}}";

export type BuildPaperBriefingPromptOptions = {
  /** Text of the bundled `paper-briefing.txt` for the active language. */
  builtinTemplate: string;
  lang?: string;
  /** Result of `resolveReadingCardPageCitations`; defaults to true. */
  pageCitations?: boolean;
  /** Result of `isSuggestedQuestionsEnabled`; defaults to true. */
  suggestedQuestions?: boolean;
};

/**
 * Assemble the prompt sent for a briefing.
 *
 * The bundled template supplies the heading skeleton and the per-heading
 * length rules; the three lines appended here are the ones that must hold
 * whatever the template says — the title line, the overall length budget that
 * keeps a briefing from becoming a survey, and whether pages may be cited.
 *
 * The follow-up questions are asked for at the template's own placeholder so
 * they stay attached to the skeleton rather than to the trailing rules; a
 * template that lost the placeholder still gets them, appended last, because a
 * missing slot must not silently disable the feature.
 *
 * Returns an empty string when the template could not be read, so the caller
 * can report the failure instead of sending three bare rules to the model.
 */
export function buildPaperBriefingPrompt(
  options: BuildPaperBriefingPromptOptions,
): string {
  const template = String(options.builtinTemplate || "").trim();
  if (!template) return "";
  const lang = resolveAutoBriefingLang(options.lang);
  const copy = PAPER_BRIEFING_COPY[lang];
  const questions =
    options.suggestedQuestions === false
      ? ""
      : buildSuggestedQuestionsInstruction(lang);

  const hasPlaceholder = template.includes(
    PAPER_BRIEFING_QUESTIONS_PLACEHOLDER,
  );
  const body = hasPlaceholder
    ? template
        .split(PAPER_BRIEFING_QUESTIONS_PLACEHOLDER)
        .join(questions)
        // Substituting nothing leaves the blank lines that framed the slot.
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : template;

  const rules = [
    copy.titleRule(PAPER_BRIEFING_TITLE[lang]),
    copy.lengthRule,
    options.pageCitations === false ? copy.noPageRule : copy.pageRule,
  ];
  const sections = [body, rules.join("\n")];
  if (questions && !hasPlaceholder) sections.push(questions);
  return sections.join("\n\n").trim();
}

// ---------------------------------------------------------------------------
// Trigger conditions
// ---------------------------------------------------------------------------

/**
 * Why an automatic briefing was not scheduled.
 *
 * Reported rather than swallowed so the panel can log one line explaining a
 * missing briefing; none of these are user-facing errors.
 */
export type AutoBriefingSkipReason =
  | "not-reader"
  | "mode-not-auto"
  | "already-attempted"
  | "conversation-not-loaded"
  | "conversation-not-empty"
  | "composer-in-use"
  | "generating"
  | "no-document"
  | "no-model";

export type AutoBriefingGateInput = {
  /** The panel's `data-tab-type`; only a reader panel may auto-brief. */
  panelKind: string;
  mode: AutoBriefingMode;
  /** Whether this panel instance already scheduled or ran a briefing. */
  alreadyAttempted: boolean;
  /** Whether the stored conversation has finished loading into memory. */
  conversationLoaded: boolean;
  /** Messages on the active conversation path; anything above zero blocks. */
  messageCount: number;
  /**
   * Whether the composer already holds something of the user's — a restored
   * draft, pinned text, papers, files or screenshots. Sending overwrites the
   * composer and consumes its pinned context, so a briefing must never run
   * over work in progress.
   */
  composerDirty: boolean;
  /** Whether a request is already in flight in this panel. */
  generating: boolean;
  /** Whether a readable PDF/EPUB was resolved for the panel's item. */
  hasDocument: boolean;
  /** Whether a model is configured; without one the send would only error. */
  hasModel: boolean;
};

export type AutoBriefingGateResult = {
  trigger: boolean;
  reason: AutoBriefingSkipReason | null;
};

/**
 * Whether a panel that has just finished bootstrapping should schedule one.
 *
 * The empty-conversation rule carries the idempotency: a briefing is itself a
 * message, so the second time a paper is opened this check already fails and
 * the stored card is what the user sees. Clearing the conversation is
 * therefore also the way to ask for a fresh one.
 *
 * Checks run in order of how specific they are, so the reason returned names
 * the most informative cause rather than whichever ran first.
 */
export function evaluateAutoBriefingGate(
  input: AutoBriefingGateInput,
): AutoBriefingGateResult {
  const skip = (reason: AutoBriefingSkipReason): AutoBriefingGateResult => ({
    trigger: false,
    reason,
  });
  if (input.panelKind !== "reader") return skip("not-reader");
  if (input.mode !== "auto") return skip("mode-not-auto");
  if (input.alreadyAttempted) return skip("already-attempted");
  if (!input.conversationLoaded) return skip("conversation-not-loaded");
  if (input.messageCount > 0) return skip("conversation-not-empty");
  if (input.composerDirty) return skip("composer-in-use");
  if (input.generating) return skip("generating");
  if (!input.hasDocument) return skip("no-document");
  if (!input.hasModel) return skip("no-model");
  return { trigger: true, reason: null };
}

export type AutoBriefingRecheckInput = {
  /** Whether the panel host is still in the document. */
  panelConnected: boolean;
  /** Item id the panel was built for. */
  panelItemId: number;
  /**
   * Attachment the active reader tab is showing, or null when that cannot be
   * determined. Null does not veto: an unreadable tab signal must not disable
   * the feature, the remaining checks still guard the send.
   */
  activeDocumentItemId: number | null;
  conversationLoaded: boolean;
  messageCount: number;
  composerDirty: boolean;
  generating: boolean;
};

/**
 * Whether a scheduled briefing should still be sent once the delay elapsed.
 *
 * Everything the first gate checked can have changed in the meantime: the
 * user may have switched tabs, started typing a question of their own, pinned
 * a passage into the composer, or closed the panel. Re-reading the same facts
 * here is what keeps a burst of opened PDFs from turning into a burst of
 * requests, and what keeps the briefing from talking over the user.
 */
export function shouldStillAutoBrief(input: AutoBriefingRecheckInput): boolean {
  if (!input.panelConnected) return false;
  if (
    input.activeDocumentItemId !== null &&
    input.activeDocumentItemId !== input.panelItemId
  ) {
    return false;
  }
  if (!input.conversationLoaded) return false;
  if (input.messageCount > 0) return false;
  if (input.composerDirty) return false;
  if (input.generating) return false;
  return true;
}
