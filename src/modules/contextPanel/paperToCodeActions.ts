/**
 * Paper-to-code — the Zotero side of "Find code repositories".
 *
 * Reads the paper's title, DOI and arXiv id from its Zotero item, asks the
 * GitHub repository search API (anonymously — no token is asked for or
 * stored) for repositories that mention it, and renders the hits into the
 * floating result list the reading menu's figure navigator also uses.
 *
 * Unauthenticated search is limited to a handful of requests a minute, so
 * results are cached per item for the session and a 403/429 is reported as a
 * rate limit with the wait GitHub announces. Queries, normalization and the
 * row model are pure and live in `utils/paperToCode.ts`.
 */

import { createElement } from "../../utils/domHelpers";
import {
  buildGitHubRepoQueries,
  buildGitHubRepoSearchUrl,
  extractPaperIdentifiers,
  isSafeRepositoryUrl,
  mergeRepositoryLists,
  normalizeGitHubSearchResponse,
  type CodeRepository,
  type CodeRepositoryRow,
  type PaperCodeQueryInput,
} from "../../utils/paperToCode";
import {
  classifyLookupError,
  resolveRateLimitWaitMinutes,
  type LookupFailureKind,
  type LookupHttpError,
} from "../../utils/lookupErrors";
import { getPanelI18n } from "./i18n";
import { fetchLookupJson } from "./lookupFetch";

const GITHUB_ACCEPT = "application/vnd.github+json";

/** Results are reused this long, so reopening the list costs no quota. */
const RESULT_CACHE_TTL_MS = 30 * 60 * 1000;

export type PaperCodeSearchOutcome =
  | { kind: "ok"; repositories: CodeRepository[] }
  | { kind: "no-query" }
  | {
      kind: "failed";
      failure: LookupFailureKind;
      waitMinutes: number | null;
    };

const resultCache = new Map<
  string,
  { at: number; repositories: CodeRepository[] }
>();

function safeField(item: Zotero.Item, field: string): string {
  try {
    return String(item.getField(field as any) || "").trim();
  } catch {
    return "";
  }
}

