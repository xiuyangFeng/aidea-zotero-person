import { assert } from "chai";

import {
  CITATION_MARKER_MAX_ENTRIES,
  CITATION_RANGE_MAX_SPAN,
  buildCitationInsightPrompt,
  buildLibraryTitleQueries,
  extractCitationMarkers,
  extractReferenceEntries,
  extractReferencesSection,
  findReferenceForMarker,
  guessReferenceTitle,
  resolveCitationInsightLang,
  resolveCitationReferences,
  scoreTitleMatch,
  type CitationMarker,
} from "../src/utils/citationInsight";

function raws(markers: CitationMarker[]): string[] {
  return markers.map((marker) => marker.raw);
}

function numbers(markers: CitationMarker[]): (number | null)[] {
  return markers.map((marker) => marker.number);
}

/** One located marker and one that the reference list does not carry. */
function promptResolutions() {
  return resolveCitationReferences(
    extractCitationMarkers("Our method extends [12], unlike [99]."),
    NUMBERED_DOCUMENT,
  );
}

/** A numbered-bibliography paper, as PDF extraction hands it back. */
const NUMBERED_DOCUMENT = [
  "[page 1]",
  "Introduction",
  "Our method extends [12], unlike [11].",
  "",
  "[page 9]",
  "References",
  "",
  "[11] A. Other, “Something else entirely,” in Proc. ICML, 2019, pp. 1-9.",
  "",
  "[12] J. Doe and R. Roe, “Deep learning for citation analysis,”",
  "in Proc. NeurIPS, 2024, pp. 1-10.",
  "",
  "[13] B. Third. Another work on graph neural networks. JMLR, 2021.",
  "",
  "Appendix A",
  "Extra material that is certainly not a reference entry.",
].join("\n");

/** An author-year bibliography with no numbers and no blank lines. */
const AUTHOR_YEAR_DOCUMENT = [
  "We follow (Smith et al., 2024) throughout.",
  "",
  "References",
  "",
  "Lee, K. (2020). Small models, big claims. Journal of Nothing, 3(1), 1-9.",
  "Smith, A., Jones, B., & Wu, C. (2024). Deep learning for citation",
  "analysis at scale. Journal of Foo, 12(3), 45-67.",
  "Zhang, Q. (2018). An unrelated survey. Surveys Quarterly, 1(1), 1-40.",
].join("\n");

