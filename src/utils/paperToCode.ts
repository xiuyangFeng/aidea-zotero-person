/**
 * Paper-to-Code Linker — automatic discovery and linking of open-source repositories.
 *
 * Resolves paper identifiers (arXiv ID, DOI, Title) to open-source code
 * implementations through the GitHub repository search API, surfacing stars,
 * language, and description. Papers with Code, which used to map papers to
 * official repositories, has shut down; GitHub search is the only source.
 *
 * Pure: queries, URLs, response normalization and the list model the panel
 * renders. The unauthenticated request itself lives in
 * `modules/contextPanel/paperToCodeActions.ts`.
 */

export interface CodeRepository {
  name: string;
  url: string;
  stars: number;
  framework?: string;
  isOfficial: boolean;
  description?: string;
}

export interface PaperCodeDiscoveryResult {
  paperTitle: string;
  arxivId?: string;
  doi?: string;
  repositories: CodeRepository[];
}

const ARXIV_REGEX = /\b(?:arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)\b/i;
const DOI_REGEX = /\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/;

/**
 * Extracts arXiv ID and DOI from titles, text, or URLs.
 */
export function extractPaperIdentifiers(input: string): {
  arxivId?: string;
  doi?: string;
} {
  const text = String(input || "");
  const arxivMatch = text.match(ARXIV_REGEX);
  const doiMatch = text.match(DOI_REGEX);

  return {
    arxivId: arxivMatch ? arxivMatch[1] : undefined,
    doi: doiMatch ? doiMatch[1].replace(/[.,;)]+$/, "") : undefined,
  };
}

/**
 * Normalizes GitHub Search API repository responses.
 */
export function normalizeGitHubSearchResponse(data: any): CodeRepository[] {
  if (!data || !Array.isArray(data.items)) return [];
  const repos: CodeRepository[] = [];

  for (const item of data.items) {
    if (!item.html_url) continue;
    repos.push({
      name: item.full_name || item.name,
      url: item.html_url,
      stars:
        typeof item.stargazers_count === "number" ? item.stargazers_count : 0,
      framework: item.language || undefined,
      isOfficial: false,
      description: item.description || undefined,
    });
  }

  return sortRepositories(repos);
}

export function sortRepositories(repos: CodeRepository[]): CodeRepository[] {
  return [...repos].sort((a, b) => {
    if (a.isOfficial && !b.isOfficial) return -1;
    if (!a.isOfficial && b.isOfficial) return 1;
    return b.stars - a.stars;
  });
}

/**
 * Formats discovered repositories into a clean Markdown block.
 */
