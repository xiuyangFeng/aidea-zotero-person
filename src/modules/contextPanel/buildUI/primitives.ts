import { createElement } from "../../../utils/domHelpers";
import type { getPanelI18n } from "../i18n";
import type { ActionDropdownSpec } from "../types";

export type PanelI18n = ReturnType<typeof getPanelI18n>;

/** Slot + toggle button + floating menu, shared by the model and thinking pickers. */
export function createActionDropdown(doc: Document, spec: ActionDropdownSpec) {
  const slot = createElement(
    doc,
    "div",
    `llm-action-slot ${spec.slotClassName}`.trim(),
    { id: spec.slotId },
  );
  const button = createElement(doc, "button", spec.buttonClassName, {
    id: spec.buttonId,
    textContent: spec.buttonText,
    disabled: spec.disabled,
  });
  const menu = createElement(doc, "div", spec.menuClassName, {
    id: spec.menuId,
  });
  menu.style.display = "none";
  slot.append(button, menu);
  return { slot, button, menu };
}

/** Inline prompt shown when no model is configured yet. */
export function createChatReadinessPrompt(
  doc: Document,
  id: string,
  className: string,
  i18n: PanelI18n,
) {
  const prompt = createElement(doc, "div", `llm-chat-readiness ${className}`, {
    id,
  });
  prompt.hidden = true;
  prompt.setAttribute("role", "status");
  prompt.setAttribute("aria-live", "polite");

  const text = createElement(doc, "div", "llm-chat-readiness-text");
  const title = createElement(doc, "div", "llm-chat-readiness-title", {
    id: `${id}-title`,
    textContent: i18n.chatReadinessTitle,
  });
  const message = createElement(doc, "div", "llm-chat-readiness-message", {
    id: `${id}-message`,
    textContent: i18n.chatReadinessNoModels,
  });
  text.append(title, message);

  const action = createElement(doc, "button", "llm-chat-readiness-action", {
    id: `${id}-action`,
    type: "button",
    textContent: i18n.chatReadinessOpenSettings,
  });
  prompt.append(text, action);
  return prompt;
}
