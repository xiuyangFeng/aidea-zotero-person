import { createElement } from "../../../utils/domHelpers";
import {
  UPLOAD_FILE_EXPANDED_LABEL,
  formatFigureCountLabel,
  formatFileCountLabel,
} from "../constants";
import { pickChatInputPlaceholder } from "../placeholderTips";
import {
  createActionDropdown,
  createChatReadinessPrompt,
  type PanelI18n,
} from "./primitives";

export type DiscussionComposer = {
  /** Lower half of the discussion tab: shortcuts row + composer. */
  discussionBottom: HTMLDivElement;
  /**
   * The `@` reference picker. It lives outside the bottom wrapper so upward
   * expansion is not clipped by the wrapper's resize boundary, so the caller
   * mounts it separately.
   */
  paperPicker: HTMLDivElement;
};

/**
 * Build the discussion composer: pinned-context previews, the readiness
 * banner, the `@` picker, the textarea, and the action bar.
 */
export function buildDiscussionComposer(params: {
  doc: Document;
  i18n: PanelI18n;
  hasItem: boolean;
  isGlobalMode: boolean;
  initialActiveTab: string;
}): DiscussionComposer {
  const { doc, i18n, hasItem, isGlobalMode, initialActiveTab } = params;

  const discussionBottom = createElement(
    doc,
    "div",
    `llm-tab-bottom${initialActiveTab === "discussion" ? " visible" : ""}`,
    {
      id: "llm-tab-bottom-discussion",
    },
  );
  discussionBottom.dataset.tab = "discussion";

  // Input section
  const inputSection = createElement(doc, "div", "llm-input-section");

  const contextPreviews = createElement(doc, "div", "llm-context-previews", {
    id: "llm-context-previews",
  });
  const selectedContextList = createElement(
    doc,
    "div",
    "llm-selected-context-list",
    {
      id: "llm-selected-context-list",
    },
  );
  selectedContextList.style.display = "none";
  contextPreviews.appendChild(selectedContextList);

  const paperPreview = createElement(doc, "div", "llm-paper-context-inline", {
    id: "llm-paper-context-preview",
  });
  paperPreview.style.display = "none";
  const paperPreviewList = createElement(
    doc,
    "div",
    "llm-paper-context-inline-list",
    {
      id: "llm-paper-context-list",
    },
  );
  const paperPreviewExpanded = createElement(
    doc,
    "div",
    "llm-image-preview-expanded llm-paper-context-expanded",
    {
      id: "llm-paper-context-expanded",
    },
  );
  paperPreviewExpanded.style.display = "none";
  const paperPreviewExpandedList = createElement(
    doc,
    "div",
    "llm-paper-context-list",
    {
      id: "llm-paper-context-expanded-list",
    },
  );
  paperPreviewExpanded.append(paperPreviewExpandedList);
  paperPreview.append(paperPreviewList, paperPreviewExpanded);
  contextPreviews.appendChild(paperPreview);

  // Image preview area (shows selected screenshot)
  const imagePreview = createElement(doc, "div", "llm-image-preview", {
    id: "llm-image-preview",
  });
  imagePreview.style.display = "none";

  const imagePreviewMeta = createElement(
    doc,
    "button",
    "llm-image-preview-meta",
    {
      id: "llm-image-preview-meta",
      type: "button",
      textContent: formatFigureCountLabel(0),
      title: i18n.expandFigures,
    },
  );
  const imagePreviewHeader = createElement(
    doc,
    "div",
    "llm-image-preview-header",
    {
      id: "llm-image-preview-header",
    },
  );
  const removeImgBtn = createElement(doc, "button", "llm-remove-img-btn", {
    id: "llm-remove-img",
    type: "button",
    textContent: "×",
    title: i18n.clearSelectedScreenshots,
  });
  removeImgBtn.setAttribute("aria-label", i18n.clearSelectedScreenshots);
  imagePreviewHeader.append(imagePreviewMeta, removeImgBtn);

  const imagePreviewExpanded = createElement(
    doc,
    "div",
    "llm-image-preview-expanded",
    {
      id: "llm-image-preview-expanded",
    },
  );
  const previewStrip = createElement(doc, "div", "llm-image-preview-strip", {
    id: "llm-image-preview-strip",
  });
  const previewLargeWrap = createElement(
    doc,
    "div",
    "llm-image-preview-selected",
    {
      id: "llm-image-preview-selected",
    },
  );
  const previewLargeImg = createElement(
    doc,
    "img",
    "llm-image-preview-selected-img",
    {
      id: "llm-image-preview-selected-img",
      alt: i18n.selectedScreenshotPreview,
    },
  ) as HTMLImageElement;
  previewLargeWrap.appendChild(previewLargeImg);

  imagePreviewExpanded.append(previewStrip, previewLargeWrap);
  imagePreview.append(imagePreviewHeader, imagePreviewExpanded);
  contextPreviews.appendChild(imagePreview);

  const filePreview = createElement(doc, "div", "llm-image-preview", {
    id: "llm-file-context-preview",
  });
  filePreview.style.display = "none";
  const filePreviewMeta = createElement(
    doc,
    "button",
    "llm-image-preview-meta llm-file-context-meta",
    {
      id: "llm-file-context-meta",
      type: "button",
      textContent: formatFileCountLabel(0),
      title: i18n.expandFiles,
    },
  );
  const filePreviewHeader = createElement(
    doc,
    "div",
    "llm-image-preview-header",
    {
      id: "llm-file-context-header",
    },
  );
  const filePreviewClear = createElement(doc, "button", "llm-remove-img-btn", {
    id: "llm-file-context-clear",
    type: "button",
    textContent: "×",
    title: i18n.clearUploadedFiles,
  });
  filePreviewClear.setAttribute("aria-label", i18n.clearUploadedFiles);
  filePreviewHeader.append(filePreviewMeta, filePreviewClear);
  const filePreviewExpanded = createElement(
    doc,
    "div",
    "llm-image-preview-expanded llm-file-context-expanded",
    {
      id: "llm-file-context-expanded",
    },
  );
  const filePreviewList = createElement(doc, "div", "llm-file-context-list", {
    id: "llm-file-context-list",
  });
  filePreviewExpanded.append(filePreviewList);
  filePreview.append(filePreviewHeader, filePreviewExpanded);
  contextPreviews.appendChild(filePreview);
  inputSection.appendChild(contextPreviews);
  const chatReadinessBar = createChatReadinessPrompt(
    doc,
    "llm-chat-readiness-bar",
    "llm-chat-readiness-bar",
    i18n,
  );
  inputSection.appendChild(chatReadinessBar);

  const paperPicker = createElement(doc, "div", "llm-paper-picker", {
    id: "llm-paper-picker",
  });
  paperPicker.style.display = "none";
  const paperPickerList = createElement(doc, "div", "llm-paper-picker-list", {
    id: "llm-paper-picker-list",
  });
  paperPickerList.setAttribute("role", "listbox");
  paperPicker.appendChild(paperPickerList);

  const inputBox = createElement(doc, "textarea", "llm-input", {
    id: "llm-input",
    placeholder: hasItem
      ? pickChatInputPlaceholder(i18n, isGlobalMode ? "global" : "paper")
      : i18n.openPdfFirst,
    disabled: !hasItem,
  });
  inputBox.setAttribute("dir", "auto");
  inputSection.appendChild(inputBox);

  // Actions row
  const actionsRow = createElement(doc, "div", "llm-actions");
  const actionsLeft = createElement(doc, "div", "llm-actions-left");
  const actionsRight = createElement(doc, "div", "llm-actions-right");

  const selectTextBtn = createElement(
    doc,
    "button",
    "llm-shortcut-btn llm-action-btn llm-action-btn-secondary llm-select-text-btn llm-action-icon-only",
    {
      id: "llm-select-text",
      type: "button",
      textContent: "",
      title: i18n.addTextTitle,
      disabled: !hasItem,
    },
  );
  const selectTextSlot = createElement(doc, "div", "llm-action-slot");
  selectTextSlot.appendChild(selectTextBtn);

  // Screenshot button
  const screenshotBtn = createElement(
    doc,
    "button",
    "llm-shortcut-btn llm-action-btn llm-action-btn-secondary llm-screenshot-btn",
    {
      id: "llm-screenshot",
      textContent: i18n.screenshots,
      title: i18n.selectFigureScreenshot,
      disabled: !hasItem,
    },
  );
  const screenshotSlot = createElement(doc, "div", "llm-action-slot");
  screenshotSlot.appendChild(screenshotBtn);

  const uploadBtn = createElement(
    doc,
    "button",
    "llm-shortcut-btn llm-action-btn llm-action-btn-secondary llm-upload-file-btn llm-slash-menu-btn",
    {
      id: "llm-upload-file",
      type: "button",
      textContent: UPLOAD_FILE_EXPANDED_LABEL,
      title: i18n.contextActions,
      disabled: !hasItem,
    },
  );
  uploadBtn.setAttribute("aria-haspopup", "menu");
  uploadBtn.setAttribute("aria-expanded", "false");
  uploadBtn.setAttribute("aria-label", i18n.contextActions);
  const uploadInput = createElement(doc, "input", "", {
    id: "llm-upload-input",
    type: "file",
  }) as HTMLInputElement;
  uploadInput.multiple = true;
  uploadInput.style.display = "none";
  const uploadSlot = createElement(doc, "div", "llm-action-slot");
  uploadSlot.append(uploadBtn, uploadInput);

  const {
    slot: modelDropdown,
    button: modelBtn,
    menu: modelMenu,
  } = createActionDropdown(doc, {
    slotId: "llm-model-dropdown",
    slotClassName: "llm-model-dropdown",
    buttonId: "llm-model-toggle",
    buttonClassName:
      "llm-shortcut-btn llm-action-btn llm-action-btn-secondary llm-model-btn",
    buttonText: i18n.modelSelectHint,
    menuId: "llm-model-menu",
    menuClassName: "llm-model-menu",
    disabled: !hasItem,
  });

  // Thinking-level selector — hidden until a reasoning-capable model is active.
  const { slot: reasoningDropdown, button: reasoningBtn } =
    createActionDropdown(doc, {
      slotId: "llm-reasoning-dropdown",
      slotClassName: "llm-reasoning-dropdown",
      buttonId: "llm-reasoning-toggle",
      buttonClassName:
        "llm-shortcut-btn llm-action-btn llm-action-btn-secondary llm-reasoning-btn",
      buttonText: "",
      menuId: "llm-reasoning-menu",
      menuClassName: "llm-reasoning-menu",
      disabled: !hasItem,
    });
  reasoningDropdown.style.display = "none";
  reasoningBtn.setAttribute("aria-haspopup", "menu");
  reasoningBtn.setAttribute("aria-expanded", "false");

  const sendBtn = createElement(
    doc,
    "button",
    "llm-shortcut-btn llm-action-btn llm-action-btn-primary llm-send-btn",
    {
      id: "llm-send",
      textContent: "",
      title: i18n.send,
      disabled: !hasItem,
    },
  );
  sendBtn.setAttribute("aria-label", i18n.send);
  const cancelBtn = createElement(
    doc,
    "button",
    "llm-shortcut-btn llm-action-btn llm-action-btn-danger llm-send-btn llm-cancel-btn",
    {
      id: "llm-cancel",
      textContent: "",
      title: i18n.cancel,
      type: "button",
    },
  );
  cancelBtn.setAttribute("aria-label", i18n.cancel);
  cancelBtn.style.display = "none";
  const sendSlot = createElement(doc, "div", "llm-action-slot");
  sendSlot.append(sendBtn, cancelBtn);

  // New conversation button
  const newChatBtn = createElement(
    doc,
    "button",
    "llm-shortcut-btn llm-action-btn llm-action-btn-secondary llm-new-chat-btn llm-action-icon-only",
    {
      id: "llm-new-chat",
      type: "button",
      textContent: "",
      title: i18n.newConversation,
    },
  );
  const newChatSlot = createElement(doc, "div", "llm-action-slot");
  newChatSlot.appendChild(newChatBtn);

  // Order: ➕ new chat, 📎 upload/attach, ✂️ screenshot, Add Text, Model, Thinking
  actionsLeft.append(
    newChatSlot,
    uploadSlot,
    screenshotSlot,
    selectTextSlot,
    modelDropdown,
    reasoningDropdown,
  );
  actionsRight.append(sendSlot);
  actionsRow.append(actionsLeft, actionsRight);
  inputSection.appendChild(actionsRow);

  // Shortcuts row — placed in bottomWrapper so contentWrapper's
  // resize grip appears between chat and shortcuts
  const shortcutsRow = createElement(doc, "div", "llm-shortcuts", {
    id: "llm-shortcuts",
  });
  discussionBottom.append(shortcutsRow, inputSection);

  return {
    discussionBottom: discussionBottom as HTMLDivElement,
    paperPicker: paperPicker as HTMLDivElement,
  };
}