export function formatCodeRepositoriesMarkdown(
  result: PaperCodeDiscoveryResult,
): string {
  if (!result.repositories || result.repositories.length === 0) {
    return `### Code Repositories\n\nNo open-source repositories found for *${result.paperTitle}*.`;
  }

  const lines: string[] = [
    `### Open Source Code for *${result.paperTitle}*\n`,
    "| Repository | Stars | Framework | Official |",
    "| --- | --- | --- | --- |",
  ];

  for (const r of result.repositories.slice(0, 5)) {
    const starStr =
      r.stars >= 1000 ? `${(r.stars / 1000).toFixed(1)}k` : `${r.stars}`;
    const officialBadge = r.isOfficial ? " Official" : "-";
    const frameworkStr = r.framework || "N/A";
    lines.push(
      `| [${r.name}](${r.url}) | ⭐ ${starStr} | ${frameworkStr} | ${officialBadge} |`,
    );
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════
// GitHub search requests
// ═══════════════════════════════════════════════════════════

export const GITHUB_REPO_SEARCH_API =
  "https://api.github.com/search/repositories";

/** Results requested per query; the panel shows at most `CODE_REPO_LIST_MAX`. */
export const GITHUB_SEARCH_PER_PAGE = 10;

/** Rows the result list shows. */
export const CODE_REPO_LIST_MAX = 8;

/** Titles longer than this are cut at a word boundary for the phrase query. */
const TITLE_QUERY_MAX_LENGTH = 120;

export type PaperCodeQueryInput = {
  title?: string | null;
  arxivId?: string | null;
  doi?: string | null;
};

function cleanTitleForQuery(title: unknown): string {
  let text = String(title || "")
    .replace(/["“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > TITLE_QUERY_MAX_LENGTH) {
    const cut = text.slice(0, TITLE_QUERY_MAX_LENGTH);
    const lastSpace = cut.lastIndexOf(" ");
    text = lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
  }
  return text;
}

/**
 * GitHub search queries for one paper, most specific first.
 *
 * Official implementations almost always link the paper in their README, so
 * the arXiv id (version stripped) and the DOI are searched there first; the
 * exact title phrase in the README or description is the broad fallback.
 */
export function buildGitHubRepoQueries(input: PaperCodeQueryInput): string[] {
  const queries: string[] = [];
  const arxivId = String(input.arxivId || "")
    .trim()
    .replace(/v\d+$/i, "");
  if (arxivId) queries.push(`"${arxivId}" in:readme,description`);
  const doi = String(input.doi || "").trim();
  if (doi) queries.push(`"${doi}" in:readme`);
  const title = cleanTitleForQuery(input.title);
  if (title.split(" ").length >= 2 || title.length >= 12) {
    queries.push(`"${title}" in:readme,description,name`);
  }
  return queries;
}

export function buildGitHubRepoSearchUrl(query: string): string {
  return `${GITHUB_REPO_SEARCH_API}?q=${encodeURIComponent(
    query,
  )}&sort=stars&order=desc&per_page=${GITHUB_SEARCH_PER_PAGE}`;
}

/** Repositories from several queries, de-duplicated by URL and re-sorted. */
export function mergeRepositoryLists(
  lists: CodeRepository[][],
): CodeRepository[] {
  const byUrl = new Map<string, CodeRepository>();
  for (const list of lists) {
    for (const repo of list || []) {
      const key = String(repo.url || "").toLowerCase();
      if (key && !byUrl.has(key)) byUrl.set(key, repo);
    }
  }
  return sortRepositories(Array.from(byUrl.values()));
}

// ═══════════════════════════════════════════════════════════
// List model the panel renders
// ═══════════════════════════════════════════════════════════

export type CodeRepositoryRow = {
  name: string;
  url: string;
  starsLabel: string;
  language: string;
  description: string;
};

/** `15400` → `15.4k`, `1000000` → `1m`; small counts as they are. */
export function formatStarCount(stars: number): string {
  const n = Number.isFinite(stars) && stars > 0 ? Math.floor(stars) : 0;
  if (n >= 1000000) return `${trimFixed(n / 1000000)}m`;
  if (n >= 1000) return `${trimFixed(n / 1000)}k`;
  return `${n}`;
}

function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** Only `https://github.com/…` links are opened from the panel. */
export function isSafeRepositoryUrl(url: unknown): boolean {
  return /^https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/?$/i.test(
    String(url || ""),
  );
}

export function buildCodeRepositoryRows(
  repos: CodeRepository[],
  max: number = CODE_REPO_LIST_MAX,
): CodeRepositoryRow[] {
  return (repos || [])
    .filter((repo) => isSafeRepositoryUrl(repo.url))
    .slice(0, max)
    .map((repo) => ({
      name: String(repo.name || repo.url),
      url: repo.url,
      starsLabel: formatStarCount(repo.stars),
      language: repo.framework || "",
      description: String(repo.description || "")
        .replace(/\s+/g, " ")
        .trim(),
    }));
}

/** GitHub's web search for the same paper, offered when the API finds nothing. */
export function buildGitHubWebSearchUrl(title: unknown): string {
  const text = cleanTitleForQuery(title);
  return `https://github.com/search?type=repositories&q=${encodeURIComponent(
    text ? `"${text}"` : "",
  )}`;
}