describe("citation insight", function () {
  describe("marker extraction", function () {
    it("reads the plain, list, and range forms of a numeric marker", function () {
      assert.deepEqual(raws(extractCitationMarkers("as shown in [12].")), [
        "[12]",
      ]);
      assert.deepEqual(raws(extractCitationMarkers("see [12, 15] for this.")), [
        "[12]",
        "[15]",
      ]);
      assert.deepEqual(
        numbers(extractCitationMarkers("see [12-15].")),
        [12, 13, 14, 15],
      );
    });

    it("expands a range written with an en dash or across two brackets", function () {
      assert.deepEqual(
        numbers(extractCitationMarkers("see [7–10].")),
        [7, 8, 9, 10],
      );
      assert.deepEqual(
        numbers(extractCitationMarkers("see [7]–[10].")),
        [7, 8, 9, 10],
      );
    });

    it("bounds a range expansion instead of flooding on [1-500]", function () {
      const markers = extractCitationMarkers("see [1-500].");
      assert.lengthOf(markers, CITATION_RANGE_MAX_SPAN);
      assert.strictEqual(markers[0].number, 1);
      assert.strictEqual(
        markers[markers.length - 1].number,
        CITATION_RANGE_MAX_SPAN,
      );
    });

    it("caps the markers one selection may contribute", function () {
      const selection = Array.from(
        { length: 80 },
        (_value, index) => `[${index + 1}]`,
      ).join(" ");
      assert.lengthOf(
        extractCitationMarkers(selection),
        CITATION_MARKER_MAX_ENTRIES,
      );
    });

    it("collapses a work cited twice in one passage to one marker", function () {
      assert.deepEqual(raws(extractCitationMarkers("[12] and again [12].")), [
        "[12]",
      ]);
    });

    it("reads author-year markers and splits a multi-work parenthesis", function () {
      const markers = extractCitationMarkers(
        "prior work (Smith et al., 2024), and also (Smith & Jones, 2023; Lee, 2020).",
      );
      assert.deepEqual(raws(markers), [
        "(Smith et al., 2024)",
        "(Smith & Jones, 2023)",
        "(Lee, 2020)",
      ]);
      assert.deepEqual(
        markers.map((marker) => [marker.author, marker.year]),
        [
          ["Smith", "2024"],
          ["Smith", "2023"],
          ["Lee", "2020"],
        ],
      );
      assert.deepEqual(
        markers.map((marker) => marker.kind),
        ["author-year", "author-year", "author-year"],
      );
    });

    it("drops the signal word in front of an author-year citation", function () {
      const markers = extractCitationMarkers("see also (e.g., Müller, 2019)");
      assert.lengthOf(markers, 1);
      assert.strictEqual(markers[0].author, "Müller");
      assert.strictEqual(markers[0].year, "2019");
    });

    it("reads the narrative form whose parenthesis holds only a year", function () {
      const markers = extractCitationMarkers("Kim et al. (2021) disagreed.");
      assert.lengthOf(markers, 1);
      assert.strictEqual(markers[0].author, "Kim");
      assert.strictEqual(markers[0].year, "2021");
      assert.strictEqual(markers[0].raw, "Kim et al. (2021)");
    });

    it("reads both styles when a passage carries them together", function () {
      assert.deepEqual(
        raws(
          extractCitationMarkers("Both [7] and (Smith et al., 2024) apply."),
        ),
        ["[7]", "(Smith et al., 2024)"],
      );
    });

    it("returns nothing for malformed or marker-less input", function () {
      assert.deepEqual(extractCitationMarkers(null), []);
      assert.deepEqual(extractCitationMarkers(undefined), []);
      assert.deepEqual(extractCitationMarkers(42), []);
      assert.deepEqual(extractCitationMarkers(""), []);
      assert.deepEqual(extractCitationMarkers("   "), []);
      assert.deepEqual(extractCitationMarkers("no citation here at all"), []);
      assert.deepEqual(extractCitationMarkers("[] and [ ] and [abc]"), []);
      assert.deepEqual(
        extractCitationMarkers("unclosed [12 and (Smith 2024"),
        [],
      );
    });

    it("passes over page markers and bracketed notes", function () {
      assert.deepEqual(
        extractCitationMarkers("[page 3] the text [p.12] continues [sic]"),
        [],
      );
    });

    it("passes over a bracketed number too large to be a citation", function () {
      assert.deepEqual(extractCitationMarkers("the year [2024] was busy"), []);
    });
  });

  describe("reference section location", function () {
    it("cuts the section at the heading and stops at the appendix", function () {
      const section = extractReferencesSection(NUMBERED_DOCUMENT);
      assert.include(section, "[11] A. Other");
      assert.include(section, "[13] B. Third");
      assert.notInclude(section, "Appendix A");
      assert.notInclude(section, "Introduction");
    });

    it("accepts the heading spellings a paper may use", function () {
      for (const heading of [
        "References",
        "REFERENCES",
        "Bibliography",
        "7. References",
        "参考文献",
        "Works Cited",
      ]) {
        const section = extractReferencesSection(
          [
            "Body text.",
            heading,
            "[1] A. One, “A readable title here,” Journal, 2020, pp. 1-9.",
            "[2] B. Two, “Another readable title,” Journal, 2021, pp. 1-9.",
          ].join("\n"),
        );
        assert.include(
          section,
          "[1] A. One",
          `heading not matched: ${heading}`,
        );
      }
    });

    it("prefers the real list over a table-of-contents entry", function () {
      const section = extractReferencesSection(
        [
          "Contents",
          "References",
          "",
          "1. Introduction",
          "Body text of the paper goes here.",
          "",
          "References",
          "",
          "[1] A. One, “A readable title here,” Journal, 2020, pp. 1-9.",
          "[2] B. Two, “Another readable title,” Journal, 2021, pp. 1-9.",
        ].join("\n"),
      );
      assert.include(section, "[1] A. One");
      assert.notInclude(section, "Body text of the paper");
    });

    it("returns nothing when the document carries no reference list", function () {
      assert.strictEqual(extractReferencesSection("Just body text."), "");
      assert.strictEqual(extractReferencesSection(null), "");
      assert.deepEqual(extractReferenceEntries("Just body text."), []);
      assert.deepEqual(extractReferenceEntries(null), []);
    });
  });

  describe("reference entry splitting", function () {
    it("cuts numbered entries and rejoins one that wraps across lines", function () {
      const entries = extractReferenceEntries(NUMBERED_DOCUMENT);
      assert.deepEqual(
        entries.map((entry) => entry.number),
        [11, 12, 13],
      );
      assert.strictEqual(
        entries[1].text,
        "J. Doe and R. Roe, “Deep learning for citation analysis,” in Proc. NeurIPS, 2024, pp. 1-10.",
      );
    });

    it("carries the page a marker before the heading declared", function () {
      const entries = extractReferenceEntries(NUMBERED_DOCUMENT);
      assert.deepEqual(
        entries.map((entry) => entry.page),
        [9, 9, 9],
      );
    });

    it("cuts an unnumbered bibliography on its author openings", function () {
      const entries = extractReferenceEntries(AUTHOR_YEAR_DOCUMENT);
      assert.lengthOf(entries, 3);
      assert.deepEqual(
        entries.map((entry) => entry.number),
        [null, null, null],
      );
      assert.strictEqual(
        entries[1].text,
        "Smith, A., Jones, B., & Wu, C. (2024). Deep learning for citation analysis at scale. Journal of Foo, 12(3), 45-67.",
      );
    });

    it("accepts the `12.` entry head as well as `[12]`", function () {
      const entries = extractReferenceEntries(
        [
          "References",
          "1. A. One, “A readable title here,” Journal, 2020, pp. 1-9.",
          "2. B. Two, “Another readable title,” Journal, 2021, pp. 1-9.",
        ].join("\n"),
      );
      assert.deepEqual(
        entries.map((entry) => entry.number),
        [1, 2],
      );
    });
  });

  describe("marker to entry lookup", function () {
    it("matches a numeric marker on its number", function () {
      const resolutions = resolveCitationReferences(
        extractCitationMarkers("we extend [12]."),
        NUMBERED_DOCUMENT,
      );
      assert.lengthOf(resolutions, 1);
      assert.include(
        resolutions[0].reference?.text || "",
        "Deep learning for citation analysis",
      );
    });

    it("matches an author-year marker on surname plus year", function () {
      const resolutions = resolveCitationReferences(
        extractCitationMarkers("we follow (Smith et al., 2024)."),
        AUTHOR_YEAR_DOCUMENT,
      );
      assert.lengthOf(resolutions, 1);
      assert.include(
        resolutions[0].reference?.text || "",
        "Deep learning for citation analysis at scale",
      );
    });

    it("reports an unlocated marker rather than dropping it", function () {
      const resolutions = resolveCitationReferences(
        extractCitationMarkers("we extend [12] and [99]."),
        NUMBERED_DOCUMENT,
      );
      assert.lengthOf(resolutions, 2);
      assert.isNotNull(resolutions[0].reference);
      assert.isNull(resolutions[1].reference);
    });

    it("locates nothing when the document has no reference list", function () {
      const resolutions = resolveCitationReferences(
        extractCitationMarkers("we extend [12]."),
        "Body text with no bibliography.",
      );
      assert.lengthOf(resolutions, 1);
      assert.isNull(resolutions[0].reference);
    });

    it("survives an empty marker list or an empty entry list", function () {
      assert.deepEqual(resolveCitationReferences([], NUMBERED_DOCUMENT), []);
      assert.isNull(
        findReferenceForMarker(extractCitationMarkers("[1]")[0], []),
      );
    });
  });

  describe("title guessing", function () {
    it("takes the quoted span of a numeric-style entry", function () {
      assert.strictEqual(
        guessReferenceTitle(
          'J. Doe and R. Roe, "Deep learning for citation analysis," in Proc. NeurIPS, 2024, pp. 1-10.',
        ),
        "Deep learning for citation analysis",
      );
      assert.strictEqual(
        guessReferenceTitle(
          "J. Doe, “Deep learning for citation analysis,” in Proc. NeurIPS, 2024.",
        ),
        "Deep learning for citation analysis",
      );
    });

    it("takes the segment after the year of an APA-style entry", function () {
      assert.strictEqual(
        guessReferenceTitle(
          "Smith, A., Jones, B., & Wu, C. (2024). Deep learning for citation analysis at scale. Journal of Foo, 12(3), 45-67.",
        ),
        "Deep learning for citation analysis at scale",
      );
    });

    it("does not split on the period after an author's initial", function () {
      assert.strictEqual(
        guessReferenceTitle(
          "[13] B. Third. Another work on graph neural networks. JMLR, 2021.",
        ),
        "Another work on graph neural networks",
      );
    });

    it("returns nothing when there is no title to find", function () {
      assert.strictEqual(guessReferenceTitle("12. 1-9."), "");
      assert.strictEqual(guessReferenceTitle(null), "");
      assert.strictEqual(guessReferenceTitle(""), "");
      assert.strictEqual(guessReferenceTitle(7), "");
    });
  });

  describe("library queries", function () {
    it("issues the full guess, then a trimmed opening for a long title", function () {
      assert.deepEqual(
        buildLibraryTitleQueries(
          "Deep learning for citation analysis at scale in very large corpora",
        ),
        [
          "Deep learning for citation analysis at scale in very large corpora",
          "Deep learning for citation analysis at scale",
        ],
      );
    });

    it("issues one query for a title short enough not to need trimming", function () {
      assert.deepEqual(buildLibraryTitleQueries("A readable title here"), [
        "A readable title here",
      ]);
    });

    it("issues nothing for a guess too short to search on", function () {
      assert.deepEqual(buildLibraryTitleQueries("tiny"), []);
      assert.deepEqual(buildLibraryTitleQueries(null), []);
    });

    it("scores a candidate by how much of the guess it covers", function () {
      assert.strictEqual(
        scoreTitleMatch(
          "Deep Learning for Citation Analysis at Scale",
          "Deep learning for citation analysis at scale",
        ),
        1,
      );
      assert.strictEqual(
        scoreTitleMatch("Something entirely unrelated", "Deep learning here"),
        0,
      );
      assert.strictEqual(scoreTitleMatch("anything", ""), 0);
      assert.strictEqual(scoreTitleMatch("", "anything at all"), 0);
    });
  });

  describe("prompt", function () {
    it("quotes the passage, the entries, and the unlocated marker", function () {
      const resolutions = promptResolutions();
      const prompt = buildCitationInsightPrompt({
        selection: "Our method extends [12], unlike [99].",
        resolutions,
        lang: "en-US",
        pageCitations: true,
      });
      assert.include(prompt, "Our method extends [12], unlike [99].");
      assert.include(prompt, "1. [12]");
      assert.include(prompt, "Deep learning for citation analysis");
      assert.include(prompt, "2. [99]");
      assert.include(prompt, "not found in the reference list");
      assert.include(prompt, "printed on page 9");
      assert.include(prompt, "[p.N]");
    });

    it("drops the page rule for a document without page markers", function () {
      const prompt = buildCitationInsightPrompt({
        selection: "Our method extends [12].",
        resolutions: promptResolutions(),
        lang: "en-US",
        pageCitations: false,
      });
      assert.notInclude(prompt, "[p.N]");
      assert.include(prompt, "no page markers");
    });

    it("notes a reference the user already has in their library", function () {
      const prompt = buildCitationInsightPrompt({
        selection: "Our method extends [12].",
        resolutions: [
          {
            ...promptResolutions()[0],
            libraryTitle: "Deep Learning for Citations",
          },
        ],
        lang: "en-US",
      });
      assert.include(prompt, "Deep Learning for Citations");
      assert.include(prompt, "Zotero library");
    });

    it("writes Simplified Chinese when the panel language is Chinese", function () {
      const prompt = buildCitationInsightPrompt({
        selection: "Our method extends [12].",
        resolutions: promptResolutions(),
        lang: "zh-CN",
      });
      assert.include(prompt, "选中片段：");
      assert.include(prompt, "参考文献原文：");
      assert.notInclude(prompt, "Reference list entry");
    });

    it("resolves the copy language from the panel language code", function () {
      assert.strictEqual(resolveCitationInsightLang("zh-CN"), "zh-CN");
      assert.strictEqual(resolveCitationInsightLang("zh-TW"), "zh-CN");
      assert.strictEqual(resolveCitationInsightLang("en-US"), "en-US");
      assert.strictEqual(resolveCitationInsightLang(null), "en-US");
    });

    it("builds nothing without resolutions or without a passage", function () {
      assert.strictEqual(
        buildCitationInsightPrompt({ selection: "text", resolutions: [] }),
        "",
      );
      assert.strictEqual(
        buildCitationInsightPrompt({
          selection: "   ",
          resolutions: promptResolutions(),
        }),
        "",
      );
    });
  });
});