/** The regular item that holds the paper's metadata, for an item or its file. */
export function resolveBibliographicItem(
  item: Zotero.Item | null | undefined,
): Zotero.Item | null {
  if (!item) return null;
  try {
    if (item.isRegularItem?.()) return item;
    if (item.isAttachment?.() && item.parentID) {
      const parent = Zotero.Items.get(item.parentID) as Zotero.Item | false;
      if (parent && parent.isRegularItem?.()) return parent;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Title, DOI and arXiv id of a paper, read from its Zotero fields. */
export function readPaperCodeQueryInput(
  item: Zotero.Item,
): PaperCodeQueryInput {
  const title = safeField(item, "title");
  const doi = safeField(item, "DOI");
  const idSources = [
    safeField(item, "archiveID"),
    safeField(item, "url"),
    safeField(item, "extra"),
    /^10\.48550\/arxiv\./i.test(doi) ? doi : "",
  ].join(" ");
  const { arxivId } = extractPaperIdentifiers(idSources);
  // arXiv DOIs are searched through the id, which READMEs quote far more often.
  const plainDoi = /^10\.48550\/arxiv\./i.test(doi) ? "" : doi;
  return { title, doi: plainDoi || null, arxivId: arxivId || null };
}

function cacheKey(input: PaperCodeQueryInput): string {
  return JSON.stringify([input.title || "", input.doi || "", input.arxivId]);
}

/**
 * Search GitHub for one paper, most specific query first.
 *
 * The first query that finds anything wins: an arXiv-id hit is a far better
 * list than the same hits diluted by a title phrase match. A rate limit stops
 * the run at once, since every further query would be refused too.
 */
export async function searchPaperCode(
  input: PaperCodeQueryInput,
): Promise<PaperCodeSearchOutcome> {
  const queries = buildGitHubRepoQueries(input);
  if (!queries.length) return { kind: "no-query" };
  const key = cacheKey(input);
  const cached = resultCache.get(key);
  if (cached && Date.now() - cached.at < RESULT_CACHE_TTL_MS) {
    return { kind: "ok", repositories: cached.repositories };
  }

  let lastError: unknown = null;
  let answered = false;
  for (const query of queries) {
    try {
      const json = await fetchLookupJson(buildGitHubRepoSearchUrl(query), {
        accept: GITHUB_ACCEPT,
      });
      answered = true;
      const repositories = mergeRepositoryLists([
        normalizeGitHubSearchResponse(json),
      ]);
      if (repositories.length) {
        resultCache.set(key, { at: Date.now(), repositories });
        return { kind: "ok", repositories };
      }
    } catch (err) {
      lastError = err;
      if (classifyLookupError(err) === "rate-limited") break;
      // A malformed query (422) fails alone; the next one may still work.
    }
  }
  if (
    lastError &&
    (!answered || classifyLookupError(lastError) === "rate-limited")
  ) {
    return {
      kind: "failed",
      failure: classifyLookupError(lastError),
      waitMinutes: resolveRateLimitWaitMinutes(
        (lastError as LookupHttpError)?.rateLimitReset,
        Date.now(),
      ),
    };
  }
  resultCache.set(key, { at: Date.now(), repositories: [] });
  return { kind: "ok", repositories: [] };
}

/** Notice text for a failed search. */
export function describePaperCodeFailure(
  outcome: Extract<PaperCodeSearchOutcome, { kind: "failed" }>,
): string {
  const labels = getPanelI18n();
  switch (outcome.failure) {
    case "rate-limited":
      return labels.lookupRateLimited("GitHub", outcome.waitMinutes);
    case "offline":
      return labels.lookupOffline("GitHub");
    case "timeout":
      return labels.lookupTimeout("GitHub");
    default:
      return labels.lookupFailed("GitHub");
  }
}

/**
 * Fill the floating result list with repository rows.
 *
 * Rows reuse the figure navigator's classes, so the two lists look and behave
 * alike. Each row is a button carrying `data-repo-url`; the panel's click
 * handler opens it through `Zotero.launchURL`.
 */
export function renderPaperCodeMenu(
  menu: HTMLDivElement,
  rows: CodeRepositoryRow[],
): void {
  const doc = menu.ownerDocument as Document;
  const labels = getPanelI18n();
  menu.innerHTML = "";
  menu.dataset.mode = "code";

  const header = createElement(doc, "div", "llm-figure-menu-header");
  header.append(
    createElement(doc, "span", "llm-figure-menu-title", {
      textContent: labels.paperToCodeTitle,
    }),
    createElement(doc, "span", "llm-figure-menu-count", {
      textContent: labels.paperToCodeCount(rows.length),
    }),
  );
  menu.appendChild(header);
  menu.appendChild(
    createElement(doc, "div", "llm-code-menu-hint", {
      textContent: labels.paperToCodeHint,
    }),
  );

  const list = createElement(doc, "div", "llm-figure-menu-list");
  for (const row of rows) {
    if (!isSafeRepositoryUrl(row.url)) continue;
    const rowEl = createElement(doc, "div", "llm-figure-menu-row");
    const main = createElement(doc, "button", "llm-figure-menu-row-main", {
      type: "button",
      title: row.url,
    }) as HTMLButtonElement;
    main.dataset.repoUrl = row.url;
    main.setAttribute("aria-label", labels.paperToCodeOpenAria(row.name));

    const head = createElement(doc, "span", "llm-figure-row-head");
    head.appendChild(
      createElement(doc, "span", "llm-figure-row-label", {
        textContent: row.name,
      }),
    );
    if (row.language) {
      head.appendChild(
        createElement(doc, "span", "llm-code-row-lang", {
          textContent: row.language,
        }),
      );
    }
    head.appendChild(
      createElement(doc, "span", "llm-figure-row-page", {
        textContent: `★ ${row.starsLabel}`,
      }),
    );
    main.appendChild(head);
    if (row.description) {
      main.appendChild(
        createElement(doc, "span", "llm-figure-row-caption", {
          textContent: row.description,
          title: row.description,
        }),
      );
    }
    rowEl.appendChild(main);
    list.appendChild(rowEl);
  }
  menu.appendChild(list);
}

/** Open a link from the list; only `https://github.com/` URLs are accepted. */
export function openGitHubUrl(url: string): boolean {
  if (!/^https:\/\/github\.com\//i.test(String(url || ""))) return false;
  try {
    Zotero.launchURL(url);
    return true;
  } catch (err) {
    ztoolkit.log("LLM: could not open repository link", err);
    return false;
  }
}
