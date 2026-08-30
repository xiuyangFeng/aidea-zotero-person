import { assert } from "chai";

import { createSendFlowController } from "../src/modules/contextPanel/setupHandlers/controllers/sendFlowController";
import { buildModelPromptWithAnnotationContext } from "../src/utils/annotationContext";
import type { AnnotationContextSelection } from "../src/modules/contextPanel/types";

const ANNOTATION_ONLY_PROMPT =
  "Please analyze my annotations of this document.";

type SentPayload = {
  question?: string;
  displayQuestion?: string;
};

function createController(
  annotationContext: AnnotationContextSelection | null,
  options: { inputText?: string } = {},
) {
  const item = { id: 42 } as unknown as Zotero.Item;
  const sentPayloads: SentPayload[] = [];
  const statusMessages: Array<{ message: string; level: string }> = [];

  const { doSend } = createSendFlowController({
    body: { ownerDocument: null } as unknown as Element,
    inputBox: { value: options.inputText || "" } as HTMLTextAreaElement,
    isPanelGenerating: () => false,
    getItem: () => item,
    closeSlashMenu: () => {},
    closePaperPicker: () => {},
    getSelectedTextContextEntries: () => [],
    getSelectedPaperContexts: () => [],
    getSelectedFiles: () => [],
    getSelectedImages: () => [],
    // Mirrors textUtils.resolvePromptText: pinned context alone is enough to
    // produce a prompt, so an annotation-only send is not treated as empty.
    resolvePromptText: (text, selectedText, hasAttachmentContext) =>
      text ||
      (selectedText ? "explain" : hasAttachmentContext ? "analyze" : ""),
    buildQuestionWithSelectedTextContexts: (_texts, _sources, promptText) =>
      promptText,
    buildModelPromptWithFileContext: (question) => question,
    getAnnotationContext: () => annotationContext,
    buildModelPromptWithAnnotationContext: (question, selection) =>
      buildModelPromptWithAnnotationContext(
        question,
        selection?.records || [],
        {
          title: selection?.title,
        },
      ),
    annotationOnlyPromptText: ANNOTATION_ONLY_PROMPT,
    isGlobalMode: () => false,
    normalizeConversationTitleSeed: (raw) => `${raw || ""}`.trim(),
    getConversationKey: () => 2_000_000_123,
    touchGlobalConversationTitle: async () => {},
    touchPaperConversationTitle: async () => {},
    getSelectedProfile: () => ({
      key: "openai",
      model: "gpt-test",
      apiBase: "https://example.com",
      apiKey: "token",
    }),
    getCurrentModelName: () => "gpt-test",
    isScreenshotUnsupportedModel: () => false,
    getActiveEditSession: () => null,
    setActiveEditSession: () => {},
    getLatestEditablePair: async () => null,
    editLatestUserMessageAndRetry: async () => "missing",
    sendQuestion: async (
      _body,
      _item,
      question,
      _images,
      _model,
      _apiBase,
      _apiKey,
      _advanced,
      displayQuestion,
    ) => {
      sentPayloads.push({ question, displayQuestion });
    },
    clearSelectedImageState: () => {},
    clearSelectedPaperState: () => {},
    clearSelectedFileState: () => {},
    clearSelectedTextState: () => {},
    updatePaperPreviewPreservingScroll: () => {},
    updateFilePreviewPreservingScroll: () => {},
    updateImagePreviewPreservingScroll: () => {},
    updateSelectedTextPreviewPreservingScroll: () => {},
    scheduleAttachmentGc: () => {},
    refreshGlobalHistoryHeader: () => {},
    setStatusMessage: (message, level) => {
      statusMessages.push({ message, level });
    },
    editStaleStatusText: "stale",
  });

  return { doSend, sentPayloads, statusMessages };
}

const selection: AnnotationContextSelection = {
  attachmentId: 7,
  title: "Attention Is All You Need",
  records: [
    {
      type: "highlight",
      text: "self-attention",
      comment: "core idea",
      pageLabel: "3",
      pageIndex: 2,
      color: "#ffd400",
      sortIndex: "00002|000010|00050",
    },
  ],
};

describe("sendFlowController annotation context", function () {
  it("appends the annotation block to the model prompt", async function () {
    const { doSend, sentPayloads } = createController(selection, {
      inputText: "What did I mark?",
    });
    await doSend();

    assert.lengthOf(sentPayloads, 1);
    const question = sentPayloads[0]?.question || "";
    assert.isTrue(question.startsWith("What did I mark?"));
    assert.include(question, "[USER ANNOTATIONS — Attention Is All You Need]");
    assert.include(question, '1. [p.3] highlight: "self-attention"');
    assert.include(question, "   user note: core idea");
    // The user still sees only what they typed.
    assert.equal(sentPayloads[0]?.displayQuestion, "What did I mark?");
  });

  it("sends with a default prompt when annotations are the only context", async function () {
    const { doSend, sentPayloads } = createController(selection);
    await doSend();

    assert.lengthOf(sentPayloads, 1);
    assert.equal(sentPayloads[0]?.displayQuestion, ANNOTATION_ONLY_PROMPT);
    assert.include(sentPayloads[0]?.question || "", "[USER ANNOTATIONS");
  });

  it("leaves the prompt untouched when nothing is pinned", async function () {
    const { doSend, sentPayloads, statusMessages } = createController(null, {
      inputText: "Plain question",
    });
    await doSend();

    assert.lengthOf(sentPayloads, 1);
    assert.equal(sentPayloads[0]?.question, "Plain question");
    assert.deepEqual(statusMessages, []);
  });

  it("still refuses an empty send with no context at all", async function () {
    const { doSend, sentPayloads, statusMessages } = createController(null);
    await doSend();

    assert.lengthOf(sentPayloads, 0);
    assert.lengthOf(statusMessages, 1);
    assert.equal(statusMessages[0]?.level, "warning");
  });

  it("treats an empty annotation set as no context", async function () {
    const { doSend, sentPayloads, statusMessages } = createController({
      ...selection,
      records: [],
    });
    await doSend();

    assert.lengthOf(sentPayloads, 0);
    assert.lengthOf(statusMessages, 1);
  });
});
