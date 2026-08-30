import { assert } from "chai";

import {
  buildWritingDraft,
  extractPublicationYear,
  formatCitationGroup,
  formatCitationLocator,
  formatCreatorReferenceName,
  formatCreatorSurname,
  formatInTextAuthors,
  formatReferenceAuthors,
  formatReferenceEntry,
  normalizeWritingCitationStylePreference,
  resolveWritingCitationStyle,
  sortWritingReferences,
  type WritingSource,
} from "../src/utils/writingExport";

const SMITH: WritingSource = {
  id: "1",
  citationKey: "smith2024",
  creators: [
    { lastName: "Smith", firstName: "Jane" },
    { lastName: "Okafor", firstName: "Ada" },
    { lastName: "Rossi", firstName: "Luca" },
  ],
  title: "Retrieval over long documents",
  date: "2024-06-01",
  publication: "Journal of Retrieval",
};

const JONES: WritingSource = {
  id: "2",
  citationKey: "jones2023",
  creators: [{ lastName: "Jones", firstName: "Bo" }],
  title: "A shorter study",
  date: "2023",
  publication: "Proceedings of Things",
};

const ZHANG: WritingSource = {
  id: "3",
  creators: [
    { lastName: "张", firstName: "伟" },
    { lastName: "李", firstName: "娜" },
    { lastName: "王", firstName: "芳" },
  ],
  title: "中文文献标题",
  date: "2022-03",
  publication: "情报学报",
};

/** Resolver over a fixed anchor → source table, mirroring the panel's. */
function resolverFor(table: Record<string, WritingSource>) {
  return (anchor: { sourceId?: string; page: number }) =>
    table[anchor.sourceId || "base"] || null;
}

const RESOLVE_FIXTURE = resolverFor({ base: SMITH, S1: JONES, S2: ZHANG });

