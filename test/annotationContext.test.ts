import { assert } from "chai";

import {
  ANNOTATION_TEXT_MAX_CHARS,
  buildAnnotationContextBlock,
  buildModelPromptWithAnnotationContext,
  countAnnotationsByType,
  formatAnnotationEntry,
  formatAnnotationPagePrefix,
  normalizeAnnotationRecord,
  normalizeAnnotationRecords,
  resolveAnnotationPageNumber,
  sortAnnotationRecords,
  type AnnotationRecord,
  type RawAnnotationInput,
} from "../src/utils/annotationContext";

function makeRecord(
  overrides: Partial<AnnotationRecord> = {},
): AnnotationRecord {
  return {
    type: "highlight",
    text: "sample passage",
    comment: "",
    pageLabel: "",
    pageIndex: null,
    color: "#ffd400",
    sortIndex: "",
    ...overrides,
  };
}

function makeRaw(
  overrides: Partial<RawAnnotationInput> = {},
): RawAnnotationInput {
  return {
    type: "highlight",
    text: "sample passage",
    comment: "",
    pageLabel: "",
    pageIndex: null,
    color: "#ffd400",
    sortIndex: "",
    ...overrides,
  };
}

function makeBlockRecords(): AnnotationRecord[] {
  return [
    makeRecord({ text: "alpha", pageIndex: 0 }),
    makeRecord({ text: "beta", pageIndex: 4, comment: "important" }),
    makeRecord({ type: "note", text: "", comment: "gamma", pageIndex: 9 }),
  ];
}

