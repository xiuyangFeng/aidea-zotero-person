/**
 * JSON GET with a timeout, for the public metadata APIs the panel calls
 * (Crossref, OpenAlex, GitHub search). Requests are anonymous: no token, no
 * cookie, nothing stored. A non-2xx answer is thrown as a `LookupHttpError`
 * carrying the status and GitHub's rate-limit reset, so callers can classify
 * it with `classifyLookupError`.
 */

import { createLookupHttpError } from "../../utils/lookupErrors";

export const LOOKUP_FETCH_TIMEOUT_MS = 12000;

export async function fetchLookupJson(
  url: string,
  options?: { accept?: string; timeoutMs?: number },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? LOOKUP_FETCH_TIMEOUT_MS,
  );
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      credentials: "omit",
      headers: { Accept: options?.accept || "application/json" },
    });
    if (!res.ok) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      throw createLookupHttpError(
        res.status,
        Number.isFinite(reset) && reset > 0 ? reset : null,
      );
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