describe("writing export", function () {
  describe("citation style preference", function () {
    it("normalizes stored values and rejects anything unknown", function () {
      assert.equal(
        normalizeWritingCitationStylePreference("citekey"),
        "citekey",
      );
      assert.equal(
        normalizeWritingCitationStylePreference(" Author-Year "),
        "author-year",
      );
      assert.equal(normalizeWritingCitationStylePreference(""), "auto");
      assert.equal(normalizeWritingCitationStylePreference(undefined), "auto");
      assert.equal(normalizeWritingCitationStylePreference("bibtex"), "auto");
    });

    it("lets auto follow Better BibTeX and obeys an explicit choice", function () {
      assert.equal(resolveWritingCitationStyle("auto", true), "citekey");
      assert.equal(resolveWritingCitationStyle("auto", false), "author-year");
      assert.equal(resolveWritingCitationStyle("citekey", false), "citekey");
      assert.equal(
        resolveWritingCitationStyle("author-year", true),
        "author-year",
      );
    });
  });

  describe("extractPublicationYear", function () {
    it("pulls a four-digit year out of Zotero date fields", function () {
      assert.equal(extractPublicationYear("2024-06-01"), "2024");
      assert.equal(extractPublicationYear("June 2024"), "2024");
      assert.equal(extractPublicationYear("2024/6/1"), "2024");
      assert.equal(extractPublicationYear("1998"), "1998");
    });

    it("returns nothing rather than guessing", function () {
      assert.equal(extractPublicationYear(""), "");
      assert.equal(extractPublicationYear("in press"), "");
      assert.equal(extractPublicationYear("42"), "");
      assert.equal(extractPublicationYear(undefined), "");
    });
  });

  describe("author formatting", function () {
    it("names a western author by surname and a Chinese one in full", function () {
      assert.equal(
        formatCreatorSurname({ lastName: "Smith", firstName: "Jane" }),
        "Smith",
      );
      assert.equal(
        formatCreatorSurname({ lastName: "张", firstName: "伟" }),
        "张伟",
      );
      assert.equal(
        formatCreatorSurname({ lastName: "Ministry of Health", fieldMode: 1 }),
        "Ministry of Health",
      );
      assert.equal(formatCreatorSurname({ firstName: "Cher" }), "Cher");
      assert.equal(formatCreatorSurname(null), "");
    });

    it("abbreviates in-text authors by count", function () {
      assert.equal(formatInTextAuthors([{ lastName: "Smith" }]), "Smith");
      assert.equal(
        formatInTextAuthors([{ lastName: "Smith" }, { lastName: "Jones" }]),
        "Smith & Jones",
      );
      assert.equal(
        formatInTextAuthors([
          { lastName: "Smith" },
          { lastName: "Jones" },
          { lastName: "Rossi" },
        ]),
        "Smith et al.",
      );
      assert.equal(formatInTextAuthors([]), "");
    });

    it("uses the Chinese abbreviation for Chinese authors", function () {
      assert.equal(
        formatInTextAuthors([{ lastName: "张", firstName: "伟" }]),
        "张伟",
      );
      assert.equal(
        formatInTextAuthors([
          { lastName: "张", firstName: "伟" },
          { lastName: "李", firstName: "娜" },
        ]),
        "张伟、李娜",
      );
      assert.equal(formatInTextAuthors(ZHANG.creators), "张伟 等");
    });

    it("initialises given names for the reference list", function () {
      assert.equal(
        formatCreatorReferenceName({ lastName: "Smith", firstName: "Jane" }),
        "Smith, J.",
      );
      assert.equal(
        formatCreatorReferenceName({
          lastName: "Tolkien",
          firstName: "John Ronald",
        }),
        "Tolkien, J. R.",
      );
      assert.equal(
        formatCreatorReferenceName({ lastName: "张", firstName: "伟" }),
        "张伟",
      );
    });

    it("joins reference authors the way their own script does", function () {
      assert.equal(formatReferenceAuthors(JONES.creators), "Jones, B.");
      assert.equal(
        formatReferenceAuthors([
          { lastName: "Smith", firstName: "Jane" },
          { lastName: "Okafor", firstName: "Ada" },
        ]),
        "Smith, J. & Okafor, A.",
      );
      assert.equal(
        formatReferenceAuthors(SMITH.creators),
        "Smith, J., Okafor, A., & Rossi, L.",
      );
      assert.equal(formatReferenceAuthors(ZHANG.creators), "张伟、李娜、王芳");
      assert.equal(formatReferenceAuthors([]), "");
    });
  });

  describe("formatCitationLocator", function () {
    it("keeps single pages and ranges apart", function () {
      assert.equal(formatCitationLocator({ page: 12 }), "p. 12");
      assert.equal(
        formatCitationLocator({ page: 12, endPage: 14 }),
        "pp. 12-14",
      );
      assert.equal(formatCitationLocator({ page: 0 }), "");
    });
  });

  describe("formatCitationGroup", function () {
    it("renders pandoc keys with locators", function () {
      assert.equal(
        formatCitationGroup(
          [
            { source: SMITH, anchor: { page: 12 } },
            { source: JONES, anchor: { sourceId: "S1", page: 5, endPage: 7 } },
          ],
          "citekey",
        ),
        "[@smith2024, p. 12; @jones2023, pp. 5-7]",
      );
    });

    it("renders author-year with locators", function () {
      assert.equal(
        formatCitationGroup(
          [
            { source: SMITH, anchor: { page: 12 } },
            { source: JONES, anchor: { sourceId: "S1", page: 5 } },
          ],
          "author-year",
        ),
        "(Smith et al., 2024, p. 12; Jones, 2023, p. 5)",
      );
    });

    it("falls back to author-year when a work in the bracket has no key", function () {
      assert.equal(
        formatCitationGroup(
          [
            { source: SMITH, anchor: { page: 12 } },
            { source: ZHANG, anchor: { sourceId: "S1", page: 3 } },
          ],
          "citekey",
        ),
        "(Smith et al., 2024, p. 12; 张伟 等, 2022, p. 3)",
      );
    });

    it("substitutes a placeholder for a work with no author or year", function () {
      assert.equal(
        formatCitationGroup(
          [{ source: { id: "9", title: "Loose file" }, anchor: { page: 2 } }],
          "author-year",
        ),
        "(Loose file, n.d., p. 2)",
      );
      assert.equal(
        formatCitationGroup(
          [{ source: { id: "9" }, anchor: { page: 2 } }],
          "author-year",
          "zh-CN",
        ),
        "(佚名, 无日期, p. 2)",
      );
    });

    it("collapses a repeated work and page inside one bracket", function () {
      assert.equal(
        formatCitationGroup(
          [
            { source: SMITH, anchor: { page: 12 } },
            { source: SMITH, anchor: { page: 12 } },
          ],
          "citekey",
        ),
        "[@smith2024, p. 12]",
      );
    });
  });

  describe("sortWritingReferences", function () {
    it("orders by first author, then year, then title", function () {
      const sorted = sortWritingReferences([
        { source: SMITH, citationCount: 1 },
        { source: ZHANG, citationCount: 1 },
        { source: JONES, citationCount: 1 },
      ]);
      assert.deepEqual(
        sorted.map((entry) => entry.source.id),
        ["2", "1", "3"],
      );
    });

    it("sorts Chinese first authors by pinyin", function () {
      const li: WritingSource = {
        id: "10",
        creators: [{ lastName: "李", firstName: "娜" }],
        title: "乙",
        date: "2021",
      };
      const zhao: WritingSource = {
        id: "11",
        creators: [{ lastName: "赵", firstName: "强" }],
        title: "甲",
        date: "2021",
      };
      const sorted = sortWritingReferences(
        [
          { source: zhao, citationCount: 1 },
          { source: li, citationCount: 1 },
        ],
        "zh-CN",
      );
      assert.deepEqual(
        sorted.map((entry) => entry.source.id),
        ["10", "11"],
      );
    });

    it("falls back to the title when a work has no creators", function () {
      const sorted = sortWritingReferences([
        { source: JONES, citationCount: 1 },
        { source: { id: "12", title: "Anonymous report" }, citationCount: 1 },
      ]);
      assert.deepEqual(
        sorted.map((entry) => entry.source.id),
        ["12", "2"],
      );
    });
  });

  describe("formatReferenceEntry", function () {
    it("prints author, year, title and container", function () {
      assert.equal(
        formatReferenceEntry(SMITH, "author-year"),
        "Smith, J., Okafor, A., & Rossi, L. (2024). Retrieval over long documents. Journal of Retrieval.",
      );
    });

    it("prefixes the citation key in citekey mode", function () {
      assert.equal(
        formatReferenceEntry(JONES, "citekey"),
        "[@jones2023] Jones, B. (2023). A shorter study. Proceedings of Things.",
      );
    });

    it("omits fields Zotero does not have", function () {
      assert.equal(
        formatReferenceEntry({ id: "20", title: "Bare item" }, "citekey"),
        "(n.d.). Bare item.",
      );
      assert.equal(
        formatReferenceEntry({ id: "21" }, "author-year", "zh-CN"),
        "(无日期). 无标题.",
      );
    });
  });

  describe("buildWritingDraft", function () {
    const resolve = RESOLVE_FIXTURE;

    it("rewrites base and supplemental anchors into citekeys", function () {
      const draft = buildWritingDraft({
        text: "Long contexts help [p.12]. Short ones do not [S1 pp.5-7].",
        resolveSource: resolve,
        style: "citekey",
      });
      assert.equal(
        draft.body,
        "Long contexts help [@smith2024, p. 12]. Short ones do not [@jones2023, pp. 5-7].",
      );
      assert.equal(draft.resolvedAnchorCount, 2);
      assert.equal(draft.unresolvedAnchorCount, 0);
      assert.deepEqual(
        draft.references.map((entry) => entry.source.id),
        ["2", "1"],
      );
    });

    it("rewrites the same answer into author-year citations", function () {
      const draft = buildWritingDraft({
        text: "Long contexts help [p.12]. Short ones do not [S1 pp.5-7].",
        resolveSource: resolve,
        style: "author-year",
      });
      assert.equal(
        draft.body,
        "Long contexts help (Smith et al., 2024, p. 12). Short ones do not (Jones, 2023, pp. 5-7).",
      );
    });

    it("merges anchors that sit side by side into one bracket", function () {
      const draft = buildWritingDraft({
        text: "Both agree [p.3] [S1 p.9].",
        resolveSource: resolve,
        style: "citekey",
      });
      assert.equal(
        draft.body,
        "Both agree [@smith2024, p. 3; @jones2023, p. 9].",
      );
    });

    it("keeps anchors on separate lines apart", function () {
      const draft = buildWritingDraft({
        text: "First claim [p.3]\nSecond claim [S1 p.9]",
        resolveSource: resolve,
        style: "citekey",
      });
      assert.equal(
        draft.body,
        "First claim [@smith2024, p. 3]\nSecond claim [@jones2023, p. 9]",
      );
    });

    it("counts repeat citations once in the reference list", function () {
      const draft = buildWritingDraft({
        text: "One [p.3]. Two [p.4]. Three [p.5].",
        resolveSource: resolve,
        style: "author-year",
      });
      assert.lengthOf(draft.references, 1);
      assert.equal(draft.references[0].citationCount, 3);
      assert.equal(draft.resolvedAnchorCount, 3);
    });

    it("leaves unresolvable anchors in place and reports them", function () {
      const draft = buildWritingDraft({
        text: "Known [p.3], unknown [S9 p.4], unknown again [S9 p.4].",
        resolveSource: resolve,
        style: "citekey",
        lang: "en-US",
        generatedAt: "2026-08-29 10:00",
      });
      assert.equal(
        draft.body,
        "Known [@smith2024, p. 3], unknown [S9 p.4], unknown again [S9 p.4].",
      );
      assert.equal(draft.unresolvedAnchorCount, 2);
      assert.deepEqual(draft.unresolved, [{ raw: "[S9 p.4]", count: 2 }]);
      assert.include(draft.markdown, "## Unresolved citations");
      assert.include(draft.markdown, "- `[S9 p.4]` — 2 occurrences");
    });

    it("leaves prose and non-anchor brackets untouched", function () {
      const draft = buildWritingDraft({
        text: "See [the docs](https://example.com) and [p.7] plus [1].",
        resolveSource: resolve,
        style: "author-year",
      });
      assert.equal(
        draft.body,
        "See [the docs](https://example.com) and (Smith et al., 2024, p. 7) plus [1].",
      );
      assert.equal(draft.unresolvedAnchorCount, 0);
    });

    it("assembles heading, references and warning sections", function () {
      const draft = buildWritingDraft({
        text: "Claim [p.12] and another [S2 p.4], plus a gap [S9 p.1].",
        resolveSource: resolve,
        style: "author-year",
        lang: "zh-CN",
        generatedAt: "2026-08-29 10:00",
      });
      const lines = draft.markdown.split("\n");
      assert.equal(lines[0], "# 写作草稿");
      assert.include(draft.markdown, "由 AIdea 导出 — 2026-08-29 10:00");
      assert.include(draft.markdown, "## 参考文献");
      assert.include(
        draft.markdown,
        "- Smith, J., Okafor, A., & Rossi, L. (2024). Retrieval over long documents. Journal of Retrieval.",
      );
      assert.include(
        draft.markdown,
        "- 张伟、李娜、王芳. (2022). 中文文献标题. 情报学报.",
      );
      assert.include(draft.markdown, "## 未能解析的引用");
      assert.include(draft.markdown, "- `[S9 p.1]` — 1 处");
      // The reference list is the last section only when nothing failed.
      assert.isBelow(
        draft.markdown.indexOf("## 参考文献"),
        draft.markdown.indexOf("## 未能解析的引用"),
      );
    });

    it("returns nothing for an answer with no text", function () {
      const draft = buildWritingDraft({
        text: "   ",
        resolveSource: resolve,
        style: "citekey",
      });
      assert.equal(draft.markdown, "");
      assert.lengthOf(draft.references, 0);
    });

    it("treats a throwing resolver as an unresolved anchor", function () {
      const draft = buildWritingDraft({
        text: "Claim [p.12].",
        resolveSource: () => {
          throw new Error("Zotero is gone");
        },
        style: "citekey",
      });
      assert.equal(draft.body, "Claim [p.12].");
      assert.equal(draft.unresolvedAnchorCount, 1);
    });
  });
});