describe("annotation context", function () {
  describe("normalizeAnnotationRecord", function () {
    it("keeps the annotation kinds that carry text", function () {
      for (const type of ["highlight", "underline", "note"]) {
        const record = normalizeAnnotationRecord(
          makeRaw({ type, text: "", comment: "a remark" }),
        );
        assert.isNotNull(record, type);
        assert.equal(record!.type, type);
      }
    });

    it("drops kinds that carry no text at all", function () {
      for (const type of ["image", "ink", "text", "", "HIGHLIGHTED"]) {
        assert.isNull(
          normalizeAnnotationRecord(makeRaw({ type, comment: "note" })),
          type,
        );
      }
    });

    it("accepts the annotation type case-insensitively", function () {
      const record = normalizeAnnotationRecord(makeRaw({ type: "Highlight" }));
      assert.equal(record?.type, "highlight");
    });

    it("drops annotations with neither a passage nor a comment", function () {
      assert.isNull(
        normalizeAnnotationRecord(makeRaw({ text: "   ", comment: "\n" })),
      );
    });

    it("keeps a sticky note that only carries a comment", function () {
      const record = normalizeAnnotationRecord(
        makeRaw({ type: "note", text: "", comment: "check this claim" }),
      );
      assert.equal(record?.text, "");
      assert.equal(record?.comment, "check this claim");
    });

    it("collapses the line breaks PDF highlights carry", function () {
      const record = normalizeAnnotationRecord(
        makeRaw({ text: "  first line\n  second\tline  " }),
      );
      assert.equal(record?.text, "first line second line");
    });

    it("clamps an oversized passage to the per-entry budget", function () {
      const record = normalizeAnnotationRecord(
        makeRaw({ text: "x".repeat(ANNOTATION_TEXT_MAX_CHARS + 200) }),
      );
      assert.lengthOf(record!.text, ANNOTATION_TEXT_MAX_CHARS);
      assert.isTrue(record!.text.endsWith("…"));
    });

    it("normalizes the page index and rejects impossible values", function () {
      assert.equal(
        normalizeAnnotationRecord(makeRaw({ pageIndex: 0 }))?.pageIndex,
        0,
      );
      assert.equal(
        normalizeAnnotationRecord(makeRaw({ pageIndex: 11 }))?.pageIndex,
        11,
      );
      assert.isNull(
        normalizeAnnotationRecord(makeRaw({ pageIndex: -3 }))?.pageIndex,
      );
      assert.isNull(
        normalizeAnnotationRecord(makeRaw({ pageIndex: "abc" }))?.pageIndex,
      );
      assert.isNull(
        normalizeAnnotationRecord(makeRaw({ pageIndex: undefined }))?.pageIndex,
      );
    });

    it("survives missing and malformed input", function () {
      assert.isNull(normalizeAnnotationRecord(null));
      assert.isNull(normalizeAnnotationRecord(undefined));
      assert.isNull(normalizeAnnotationRecord({} as RawAnnotationInput));
      const record = normalizeAnnotationRecord({
        type: "highlight",
        text: "kept",
      });
      assert.equal(record?.text, "kept");
      assert.equal(record?.comment, "");
      assert.equal(record?.pageLabel, "");
      assert.equal(record?.color, "");
    });
  });

  describe("sortAnnotationRecords", function () {
    it("orders by Zotero's fixed-width sort index", function () {
      const sorted = sortAnnotationRecords([
        makeRecord({ text: "c", sortIndex: "00012|000030|00100" }),
        makeRecord({ text: "a", sortIndex: "00002|000010|00050" }),
        makeRecord({ text: "b", sortIndex: "00002|000020|00010" }),
      ]);
      assert.deepEqual(
        sorted.map((record) => record.text),
        ["a", "b", "c"],
      );
    });

    it("falls back to the page index when a sort index is missing", function () {
      const sorted = sortAnnotationRecords([
        makeRecord({ text: "later", pageIndex: 7 }),
        makeRecord({ text: "earlier", pageIndex: 2 }),
      ]);
      assert.deepEqual(
        sorted.map((record) => record.text),
        ["earlier", "later"],
      );
    });

    it("keeps records with a sort index ahead of records without one", function () {
      const sorted = sortAnnotationRecords([
        makeRecord({ text: "unindexed", pageIndex: 0 }),
        makeRecord({ text: "indexed", sortIndex: "00099|000000|00000" }),
      ]);
      assert.deepEqual(
        sorted.map((record) => record.text),
        ["indexed", "unindexed"],
      );
    });

    it("is stable when nothing distinguishes two records", function () {
      const sorted = sortAnnotationRecords([
        makeRecord({ text: "first" }),
        makeRecord({ text: "second" }),
        makeRecord({ text: "third" }),
      ]);
      assert.deepEqual(
        sorted.map((record) => record.text),
        ["first", "second", "third"],
      );
    });
  });

  describe("normalizeAnnotationRecords", function () {
    it("filters, de-duplicates by key, and sorts in one pass", function () {
      const records = normalizeAnnotationRecords([
        makeRaw({ key: "B", text: "second", sortIndex: "00002|0|0" }),
        makeRaw({ key: "A", text: "first", sortIndex: "00001|0|0" }),
        // Same key as the first entry — Zotero can hand back duplicates when
        // an annotation is split across pages.
        makeRaw({ key: "B", text: "second again", sortIndex: "00003|0|0" }),
        makeRaw({ key: "C", type: "ink", text: "dropped" }),
        null,
      ]);
      assert.deepEqual(
        records.map((record) => record.text),
        ["first", "second"],
      );
    });

    it("returns an empty list for empty or missing input", function () {
      assert.deepEqual(normalizeAnnotationRecords([]), []);
      assert.deepEqual(
        normalizeAnnotationRecords(
          undefined as unknown as RawAnnotationInput[],
        ),
        [],
      );
    });
  });

  describe("page resolution", function () {
    it("turns a zero-based page index into a one-based page number", function () {
      assert.equal(
        resolveAnnotationPageNumber(makeRecord({ pageIndex: 0 })),
        1,
      );
      assert.equal(
        resolveAnnotationPageNumber(makeRecord({ pageIndex: 11 })),
        12,
      );
    });

    it("falls back to a purely numeric page label", function () {
      assert.equal(
        resolveAnnotationPageNumber(
          makeRecord({ pageIndex: null, pageLabel: "12" }),
        ),
        12,
      );
    });

    it("refuses to guess a number from a non-numeric label", function () {
      // EPUB and snapshot annotations often label locations by chapter or with
      // roman numerals; converting those would produce a wrong jump target.
      for (const pageLabel of ["iv", "Chapter 3", "A-12", "", "0"]) {
        assert.isNull(
          resolveAnnotationPageNumber(
            makeRecord({ pageIndex: null, pageLabel }),
          ),
          pageLabel,
        );
      }
    });

    it("prefers the page index over a disagreeing label", function () {
      assert.equal(
        resolveAnnotationPageNumber(
          makeRecord({ pageIndex: 4, pageLabel: "99" }),
        ),
        5,
      );
    });

    it("formats the prefix as a citable anchor only when a page is known", function () {
      assert.equal(
        formatAnnotationPagePrefix(makeRecord({ pageIndex: 11 })),
        "[p.12] ",
      );
      assert.equal(
        formatAnnotationPagePrefix(
          makeRecord({ pageIndex: null, pageLabel: "Chapter 3" }),
        ),
        "(at Chapter 3) ",
      );
      assert.equal(
        formatAnnotationPagePrefix(makeRecord({ pageIndex: null })),
        "",
      );
    });
  });

  describe("formatAnnotationEntry", function () {
    it("quotes the passage and names the annotation kind", function () {
      assert.equal(
        formatAnnotationEntry(
          makeRecord({ type: "underline", text: "scaling laws", pageIndex: 2 }),
          1,
        ),
        '1. [p.3] underline: "scaling laws"',
      );
    });

    it("appends the user's own remark on its own line", function () {
      assert.equal(
        formatAnnotationEntry(
          makeRecord({ text: "scaling laws", pageIndex: 2, comment: "verify" }),
          4,
        ),
        '4. [p.3] highlight: "scaling laws"\n   user note: verify',
      );
    });

    it("renders a passage-less sticky note as the comment alone", function () {
      assert.equal(
        formatAnnotationEntry(
          makeRecord({
            type: "note",
            text: "",
            comment: "my idea",
            pageIndex: 0,
          }),
          2,
        ),
        "2. [p.1] note: my idea",
      );
    });

    it("omits the citation when the annotation has no page", function () {
      assert.equal(
        formatAnnotationEntry(makeRecord({ text: "epub passage" }), 1),
        '1. highlight: "epub passage"',
      );
    });
  });

  describe("countAnnotationsByType", function () {
    it("tallies each supported kind", function () {
      const counts = countAnnotationsByType([
        makeRecord({ type: "highlight" }),
        makeRecord({ type: "highlight" }),
        makeRecord({ type: "note" }),
      ]);
      assert.deepEqual(counts, { highlight: 2, underline: 0, note: 1 });
    });

    it("returns a zeroed tally for empty input", function () {
      assert.deepEqual(countAnnotationsByType([]), {
        highlight: 0,
        underline: 0,
        note: 0,
      });
    });
  });

  describe("buildAnnotationContextBlock", function () {
    it("declares the source and the annotations in reading order", function () {
      const records = makeBlockRecords();
      const block = buildAnnotationContextBlock(records, {
        title: "Attention",
      });
      assert.equal(block.includedCount, 3);
      assert.equal(block.totalCount, 3);
      assert.isFalse(block.truncated);
      assert.include(block.text, "[USER ANNOTATIONS — Attention]");
      assert.include(block.text, "3 annotations.");
      assert.include(block.text, '1. [p.1] highlight: "alpha"');
      assert.include(block.text, '2. [p.5] highlight: "beta"');
      assert.include(block.text, "3. [p.10] note: gamma");
    });

    it("tells the model the marks are the reader's own and how to cite them", function () {
      const block = buildAnnotationContextBlock(makeBlockRecords());
      assert.include(block.text, "highlighted or annotated by the user");
      assert.include(block.text, "[p.N]");
    });

    it("omits the title from the header when there is none", function () {
      const block = buildAnnotationContextBlock(makeBlockRecords());
      assert.include(block.text, "[USER ANNOTATIONS]");
      assert.notInclude(block.text, "—");
    });

    it("uses the singular count for a lone annotation", function () {
      const block = buildAnnotationContextBlock([makeBlockRecords()[0]]);
      assert.include(block.text, "1 annotation.");
    });

    it("truncates to the entry cap and reports it", function () {
      const block = buildAnnotationContextBlock(makeBlockRecords(), {
        maxEntries: 2,
      });
      assert.equal(block.includedCount, 2);
      assert.equal(block.totalCount, 3);
      assert.isTrue(block.truncated);
      assert.include(block.text, "Showing the first 2 of 3 annotations");
      assert.notInclude(block.text, "gamma");
    });

    it("keeps the front of the document when the entry cap bites", function () {
      const many = Array.from({ length: 40 }, (_unused, index) =>
        makeRecord({ text: `passage ${index}`, pageIndex: index }),
      );
      const block = buildAnnotationContextBlock(many, { maxEntries: 3 });
      assert.include(block.text, "passage 0");
      assert.include(block.text, "passage 2");
      assert.notInclude(block.text, "passage 3");
    });

    it("truncates on the character budget as well", function () {
      const block = buildAnnotationContextBlock(makeBlockRecords(), {
        maxChars: 30,
      });
      assert.isTrue(block.truncated);
      assert.isBelow(block.includedCount, 3);
      assert.isAtLeast(block.includedCount, 1);
    });

    it("always keeps one entry even when it alone busts the budget", function () {
      const block = buildAnnotationContextBlock(
        [makeRecord({ text: "x".repeat(500), pageIndex: 0 })],
        { maxChars: 10 },
      );
      assert.equal(block.includedCount, 1);
      assert.isFalse(block.truncated);
    });

    it("ignores nonsensical limits instead of producing an empty block", function () {
      const block = buildAnnotationContextBlock(makeBlockRecords(), {
        maxEntries: 0,
        maxChars: Number.NaN,
      });
      assert.isAtLeast(block.includedCount, 1);
    });

    it("returns an empty block for no annotations", function () {
      const block = buildAnnotationContextBlock([]);
      assert.equal(block.text, "");
      assert.equal(block.includedCount, 0);
      assert.equal(block.totalCount, 0);
      assert.isFalse(block.truncated);
    });
  });

  describe("buildModelPromptWithAnnotationContext", function () {
    it("appends the block after the question", function () {
      const prompt = buildModelPromptWithAnnotationContext(
        "What did I find important?",
        [makeRecord({ text: "alpha", pageIndex: 0 })],
        { title: "Attention" },
      );
      assert.isTrue(prompt.startsWith("What did I find important?\n\n"));
      assert.include(prompt, "[USER ANNOTATIONS — Attention]");
    });

    it("returns the question untouched when there is nothing to add", function () {
      assert.equal(
        buildModelPromptWithAnnotationContext("Only the question", []),
        "Only the question",
      );
    });

    it("stands alone when the question is blank", function () {
      const prompt = buildModelPromptWithAnnotationContext("  ", [
        makeRecord({ text: "alpha", pageIndex: 0 }),
      ]);
      assert.isTrue(prompt.startsWith("[USER ANNOTATIONS]"));
    });
  });
});
