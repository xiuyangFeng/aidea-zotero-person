import { assert } from "chai";

import {
  scanSentenceStartInText,
  upgradePageAnchorSentences,
} from "../src/modules/contextPanel/pageAnchorSentences";

// ---------------------------------------------------------------------------
// Minimal DOM mock (node + mocha, no browser DOM available)
// ---------------------------------------------------------------------------

type MockNode = any;

function detach(node: MockNode): void {
  const parent = node.parentNode;
  if (!parent) return;
  const index = parent.childNodes.indexOf(node);
  if (index >= 0) parent.childNodes.splice(index, 1);
  node.parentNode = null;
}

function previousSiblingOf(node: MockNode): MockNode | null {
  const parent = node.parentNode;
  if (!parent) return null;
  const index = parent.childNodes.indexOf(node);
  return index > 0 ? parent.childNodes[index - 1] : null;
}

function createTextNode(doc: MockNode, text: string): MockNode {
  const node: MockNode = {
    nodeType: 3,
    nodeValue: String(text),
    parentNode: null,
    ownerDocument: doc,
    get textContent() {
      return node.nodeValue;
    },
    get previousSibling() {
      return previousSiblingOf(node);
    },
    splitText(offset: number) {
      const rest = node.nodeValue.slice(offset);
      node.nodeValue = node.nodeValue.slice(0, offset);
      const next = createTextNode(doc, rest);
      const parent = node.parentNode;
      if (parent) {
        const index = parent.childNodes.indexOf(node);
        parent.childNodes.splice(index + 1, 0, next);
        next.parentNode = parent;
      }
      return next;
    },
  };
  return node;
}

function matchesClassSelector(node: MockNode, selector: string): boolean {
  if (!node || node.nodeType !== 1) return false;
  const wanted = selector.split(".").filter(Boolean);
  const actual = String(node.getAttribute("class") || "")
    .split(/\s+/)
    .filter(Boolean);
  return wanted.every((cls) => actual.includes(cls));
}

function createElement(doc: MockNode, tagName: string): MockNode {
  const attrs = new Map<string, string>();
  const element: MockNode = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: [] as MockNode[],
    parentNode: null,
    ownerDocument: doc,
    get className() {
      return attrs.get("class") || "";
    },
    get attributes() {
      return [...attrs].map(([name, value]) => ({ name, value }));
    },
    classList: {
      contains: (cls: string) =>
        String(attrs.get("class") || "")
          .split(/\s+/)
          .includes(cls),
    },
    getAttribute: (name: string) =>
      attrs.has(name) ? (attrs.get(name) as string) : null,
    setAttribute: (name: string, value: string) => {
      attrs.set(name, String(value));
    },
    get textContent() {
      return element.childNodes
        .map((child: MockNode) => child.textContent)
        .join("");
    },
    get previousSibling() {
      return previousSiblingOf(element);
    },
    appendChild(child: MockNode) {
      detach(child);
      element.childNodes.push(child);
      child.parentNode = element;
      return child;
    },
    insertBefore(newNode: MockNode, reference: MockNode | null) {
      detach(newNode);
      const index = reference ? element.childNodes.indexOf(reference) : -1;
      if (index >= 0) element.childNodes.splice(index, 0, newNode);
      else element.childNodes.push(newNode);
      newNode.parentNode = element;
      return newNode;
    },
    removeChild(child: MockNode) {
      detach(child);
      return child;
    },
    querySelectorAll(selector: string) {
      const results: MockNode[] = [];
      const walk = (node: MockNode) => {
        for (const child of node.childNodes) {
          if (child.nodeType !== 1) continue;
          if (matchesClassSelector(child, selector)) results.push(child);
          walk(child);
        }
      };
      walk(element);
      return results;
    },
  };
  return element;
}

function createDocument(): MockNode {
  const doc: MockNode = {
    createElement: (tag: string) => createElement(doc, tag),
    createTextNode: (text: string) => createTextNode(doc, text),
  };
  return doc;
}

type ChipOptions = { page: string; endPage?: string; source?: string };

