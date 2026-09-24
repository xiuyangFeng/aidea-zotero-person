import { expect } from "chai";
import {
  extractPaperIdentifiers,
  normalizeGitHubSearchResponse,
  formatCodeRepositoriesMarkdown,
  sortRepositories,
  buildGitHubRepoQueries,
  buildGitHubRepoSearchUrl,
  mergeRepositoryLists,
  formatStarCount,
  isSafeRepositoryUrl,
  buildCodeRepositoryRows,
  buildGitHubWebSearchUrl,
  CODE_REPO_LIST_MAX,
} from "../src/utils/paperToCode";
import * as paperToCode from "../src/utils/paperToCode";

describe("paper to code linker", function () {
  it("extracts arXiv ID and DOI from strings", function () {
    const text = "See arXiv:1706.03762v5 or DOI: 10.1145/3318464.3389700";
    const res = extractPaperIdentifiers(text);

    expect(res.arxivId).to.equal("1706.03762v5");
    expect(res.doi).to.equal("10.1145/3318464.3389700");
  });

  it("sorts official repositories first, then by stars", function () {
    const repos = sortRepositories([
      {
        name: "a/community",
        url: "https://github.com/a/community",
        stars: 1200,
        isOfficial: false,
      },
      {
        name: "b/official",
        url: "https://github.com/b/official",
        stars: 800,
        isOfficial: true,
      },
      {
        name: "c/small",
        url: "https://github.com/c/small",
        stars: 5,
        isOfficial: false,
      },
    ]);
    expect(repos.map((r) => r.name)).to.deep.equal([
      "b/official",
      "a/community",
      "c/small",
    ]);
  });

  it("normalizes GitHub Search API response", function () {
    const mockGH = {
      items: [
        {
          full_name: "karpathy/nanoGPT",
          html_url: "https://github.com/karpathy/nanoGPT",
          stargazers_count: 42000,
          language: "Python",
          description:
            "The simplest, fastest repository for training/finetuning medium-sized GPTs.",
        },
      ],
    };

    const repos = normalizeGitHubSearchResponse(mockGH);
    expect(repos.length).to.equal(1);
    expect(repos[0].name).to.equal("karpathy/nanoGPT");
    expect(repos[0].stars).to.equal(42000);
    expect(repos[0].framework).to.equal("Python");
  });

  it("formats code repositories as Markdown table", function () {
    const result = {
      paperTitle: "Attention Is All You Need",
      repositories: [
        {
          name: "tensorflow/tensor2tensor",
          url: "https://github.com/tensorflow/tensor2tensor",
          stars: 15400,
          framework: "TensorFlow",
          isOfficial: true,
        },
      ],
    };

    const md = formatCodeRepositoriesMarkdown(result);
    expect(md).to.include("Open Source Code for *Attention Is All You Need*");
    expect(md).to.include(
      "[tensorflow/tensor2tensor](https://github.com/tensorflow/tensor2tensor)",
    );
    expect(md).to.include("15.4k");
    expect(md).to.include("Official");
  });

  it("no longer exposes a Papers with Code path", function () {
    expect(
      (paperToCode as Record<string, unknown>).normalizePapersWithCodeResponse,
    ).to.equal(undefined);
  });

  it("builds GitHub queries most specific first", function () {
    const queries = buildGitHubRepoQueries({
      title: "Attention Is All You Need",
      arxivId: "1706.03762v5",
      doi: "10.1145/3318464.3389700",
    });
    expect(queries).to.deep.equal([
      '"1706.03762" in:readme,description',
      '"10.1145/3318464.3389700" in:readme',
      '"Attention Is All You Need" in:readme,description,name',
    ]);
    expect(buildGitHubRepoQueries({ title: "" })).to.deep.equal([]);
    expect(buildGitHubRepoQueries({ title: "GAN" })).to.deep.equal([]);
  });

  it("strips quotes from the title phrase and caps its length", function () {
    const [query] = buildGitHubRepoQueries({
      title: `A "quoted" title ${"word ".repeat(40)}`,
    });
    expect(query.startsWith('"A quoted title')).to.equal(true);
    expect(query.length).to.be.lessThan(160);
  });

  it("builds an encoded, star-sorted search URL", function () {
    const url = buildGitHubRepoSearchUrl('"1706.03762" in:readme');
    expect(url).to.match(
      /^https:\/\/api\.github\.com\/search\/repositories\?q=/,
    );
    expect(url).to.include(encodeURIComponent('"1706.03762" in:readme'));
    expect(url).to.include("sort=stars");
  });

  it("merges result lists by URL and re-sorts by stars", function () {
    const merged = mergeRepositoryLists([
      normalizeGitHubSearchResponse({
        items: [
          {
            full_name: "a/x",
            html_url: "https://github.com/a/x",
            stargazers_count: 3,
          },
        ],
      }),
      normalizeGitHubSearchResponse({
        items: [
          {
            full_name: "a/x",
            html_url: "https://github.com/A/x",
            stargazers_count: 3,
          },
          {
            full_name: "b/y",
            html_url: "https://github.com/b/y",
            stargazers_count: 90,
          },
          { full_name: "no-url" },
        ],
      }),
    ]);
    expect(merged.map((r) => r.name)).to.deep.equal(["b/y", "a/x"]);
  });

  it("turns repositories into display rows", function () {
    expect(formatStarCount(0)).to.equal("0");
    expect(formatStarCount(999)).to.equal("999");
    expect(formatStarCount(1000)).to.equal("1k");
    expect(formatStarCount(15400)).to.equal("15.4k");
    expect(formatStarCount(2300000)).to.equal("2.3m");
    expect(formatStarCount(Number.NaN)).to.equal("0");

    const rows = buildCodeRepositoryRows([
      {
        name: "karpathy/nanoGPT",
        url: "https://github.com/karpathy/nanoGPT",
        stars: 42000,
        framework: "Python",
        isOfficial: false,
        description: "  The simplest,\n fastest  repo ",
      },
      {
        name: "evil",
        url: "javascript:alert(1)",
        stars: 1,
        isOfficial: false,
      },
    ]);
    expect(rows).to.deep.equal([
      {
        name: "karpathy/nanoGPT",
        url: "https://github.com/karpathy/nanoGPT",
        starsLabel: "42k",
        language: "Python",
        description: "The simplest, fastest repo",
      },
    ]);
    const many = Array.from({ length: 20 }, (_, i) => ({
      name: `o/r${i}`,
      url: `https://github.com/o/r${i}`,
      stars: i,
      isOfficial: false,
    }));
    expect(buildCodeRepositoryRows(many)).to.have.length(CODE_REPO_LIST_MAX);
  });

  it("only accepts plain GitHub repository URLs", function () {
    expect(isSafeRepositoryUrl("https://github.com/a/b")).to.equal(true);
    expect(isSafeRepositoryUrl("http://github.com/a/b")).to.equal(false);
    expect(isSafeRepositoryUrl("https://github.com.evil.io/a/b")).to.equal(
      false,
    );
    expect(isSafeRepositoryUrl("https://github.com/a")).to.equal(false);
  });

  it("builds a GitHub web search fallback URL", function () {
    expect(buildGitHubWebSearchUrl("Deep Residual Learning")).to.equal(
      `https://github.com/search?type=repositories&q=${encodeURIComponent('"Deep Residual Learning"')}`,
    );
  });
});
