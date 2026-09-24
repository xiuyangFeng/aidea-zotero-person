import { expect } from "chai";
import {
  parseCitationForImport,
  normalizeCrossrefToZoteroItem,
  normalizeOpenAlexToZoteroItem,
  collectImportableReferences,
  buildCrossrefLookup,
  buildOpenAlexLookup,
  pickCrossrefItem,
  pickOpenAlexItem,
  isAcceptableTitleMatch,
  normalizeDoiKey,
  isSameWork,
  findDuplicateWork,
  buildZoteroItemDraft,
  venueFieldForItemType,
  summarizeImportOutcomes,
  type ImportableReference,
} from "../src/utils/citationImport";
import type { CitationResolution } from "../src/utils/citationInsight";

function resolution(
  raw: string,
  text: string | null,
  libraryTitle?: string,
): CitationResolution {
  return {
    marker: {
      kind: "numeric",
      raw,
      number: 1,
      author: null,
      year: null,
      key: raw,
    },
    reference: text === null ? null : { number: 1, text, page: null },
    ...(libraryTitle ? { libraryTitle } : {}),
  };
}

describe("citation import", function () {
  it("parses citation string with DOI and year", function () {
    const raw =
      "Vaswani, A., et al. (2017). Attention is all you need. NeurIPS. https://doi.org/10.48550/arXiv.1706.03762";
    const res = parseCitationForImport(raw);

    expect(res.extractedDoi).to.equal("10.48550/arXiv.1706.03762");
    expect(res.extractedYear).to.equal("2017");
    expect(res.extractedAuthor).to.include("Vaswani");
  });

  it("normalizes Crossref work record into Zotero item format", function () {
    const crossrefMock = {
      title: ["Deep Residual Learning for Image Recognition"],
      type: "proceedings-article",
      author: [
        { given: "Kaiming", family: "He" },
        { given: "Xiangyu", family: "Zhang" },
      ],
      "container-title": [
        "Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition",
      ],
      DOI: "10.1109/CVPR.2016.90",
      issued: { "date-parts": [[2016, 6]] },
      page: "770-778",
      link: [
        {
          "content-type": "application/pdf",
          URL: "https://openaccess.thecvf.com/paper.pdf",
        },
      ],
    };

    const item = normalizeCrossrefToZoteroItem(crossrefMock);
    expect(item).to.not.be.null;
    expect(item?.itemType).to.equal("conferencePaper");
    expect(item?.title).to.equal(
      "Deep Residual Learning for Image Recognition",
    );
    expect(item?.creators).to.deep.equal([
      { creatorType: "author", firstName: "Kaiming", lastName: "He" },
      { creatorType: "author", firstName: "Xiangyu", lastName: "Zhang" },
    ]);
    expect(item?.DOI).to.equal("10.1109/CVPR.2016.90");
    expect(item?.date).to.equal("2016-6");
    expect(item?.openAccessPdfUrl).to.equal(
      "https://openaccess.thecvf.com/paper.pdf",
    );
  });

  it("normalizes OpenAlex work record into Zotero item format", function () {
    const openAlexMock = {
      title: "Language Models are Few-Shot Learners",
      type: "preprint",
      authorships: [
        { raw_author_name: "Tom B. Brown" },
        { raw_author_name: "Benjamin Mann" },
      ],
      publication_year: 2020,
      doi: "https://doi.org/10.48550/arxiv.2005.14165",
      open_access: { oa_url: "https://arxiv.org/pdf/2005.14165.pdf" },
    };

    const item = normalizeOpenAlexToZoteroItem(openAlexMock);
    expect(item).to.not.be.null;
    expect(item?.itemType).to.equal("preprint");
    expect(item?.title).to.equal("Language Models are Few-Shot Learners");
    expect(item?.creators[0]).to.deep.equal({
      creatorType: "author",
      firstName: "Tom B.",
      lastName: "Brown",
    });
    expect(item?.DOI).to.equal("10.48550/arxiv.2005.14165");
    expect(item?.openAccessPdfUrl).to.equal(
      "https://arxiv.org/pdf/2005.14165.pdf",
    );
  });

  describe("importable references", function () {
    it("offers only located, unmatched entries with a DOI or title", function () {
      const refs = collectImportableReferences([
        resolution(
          "[1]",
          'K. He, X. Zhang, S. Ren, and J. Sun, "Deep residual learning for image recognition," in CVPR, 2016.',
        ),
        resolution("[2]", null),
        resolution(
          "[3]",
          'A. Vaswani et al., "Attention is all you need," NeurIPS, 2017.',
          "Attention Is All You Need",
        ),
        resolution("[4]", "Smith 2020. doi:10.1000/xyz123"),
        resolution("[5]", "12, 34."),
      ]);
      expect(refs.map((r) => r.label)).to.deep.equal(["[1]", "[4]"]);
      expect(refs[0].titleGuess.toLowerCase()).to.include(
        "deep residual learning",
      );
      expect(refs[1].doi).to.equal("10.1000/xyz123");
    });

    it("dedupes an entry cited twice and honours the cap", function () {
      const text = '"A study of reproducible pipelines," J. Data, 2020.';
      const refs = collectImportableReferences([
        resolution("[7]", text),
        resolution("[8]", text),
      ]);
      expect(refs).to.have.length(1);
      const many = Array.from({ length: 15 }, (_, i) =>
        resolution(`[${i}]`, `"Distinct paper title number ${i} here," 2020.`),
      );
      expect(collectImportableReferences(many, 4)).to.have.length(4);
    });
  });

  describe("metadata lookup", function () {
    const byTitle: ImportableReference = {
      label: "[1]",
      referenceText:
        "He et al. Deep residual learning for image recognition. CVPR 2016.",
      titleGuess: "Deep residual learning for image recognition",
    };
    const byDoi: ImportableReference = {
      label: "[2]",
      referenceText: "x",
      titleGuess: "",
      doi: "10.1109/CVPR.2016.90",
    };

    it("uses the DOI endpoint when a DOI is known", function () {
      expect(buildCrossrefLookup(byDoi)).to.deep.equal({
        url: "https://api.crossref.org/works/10.1109%2FCVPR.2016.90",
        byDoi: true,
      });
      expect(buildOpenAlexLookup(byDoi)).to.deep.equal({
        url: "https://api.openalex.org/works/doi:10.1109/CVPR.2016.90",
        byDoi: true,
      });
    });

    it("falls back to bibliographic / search queries", function () {
      const crossref = buildCrossrefLookup(byTitle);
      expect(crossref?.byDoi).to.equal(false);
      expect(crossref?.url).to.include("query.bibliographic=He%20et%20al.");
      const openalex = buildOpenAlexLookup(byTitle);
      expect(openalex?.url).to.include(
        "search=Deep%20residual%20learning%20for%20image%20recognition",
      );
      expect(
        buildCrossrefLookup({ label: "x", referenceText: "x", titleGuess: "" }),
      ).to.equal(null);
    });

    it("accepts a search hit only when the titles match", function () {
      expect(
        isAcceptableTitleMatch(
          "Deep Residual Learning for Image Recognition",
          byTitle.titleGuess,
        ),
      ).to.equal(true);
      expect(
        isAcceptableTitleMatch(
          "Identity mappings in deep residual networks",
          byTitle.titleGuess,
        ),
      ).to.equal(false);
      // A much longer title that merely contains the guess is another work.
      expect(
        isAcceptableTitleMatch(
          "Deep residual learning for image recognition: a survey of thirty variants across medical, remote sensing and video domains",
          byTitle.titleGuess,
        ),
      ).to.equal(false);
    });

    it("picks the matching Crossref search item", function () {
      const request = buildCrossrefLookup(byTitle)!;
      const json = {
        message: {
          items: [
            { title: ["Something else entirely"], DOI: "10.1/a" },
            {
              title: ["Deep Residual Learning for Image Recognition"],
              DOI: "10.1109/CVPR.2016.90",
              type: "proceedings-article",
            },
          ],
        },
      };
      const item = pickCrossrefItem(json, request, byTitle.titleGuess);
      expect(item?.DOI).to.equal("10.1109/CVPR.2016.90");
      expect(
        pickCrossrefItem({ message: { items: [] } }, request, "x"),
      ).to.equal(null);
      expect(pickCrossrefItem(null, request, "x")).to.equal(null);
    });

    it("trusts a DOI lookup and picks OpenAlex results", function () {
      const doiRequest = buildCrossrefLookup(byDoi)!;
      const item = pickCrossrefItem(
        { message: { title: ["Anything"], DOI: "10.1109/CVPR.2016.90" } },
        doiRequest,
        "",
      );
      expect(item?.title).to.equal("Anything");
      const oa = pickOpenAlexItem(
        {
          results: [
            {
              display_name: "Deep Residual Learning for Image Recognition",
              doi: "https://doi.org/10.1109/cvpr.2016.90",
            },
          ],
        },
        buildOpenAlexLookup(byTitle)!,
        byTitle.titleGuess,
      );
      expect(oa?.DOI).to.equal("10.1109/cvpr.2016.90");
    });
  });

  describe("duplicate detection", function () {
    it("normalizes DOIs", function () {
      expect(normalizeDoiKey("https://doi.org/10.1109/CVPR.2016.90.")).to.equal(
        "10.1109/cvpr.2016.90",
      );
      expect(normalizeDoiKey("doi: 10.1/ABC")).to.equal("10.1/abc");
      expect(normalizeDoiKey(undefined)).to.equal("");
    });

    it("matches by DOI or near-identical title", function () {
      expect(
        isSameWork(
          { DOI: "10.1109/CVPR.2016.90", title: "x" },
          { DOI: "https://doi.org/10.1109/cvpr.2016.90", title: "y" },
        ),
      ).to.equal(true);
      expect(
        isSameWork(
          { title: "Deep Residual Learning for Image Recognition" },
          {
            DOI: "10.9/other",
            title: "Deep residual learning for image recognition.",
          },
        ),
      ).to.equal(true);
      expect(
        isSameWork(
          { title: "Deep Residual Learning for Image Recognition" },
          { title: "Deep Residual Learning" },
        ),
      ).to.equal(false);
      expect(isSameWork({}, {})).to.equal(false);
    });

    it("returns the first duplicate among existing records", function () {
      const existing = [
        { id: 1, title: "Unrelated", DOI: "" },
        { id: 2, title: "Other", DOI: "10.5/x" },
      ];
      expect(findDuplicateWork({ DOI: "10.5/X" }, existing)?.id).to.equal(2);
      expect(findDuplicateWork({ title: "Nope" }, existing)).to.equal(null);
    });
  });

  describe("Zotero field mapping", function () {
    it("maps the venue per item type", function () {
      expect(venueFieldForItemType("journalArticle")).to.equal(
        "publicationTitle",
      );
      expect(venueFieldForItemType("conferencePaper")).to.equal(
        "proceedingsTitle",
      );
      expect(venueFieldForItemType("preprint")).to.equal("repository");
      expect(venueFieldForItemType("book")).to.equal(null);
    });

    it("maps a Crossref record to fields, creators and Extra", function () {
      const item = normalizeCrossrefToZoteroItem({
        title: ["Deep Residual Learning for Image Recognition"],
        type: "proceedings-article",
        author: [{ given: "Kaiming", family: "He" }, { given: "Nobody" }],
        "container-title": ["CVPR"],
        DOI: "10.1109/CVPR.2016.90",
        issued: { "date-parts": [[2016, 6]] },
        page: "770-778",
      })!;
      const draft = buildZoteroItemDraft(
        item,
        "Crossref",
        (type, field) => !(type === "conferencePaper" && field === "DOI"),
      );
      expect(draft.itemType).to.equal("conferencePaper");
      expect(draft.fields).to.deep.include(["proceedingsTitle", "CVPR"]);
      expect(draft.fields).to.deep.include(["pages", "770-778"]);
      expect(draft.fields).to.deep.include(["libraryCatalog", "Crossref"]);
      expect(draft.fields.find(([f]) => f === "DOI")).to.equal(undefined);
      expect(draft.extraLines).to.deep.equal(["DOI: 10.1109/CVPR.2016.90"]);
      expect(draft.creators).to.deep.equal([
        { creatorType: "author", firstName: "Kaiming", lastName: "He" },
      ]);
    });

    it("drops fields the type cannot hold and survives a throwing validator", function () {
      const draft = buildZoteroItemDraft(
        {
          itemType: "book",
          title: "A Book",
          creators: [],
          pages: "300",
          publicationTitle: "Series",
        },
        "OpenAlex",
        (_type, field) => {
          if (field === "pages") throw new Error("boom");
          return true;
        },
      );
      expect(draft.fields).to.deep.equal([
        ["title", "A Book"],
        ["libraryCatalog", "OpenAlex"],
      ]);
      expect(draft.extraLines).to.deep.equal([]);
    });
  });

  describe("outcome summary", function () {
    it("is a success when everything landed in the library", function () {
      const summary = summarizeImportOutcomes([
        { kind: "imported", title: "a", itemID: 1 },
        { kind: "duplicate", title: "b", itemID: 2 },
      ]);
      expect(summary).to.include({
        imported: 1,
        duplicates: 1,
        noticeKind: "success",
      });
    });

    it("is an error when nothing landed and a request failed", function () {
      const summary = summarizeImportOutcomes([
        { kind: "failed", label: "[1]", failure: "offline" },
        { kind: "failed", label: "[2]", failure: "offline" },
      ]);
      expect(summary.noticeKind).to.equal("error");
      expect(summary.commonFailure).to.equal("offline");
    });

    it("is a warning for a mixed result", function () {
      const summary = summarizeImportOutcomes([
        { kind: "imported", title: "a", itemID: 1 },
        { kind: "not-found", label: "[2]" },
        { kind: "failed", label: "[3]", failure: "timeout" },
        { kind: "failed", label: "[4]", failure: "offline" },
      ]);
      expect(summary.noticeKind).to.equal("warning");
      expect(summary.commonFailure).to.equal(null);
      expect(summary.notFound).to.equal(1);
      expect(summary.failed).to.equal(2);
    });
  });
});
