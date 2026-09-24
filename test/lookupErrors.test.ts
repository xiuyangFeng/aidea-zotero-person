import { expect } from "chai";
import {
  classifyLookupError,
  createLookupHttpError,
  isRateLimitStatus,
  resolveRateLimitWaitMinutes,
} from "../src/utils/lookupErrors";

describe("lookup errors", function () {
  it("classifies GitHub 403 and generic 429 as rate limits", function () {
    expect(isRateLimitStatus(403)).to.equal(true);
    expect(isRateLimitStatus(429)).to.equal(true);
    expect(isRateLimitStatus(500)).to.equal(false);
    expect(classifyLookupError(createLookupHttpError(403))).to.equal(
      "rate-limited",
    );
    expect(classifyLookupError(createLookupHttpError(429))).to.equal(
      "rate-limited",
    );
    expect(classifyLookupError(createLookupHttpError(503))).to.equal("http");
  });

  it("classifies aborts as timeouts and fetch TypeErrors as offline", function () {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(classifyLookupError(abort)).to.equal("timeout");
    expect(
      classifyLookupError(
        new TypeError("NetworkError when attempting to fetch resource."),
      ),
    ).to.equal("offline");
    expect(classifyLookupError(new Error("NS_ERROR_UNKNOWN_HOST"))).to.equal(
      "offline",
    );
    expect(classifyLookupError(new Error("weird"))).to.equal("unknown");
    expect(classifyLookupError(null)).to.equal("unknown");
  });

  it("keeps the rate-limit reset on the error", function () {
    const err = createLookupHttpError(403, 1700000000);
    expect(err.status).to.equal(403);
    expect(err.rateLimitReset).to.equal(1700000000);
    expect(err.message).to.equal("HTTP 403");
  });

  it("computes whole minutes until the limit resets", function () {
    const now = 1_700_000_000_000;
    expect(resolveRateLimitWaitMinutes(now / 1000 + 30, now)).to.equal(1);
    expect(resolveRateLimitWaitMinutes(now / 1000 + 125, now)).to.equal(3);
    expect(resolveRateLimitWaitMinutes(now / 1000 - 10, now)).to.equal(1);
    expect(resolveRateLimitWaitMinutes(null, now)).to.equal(null);
    expect(resolveRateLimitWaitMinutes("abc", now)).to.equal(null);
  });
});
