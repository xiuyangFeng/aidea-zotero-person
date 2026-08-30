import { assert } from "chai";

import {
  buildOpenPdfUrl,
  buildPageAnchorInstruction,
  extractSupplementalAnchorIds,
  formatPageAnchorLabel,
  formatSupplementalAnchorId,
  formatSupplementalAnchorIdLine,
  hasPageMarkers,
  injectPageMarkers,
  isPageAnchorsEnabled,
  normalizePageAnchor,
  parsePageAnchor,
  parseSupplementalAnchorPosition,
  splitPdfTextIntoPages,
  withSupplementalAnchorId,
} from "../src/utils/pageAnchors";
import { renderMarkdown, renderMarkdownForNote } from "../src/utils/markdown";

const originalZotero = (globalThis as Record<string, unknown>).Zotero;

describe("page anchors", function () {
  describe("injectPageMarkers", function () {
    it("prefixes every form-feed separated page with its physical number", function () {
      const marked = injectPageMarkers("alpha\n\n\fbeta\n\n\fgamma\n\n");
      assert.equal(
        marked,
        "[page 1]\nalpha\n\n[page 2]\nbeta\n\n[page 3]\ngamma",
      );
    });

    it("keeps physical numbering when a page has no extractable text", function () {
      const marked = injectPageMarkers("alpha\n\n\f   \n\n\fgamma");
      assert.equal(marked, "[page 1]\nalpha\n\n[page 3]\ngamma");
    });

    it("marks a single-page document when the page count confirms it", function () {
      assert.equal(
        injectPageMarkers("only page", { pageCount: 1 }),
        "[page 1]\nonly page",
      );
    });

    it("leaves text untouched when page boundaries are unknown", function () {
      // No form feed with a multi-page count means the separator was lost;
      // marking everything as page 1 would misattribute every citation.
      const text = "alpha\n\nbeta";
      assert.equal(injectPageMarkers(text, { pageCount: 7 }), text);
      assert.equal(injectPageMarkers(text), text);
    });

    it("returns blank input unchanged", function () {
      assert.equal(injectPageMarkers(""), "");
      assert.equal(injectPageMarkers("   "), "   ");
    });

    it("splits pages without dropping empty ones", function () {
      assert.deepEqual(splitPdfTextIntoPages("a\f\fb"), ["a", "", "b"]);
      assert.deepEqual(splitPdfTextIntoPages(""), []);
    });
  });

  describe("hasPageMarkers", function () {
    it("detects injected markers", function () {
      assert.isTrue(hasPageMarkers("Paper Text:\n[page 4]\nresults"));
      assert.isTrue(hasPageMarkers("[PAGE 12]"));
    });

    it("ignores unrelated bracketed text", function () {
      assert.isFalse(hasPageMarkers("[pages 4]"));
      assert.isFalse(hasPageMarkers("see page 4"));
      assert.isFalse(hasPageMarkers(""));
    });
  });

  describe("supplemental anchor ids", function () {
    it("formats one-based tokens from a zero-based index", function () {
      assert.equal(formatSupplementalAnchorId(0), "S1");
      assert.equal(formatSupplementalAnchorId(4), "S5");
      assert.equal(formatSupplementalAnchorIdLine(1), "Anchor ID: S2");
    });

    it("parses tokens back to their one-based position", function () {
      assert.equal(parseSupplementalAnchorPosition("S2"), 2);
      assert.equal(parseSupplementalAnchorPosition("s10"), 10);
      assert.isNull(parseSupplementalAnchorPosition("S0"));
      assert.isNull(parseSupplementalAnchorPosition("P2"));
      assert.isNull(parseSupplementalAnchorPosition(undefined));
    });

    it("declares the token under a marked block's label line", function () {
      const block = "Supplemental Paper 2\nTitle: Attention\n\n[page 3]\ntext";
      assert.equal(
        withSupplementalAnchorId(block, 0),
        "Supplemental Paper 2\nAnchor ID: S1\nTitle: Attention\n\n[page 3]\ntext",
      );
    });

    it("leaves blocks without page markers untouched", function () {
      const block = "Supplemental Paper 1\nTitle: Metadata only";
      assert.equal(withSupplementalAnchorId(block, 0), block);
      assert.equal(withSupplementalAnchorId("", 0), "");
    });

    it("collects declared ids from a context block", function () {
      const block = [
        "Supplemental Paper 2",
        "Title: Attention",
        "Anchor ID: S2",
        "",
        "[page 3]",
        "text",
      ].join("\n");
      assert.deepEqual(extractSupplementalAnchorIds(block), ["S2"]);
      assert.deepEqual(extractSupplementalAnchorIds("no ids here"), []);
    });
  });

  describe("parsePageAnchor", function () {
    it("parses the base-document form", function () {
      assert.deepEqual(parsePageAnchor("[p.12]"), { page: 12 });
      assert.deepEqual(parsePageAnchor("[p. 12]"), { page: 12 });
    });

    it("parses supplemental and range forms", function () {
      assert.deepEqual(parsePageAnchor("[S2 p.12]"), {
        sourceId: "S2",
        page: 12,
      });
      assert.deepEqual(parsePageAnchor("[S2, p.12]"), {
        sourceId: "S2",
        page: 12,
      });
      assert.deepEqual(parsePageAnchor("[pp.12-14]"), {
        page: 12,
        endPage: 14,
      });
      assert.deepEqual(parsePageAnchor("[pp.12–14]"), {
        page: 12,
        endPage: 14,
      });
    });

    it("rejects tokens that are not page anchors", function () {
      assert.isNull(parsePageAnchor("[p.0]"));
      assert.isNull(parsePageAnchor("[q.12]"));
      assert.isNull(parsePageAnchor("[S1234 p.12]"));
      assert.isNull(parsePageAnchor("p.12"));
      assert.isNull(parsePageAnchor(""));
    });

    it("drops a range that does not move forward", function () {
      assert.deepEqual(normalizePageAnchor({ page: "9", endPage: "9" }), {
        page: 9,
      });
      assert.deepEqual(normalizePageAnchor({ page: "9", endPage: "4" }), {
        page: 9,
      });
    });
  });

  describe("formatPageAnchorLabel", function () {
    it("renders compact labels", function () {
      assert.equal(formatPageAnchorLabel({ page: 12 }), "p.12");
      assert.equal(
        formatPageAnchorLabel({ page: 12, endPage: 14 }),
        "pp.12-14",
      );
      assert.equal(
        formatPageAnchorLabel({ sourceId: "S3", page: 7 }),
        "S3 p.7",
      );
    });
  });

  describe("buildOpenPdfUrl", function () {
    it("builds user-library and group URLs", function () {
      assert.equal(
        buildOpenPdfUrl({ itemKey: "ABCD1234", page: 12 }),
        "zotero://open-pdf/library/items/ABCD1234?page=12",
      );
      assert.equal(
        buildOpenPdfUrl({ itemKey: "ABCD1234", page: 3, groupID: 55 }),
        "zotero://open-pdf/groups/55/items/ABCD1234?page=3",
      );
    });

    it("refuses unusable keys and pages", function () {
      assert.isNull(buildOpenPdfUrl({ itemKey: "", page: 1 }));
      assert.isNull(buildOpenPdfUrl({ itemKey: "AB CD", page: 1 }));
      assert.isNull(buildOpenPdfUrl({ itemKey: "ABCD1234", page: 0 }));
    });
  });

  describe("buildPageAnchorInstruction", function () {
    it("stays empty when no source carries page markers", function () {
      assert.equal(buildPageAnchorInstruction({ hasBaseDocument: false }), "");
      assert.equal(
        buildPageAnchorInstruction({
          hasBaseDocument: false,
          supplementalAnchorIds: [],
        }),
        "",
      );
    });

    it("asks for [p.N] citations for a single document", function () {
      const instruction = buildPageAnchorInstruction({ hasBaseDocument: true });
      assert.include(instruction, "[page N]");
      assert.include(instruction, "[p.N]");
      assert.notInclude(instruction, "Anchor ID");
    });

    it("names the available supplemental anchor ids", function () {
      const instruction = buildPageAnchorInstruction({
        hasBaseDocument: true,
        supplementalAnchorIds: ["S1", "S2"],
      });
      assert.include(instruction, "Anchor ID");
      assert.include(instruction, "[S1 p.N]");
      assert.include(instruction, "S1, S2");
    });
  });

  describe("isPageAnchorsEnabled", function () {
    afterEach(function () {
      if (originalZotero === undefined) {
        delete (globalThis as Record<string, unknown>).Zotero;
      } else {
        (globalThis as Record<string, unknown>).Zotero = originalZotero;
      }
    });

    it("defaults to enabled without a Zotero runtime", function () {
      delete (globalThis as Record<string, unknown>).Zotero;
      assert.isTrue(isPageAnchorsEnabled());
    });

    it("reads boolean and string preference values", function () {
      let stored: unknown = false;
      (globalThis as Record<string, unknown>).Zotero = {
        Prefs: { get: () => stored },
      };
      assert.isFalse(isPageAnchorsEnabled());
      stored = "false";
      assert.isFalse(isPageAnchorsEnabled());
      stored = "";
      assert.isTrue(isPageAnchorsEnabled());
      stored = true;
      assert.isTrue(isPageAnchorsEnabled());
    });
  });

  describe("markdown rendering", function () {
    it("renders a chat chip carrying the jump target data", function () {
      const html = renderMarkdown("The model converges [p.12].");
      assert.include(html, 'class="llm-page-anchor"');
      assert.include(html, 'data-anchor-page="12"');
      assert.include(html, ">p.12<");
      assert.notInclude(html, "[p.12]");
    });

    it("keeps the supplemental source and range on the chip", function () {
      const html = renderMarkdown("Both agree [S2 pp.4-6].");
      assert.include(html, 'data-anchor-source="S2"');
      assert.include(html, 'data-anchor-page="4"');
      assert.include(html, 'data-anchor-page-end="6"');
      assert.include(html, ">S2 pp.4-6<");
    });

    it("leaves malformed anchors as plain text", function () {
      const html = renderMarkdown("Not an anchor [p.0] here.");
      assert.notInclude(html, "llm-page-anchor");
      assert.include(html, "[p.0]");
    });

    it("does not swallow markdown links or inline code", function () {
      const link = renderMarkdown("See [p.12](https://example.com).");
      assert.notInclude(link, "llm-page-anchor");
      assert.include(link, '<a href="https://example.com"');

      const code = renderMarkdown("Write `[p.12]` to cite a page.");
      assert.notInclude(code, "llm-page-anchor");
      assert.include(code, "<code>[p.12]</code>");
    });

    it("renders note links through the supplied resolver", function () {
      const html = renderMarkdownForNote("Converges [p.12].", {
        pageAnchorResolver: (anchor) =>
          `zotero://open-pdf/library/items/KEY1?page=${anchor.page}`,
      });
      assert.include(
        html,
        '<a href="zotero://open-pdf/library/items/KEY1?page=12">p.12</a>',
      );
    });

    it("degrades to plain text when a note anchor cannot be resolved", function () {
      const withoutResolver = renderMarkdownForNote("Converges [p.12].");
      assert.include(withoutResolver, "[p.12]");
      assert.notInclude(withoutResolver, "<a href");

      const unresolved = renderMarkdownForNote("Converges [S9 p.12].", {
        pageAnchorResolver: () => null,
      });
      assert.include(unresolved, "[S9 p.12]");
      assert.notInclude(unresolved, "<a href");
    });

    it("never lets a throwing resolver break the render", function () {
      const html = renderMarkdownForNote("Converges [p.12].", {
        pageAnchorResolver: () => {
          throw new Error("resolver exploded");
        },
      });
      assert.include(html, "[p.12]");
    });

    it("does not leak note mode into the next chat render", function () {
      renderMarkdownForNote("Converges [p.12].", {
        pageAnchorResolver: () => "zotero://open-pdf/library/items/KEY1?page=1",
      });
      const html = renderMarkdown("Converges [p.12].");
      assert.include(html, 'class="llm-page-anchor"');
      assert.notInclude(html, "<a href");
    });
  });
});
