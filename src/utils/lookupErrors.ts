/**
 * Classifying failed metadata lookups.
 *
 * The citation importer and the code finder both call public web APIs from
 * inside Zotero, and both need to tell the user something more useful than
 * "failed": whether they are offline, the service was slow, or they have hit a
 * rate limit and should wait. The glue code throws whatever `fetch` throws plus
 * a `status` for non-2xx responses; this module turns that into one of a few
 * kinds the UI has a sentence for. Pure: no DOM, no Zotero.
 */

export type LookupFailureKind =
  "offline" | "timeout" | "rate-limited" | "http" | "unknown";

/** Error thrown by the glue for a response that arrived but was not 2xx. */
export type LookupHttpError = Error & {
  status: number;
  /** Seconds-since-epoch the limit resets, from `x-ratelimit-reset`. */
  rateLimitReset?: number | null;
};

export function createLookupHttpError(
  status: number,
  rateLimitReset?: number | null,
): LookupHttpError {
  const error = new Error(`HTTP ${status}`) as LookupHttpError;
  error.status = status;
  error.rateLimitReset = rateLimitReset ?? null;
  return error;
}

/**
 * Whether an HTTP status means "slow down" rather than "broken".
 *
 * GitHub answers an exhausted unauthenticated quota — and its secondary
 * abuse limit — with 403, everyone else with 429.
 */
export function isRateLimitStatus(status: unknown): boolean {
  return status === 403 || status === 429;
}

export function classifyLookupError(error: unknown): LookupFailureKind {
  if (!error) return "unknown";
  const err = error as { name?: unknown; message?: unknown; status?: unknown };
  const status = typeof err.status === "number" ? err.status : null;
  if (status !== null) {
    return isRateLimitStatus(status) ? "rate-limited" : "http";
  }
  const name = typeof err.name === "string" ? err.name : "";
  const message = typeof err.message === "string" ? err.message : "";
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  if (/time(d)?\s*out/i.test(message)) return "timeout";
  if (
    name === "TypeError" ||
    /NetworkError|Failed to fetch|NS_ERROR_(UNKNOWN_HOST|OFFLINE|CONNECTION_REFUSED|NET_)/i.test(
      message,
    )
  ) {
    return "offline";
  }
  return "unknown";
}

/**
 * Whole minutes until a rate limit resets, at least 1; null when unknown.
 * `resetEpochSeconds` is the `x-ratelimit-reset` header value.
 */
export function resolveRateLimitWaitMinutes(
  resetEpochSeconds: unknown,
  nowMs: number,
): number | null {
  const reset = Number(resetEpochSeconds);
  if (!Number.isFinite(reset) || reset <= 0) return null;
  const deltaMs = reset * 1000 - nowMs;
  if (deltaMs <= 0) return 1;
  return Math.max(1, Math.ceil(deltaMs / 60000));
}