function createChip(doc: MockNode, options: ChipOptions): MockNode {
  const chip = doc.createElement("span");
  chip.setAttribute("class", "llm-page-anchor");
  chip.setAttribute("role", "button");
  chip.setAttribute("tabindex", "0");
  chip.setAttribute("data-page-anchor", "1");
  chip.setAttribute("data-anchor-page", options.page);
  if (options.endPage)
    chip.setAttribute("data-anchor-page-end", options.endPage);
  if (options.source) chip.setAttribute("data-anchor-source", options.source);
  chip.setAttribute("title", `p.${options.page}`);
  chip.appendChild(doc.createTextNode(`p.${options.page}`));
  return chip;
}

/** Build `<p>` from a list of strings (text) and nodes. */
function buildParagraph(doc: MockNode, parts: (string | MockNode)[]): MockNode {
  const paragraph = doc.createElement("p");
  for (const part of parts) {
    paragraph.appendChild(
      typeof part === "string" ? doc.createTextNode(part) : part,
    );
  }
  return paragraph;
}

function sentenceWrappers(root: MockNode): MockNode[] {
  return root.querySelectorAll(".llm-page-anchor-sentence");
}

function remainingChips(root: MockNode): MockNode[] {
  return root
    .querySelectorAll(".llm-page-anchor")
    .filter(
      (node: MockNode) => !node.classList.contains("llm-page-anchor-sentence"),
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pageAnchorSentences", function () {
  describe("scanSentenceStartInText", function () {
    it("keeps the terminator that closes the annotated sentence", function () {
      const text = "第一句话。第二句流程。";
      const result = scanSentenceStartInText(text, true);
      assert.isNumber(result.startOffset);
      assert.equal(text.slice(result.startOffset as number), "第二句流程。");
      assert.isFalse(result.atTail);
    });

    it("splits English sentences on a period followed by a space", function () {
      const text = "First claim. The model reports a gain.";
      const result = scanSentenceStartInText(text, true);
      assert.equal(
        text.slice(result.startOffset as number),
        "The model reports a gain.",
      );
    });

    it("does not treat a decimal point as a sentence end", function () {
      const text = "Accuracy improved by 3.5 points.";
      assert.isNull(scanSentenceStartInText(text, true).startOffset);
    });

    it("skips a run of trailing terminators and whitespace", function () {
      const text = "Really? Is this right?!  ";
      const result = scanSentenceStartInText(text, true);
      assert.equal(
        text.slice(result.startOffset as number),
        "Is this right?!  ",
      );
    });

    it("returns no boundary when the text holds a single sentence", function () {
      const result = scanSentenceStartInText("only one sentence here.", true);
      assert.isNull(result.startOffset);
      assert.isFalse(result.atTail);
    });

    it("keeps the tail state across a whitespace-and-terminator-only node", function () {
      const consumed = scanSentenceStartInText("。", true);
      assert.isNull(consumed.startOffset);
      assert.isFalse(consumed.atTail);

      const untouched = scanSentenceStartInText("   ", true);
      assert.isNull(untouched.startOffset);
      assert.isTrue(untouched.atTail);
    });

    it("finds a trailing boundary once the tail is over", function () {
      const text = "第一句。";
      const result = scanSentenceStartInText(text, false);
      assert.equal(result.startOffset, text.length);
    });

    it("trims whitespace after the boundary", function () {
      const text = "Done.   Second one here.";
      const result = scanSentenceStartInText(text, true);
      assert.equal(
        text.slice(result.startOffset as number),
        "Second one here.",
      );
    });

    it("handles semicolons and full-width punctuation", function () {
      const semi = "one thing; another thing.";
      assert.equal(
        semi.slice(scanSentenceStartInText(semi, true).startOffset as number),
        "another thing.",
      );
      const full = "第一句！第二句？";
      assert.equal(
        full.slice(scanSentenceStartInText(full, true).startOffset as number),
        "第二句？",
      );
    });

    it("tolerates empty input", function () {
      const result = scanSentenceStartInText("", true);
      assert.isNull(result.startOffset);
      assert.isTrue(result.atTail);
    });
  });

  describe("upgradePageAnchorSentences", function () {
    let previousZotero: unknown;

    before(function () {
      previousZotero = (globalThis as any).Zotero;
      (globalThis as any).Zotero = {
        locale: "en-US",
        Prefs: {
          get(key: string) {
            return key.endsWith(".uiLanguage") ? "en-US" : "";
          },
        },
      };
    });

    after(function () {
      (globalThis as any).Zotero = previousZotero;
    });

    it("wraps the cited sentence and drops the chip", function () {
      const doc = createDocument();
      const root = doc.createElement("div");
      const paragraph = buildParagraph(doc, [
        "第一句话。第二句流程。",
        createChip(doc, { page: "5" }),
      ]);
      root.appendChild(paragraph);

      upgradePageAnchorSentences(root);

      const wrappers = sentenceWrappers(root);
      assert.lengthOf(wrappers, 1);
      assert.equal(wrappers[0].textContent, "第二句流程。");
      assert.lengthOf(remainingChips(root), 0);
      assert.equal(paragraph.textContent, "第一句话。第二句流程。");
      assert.equal(wrappers[0].getAttribute("data-anchor-page"), "5");
      assert.equal(wrappers[0].getAttribute("data-page-anchor"), "1");
      assert.equal(wrappers[0].getAttribute("role"), "button");
      assert.equal(wrappers[0].getAttribute("tabindex"), "0");
      assert.equal(wrappers[0].getAttribute("title"), "Jump to page 5");
      assert.equal(wrappers[0].getAttribute("aria-label"), "Jump to page 5");
    });

    it("labels a page range and a supplemental source", function () {
      const doc = createDocument();
      const root = doc.createElement("div");
      root.appendChild(
        buildParagraph(doc, [
          "Evidence spans two pages.",
          createChip(doc, { page: "5", endPage: "6", source: "S2" }),
        ]),
      );

      upgradePageAnchorSentences(root);

      const wrapper = sentenceWrappers(root)[0];
      assert.equal(wrapper.getAttribute("title"), "S2 · Jump to pages 5-6");
      assert.equal(wrapper.getAttribute("data-anchor-page-end"), "6");
      assert.equal(wrapper.getAttribute("data-anchor-source"), "S2");
    });

    it("is idempotent across repeated passes", function () {
      const doc = createDocument();
      const root = doc.createElement("div");
      root.appendChild(
        buildParagraph(doc, [
          "First. Second one. ",
          createChip(doc, { page: "3" }),
        ]),
      );

      upgradePageAnchorSentences(root);
      const firstText = root.textContent;
      const firstWrapperText = sentenceWrappers(root)[0].textContent;

      upgradePageAnchorSentences(root);
      upgradePageAnchorSentences(root);

      assert.lengthOf(sentenceWrappers(root), 1);
      assert.equal(root.textContent, firstText);
      assert.equal(sentenceWrappers(root)[0].textContent, firstWrapperText);
    });

    it("leaves the trailing space before the chip outside the link", function () {
      const doc = createDocument();
      const root = doc.createElement("div");
      root.appendChild(
        buildParagraph(doc, [
          "First. Second one. ",
          createChip(doc, { page: "3" }),
          " tail",
        ]),
      );

      upgradePageAnchorSentences(root);

      assert.equal(sentenceWrappers(root)[0].textContent, "Second one.");
      assert.equal(root.textContent, "First. Second one.  tail");
    });

    it("keeps the chip when no sentence text precedes it", function () {
      const doc = createDocument();
      const root = doc.createElement("div");
      root.appendChild(buildParagraph(doc, [createChip(doc, { page: "7" })]));

      upgradePageAnchorSentences(root);

      assert.lengthOf(sentenceWrappers(root), 0);
      assert.lengthOf(remainingChips(root), 1);
    });

    it("keeps the chip when only whitespace precedes it", function () {
      const doc = createDocument();
      const root = doc.createElement("div");
      root.appendChild(
        buildParagraph(doc, ["   ", createChip(doc, { page: "7" })]),
      );

      upgradePageAnchorSentences(root);

      assert.lengthOf(sentenceWrappers(root), 0);
      assert.lengthOf(remainingChips(root), 1);
    });

    it("keeps the chip when its anchor data is unusable", function () {
      const doc = createDocument();
      const root = doc.createElement("div");
      const chip = createChip(doc, { page: "5" });
      chip.setAttribute("data-anchor-page", "0");
      root.appendChild(buildParagraph(doc, ["A sentence.", chip]));

      upgradePageAnchorSentences(root);

      assert.lengthOf(sentenceWrappers(root), 0);
      assert.lengthOf(remainingChips(root), 1);
    });

    it("stops at a line break instead of crossing it", function () {
      const doc = createDocument();
      const root = doc.createElement("div");
      root.appendChild(
        buildParagraph(doc, [
          "Previous line",
          doc.createElement("br"),
          "Same line claim",
          createChip(doc, { page: "9" }),
        ]),
      );

      upgradePageAnchorSentences(root);

      assert.equal(sentenceWrappers(root)[0].textContent, "Same line claim");
    });

    it("stops at a link so jump links never nest", function () {
      const doc = createDocument();
      const root = doc.createElement("div");
      const link = doc.createElement("a");
      link.appendChild(doc.createTextNode("source"));
      root.appendChild(
        buildParagraph(doc, [
          "See ",
          link,
          " for the derivation",
          createChip(doc, { page: "4" }),
        ]),
      );

      upgradePageAnchorSentences(root);

      assert.equal(
        sentenceWrappers(root)[0].textContent,
        " for the derivation",
      );
      assert.equal(root.textContent, "See source for the derivation");
    });

    it("gives each anchor of a paragraph its own segment", function () {
      const doc = createDocument();
      const root = doc.createElement("div");
      root.appendChild(
        buildParagraph(doc, [
          "First claim.",
          createChip(doc, { page: "1" }),
          "Second claim.",
          createChip(doc, { page: "2" }),
        ]),
      );

      upgradePageAnchorSentences(root);

      const wrappers = sentenceWrappers(root);
      assert.lengthOf(wrappers, 2);
      assert.equal(wrappers[0].textContent, "First claim.");
      assert.equal(wrappers[1].textContent, "Second claim.");
      assert.equal(wrappers[0].getAttribute("data-anchor-page"), "1");
      assert.equal(wrappers[1].getAttribute("data-anchor-page"), "2");
    });

    it("keeps inline markup such as code inside the sentence link", function () {
      const doc = createDocument();
      const root = doc.createElement("div");
      const code = doc.createElement("code");
      code.appendChild(doc.createTextNode("relu"));
      root.appendChild(
        buildParagraph(doc, [
          "Prior sentence. The net uses ",
          code,
          " everywhere.",
          createChip(doc, { page: "8" }),
        ]),
      );

      upgradePageAnchorSentences(root);

      const wrapper = sentenceWrappers(root)[0];
      assert.equal(wrapper.textContent, "The net uses relu everywhere.");
      assert.equal(wrapper.childNodes.length, 3);
    });

    it("localizes the tooltip in Chinese", function () {
      const previous = (globalThis as any).Zotero;
      (globalThis as any).Zotero = {
        locale: "zh-CN",
        Prefs: {
          get(key: string) {
            return key.endsWith(".uiLanguage") ? "zh-CN" : "";
          },
        },
      };
      try {
        const doc = createDocument();
        const root = doc.createElement("div");
        root.appendChild(
          buildParagraph(doc, ["一句结论。", createChip(doc, { page: "12" })]),
        );
        upgradePageAnchorSentences(root);
        assert.equal(
          sentenceWrappers(root)[0].getAttribute("title"),
          "跳转到第 12 页",
        );
      } finally {
        (globalThis as any).Zotero = previous;
      }
    });

    it("ignores a null root and a root without anchors", function () {
      assert.doesNotThrow(() => upgradePageAnchorSentences(null));
      const doc = createDocument();
      const root = doc.createElement("div");
      root.appendChild(buildParagraph(doc, ["No citations here."]));
      assert.doesNotThrow(() => upgradePageAnchorSentences(root));
      assert.equal(root.textContent, "No citations here.");
    });
  });
});
