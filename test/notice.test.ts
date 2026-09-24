import { expect } from "chai";

import {
  NOTICE_AUTO_DISMISS_MS,
  STATUS_NOTICE_SOURCE,
  noticeAriaLive,
  noticeKindForStatus,
  resolveNoticeDismissDelay,
  routeStatusToNotice,
  shouldStatusRetireNotice,
} from "../src/modules/contextPanel/notice";

describe("inline notice policy", function () {
  it("mirrors only warnings and errors from the status line", function () {
    expect(noticeKindForStatus("error")).to.equal("error");
    expect(noticeKindForStatus("warning")).to.equal("warning");
    expect(noticeKindForStatus("ready")).to.equal(null);
    expect(noticeKindForStatus("sending")).to.equal(null);
  });

  it("auto-dismisses info and success notices", function () {
    expect(resolveNoticeDismissDelay({ kind: "info" })).to.equal(
      NOTICE_AUTO_DISMISS_MS,
    );
    expect(resolveNoticeDismissDelay({ kind: "success" })).to.equal(
      NOTICE_AUTO_DISMISS_MS,
    );
    expect(NOTICE_AUTO_DISMISS_MS).to.be.within(3000, 6000);
  });

  it("keeps warnings and errors until closed or replaced", function () {
    expect(resolveNoticeDismissDelay({ kind: "warning" })).to.equal(0);
    expect(resolveNoticeDismissDelay({ kind: "error" })).to.equal(0);
  });

  it("keeps a notice that is persistent or carries actions", function () {
    expect(resolveNoticeDismissDelay({ kind: "info", persist: true })).to.equal(
      0,
    );
    expect(
      resolveNoticeDismissDelay({ kind: "success", hasActions: true }),
    ).to.equal(0);
  });

  it("retires a mirrored notice only when a new request starts", function () {
    expect(shouldStatusRetireNotice("sending", STATUS_NOTICE_SOURCE)).to.equal(
      true,
    );
    expect(shouldStatusRetireNotice("ready", STATUS_NOTICE_SOURCE)).to.equal(
      false,
    );
    expect(shouldStatusRetireNotice("sending", "auto-briefing")).to.equal(
      false,
    );
    expect(shouldStatusRetireNotice("sending", null)).to.equal(false);
  });

  it("announces errors assertively and everything else politely", function () {
    expect(noticeAriaLive("error")).to.equal("assertive");
    expect(noticeAriaLive("warning")).to.equal("polite");
    expect(noticeAriaLive("info")).to.equal("polite");
  });

  it("never throws when the status element has no notice slot", function () {
    expect(() => routeStatusToNotice(null, "x", "error")).to.not.throw();
    const orphan = {
      id: "llm-status",
      closest: () => null,
      querySelector: () => null,
    } as unknown as Element;
    expect(() => routeStatusToNotice(orphan, "x", "error")).to.not.throw();
    expect(() => routeStatusToNotice(orphan, "x", "sending")).to.not.throw();
  });
});
