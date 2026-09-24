import { assert } from "chai";

import {
  AUTO_BRIEFING_MODE_PREF_KEY,
  AUTO_BRIEFING_START_GRACE_MS,
  isAutoBriefingRunOver,
  setAutoBriefingMode,
} from "../src/utils/autoBriefing";

describe("auto briefing cancel notice", function () {
  describe("run watcher", function () {
    const RUNNING = {
      panelConnected: true,
      generating: true,
      sawGenerating: true,
      elapsedMs: 1000,
    };

    it("stays while the briefing is streaming", function () {
      assert.isFalse(isAutoBriefingRunOver(RUNNING));
    });

    it("ends once a request that was seen running stops", function () {
      assert.isTrue(isAutoBriefingRunOver({ ...RUNNING, generating: false }));
    });

    it("waits for a request that has not started yet", function () {
      assert.isFalse(
        isAutoBriefingRunOver({
          ...RUNNING,
          generating: false,
          sawGenerating: false,
          elapsedMs: 500,
        }),
      );
    });

    it("gives up on a request that never started", function () {
      assert.isTrue(
        isAutoBriefingRunOver({
          ...RUNNING,
          generating: false,
          sawGenerating: false,
          elapsedMs: AUTO_BRIEFING_START_GRACE_MS,
        }),
      );
    });

    it("ends when the panel is gone", function () {
      assert.isTrue(
        isAutoBriefingRunOver({ ...RUNNING, panelConnected: false }),
      );
    });
  });

  describe("turning auto mode off", function () {
    let previousZotero: unknown;

    beforeEach(function () {
      previousZotero = (globalThis as any).Zotero;
    });

    afterEach(function () {
      (globalThis as any).Zotero = previousZotero;
    });

    it("writes the normalized mode to the global pref", function () {
      const writes: Array<[string, unknown, unknown]> = [];
      (globalThis as any).Zotero = {
        Prefs: {
          set: (key: string, value: unknown, global: unknown) => {
            writes.push([key, value, global]);
          },
        },
      };
      assert.isTrue(setAutoBriefingMode("manual"));
      assert.lengthOf(writes, 1);
      assert.match(
        writes[0][0],
        new RegExp(`\\.${AUTO_BRIEFING_MODE_PREF_KEY}$`),
      );
      assert.equal(writes[0][1], "manual");
      assert.equal(writes[0][2], true);
    });

    it("reports failure without a Zotero runtime", function () {
      (globalThis as any).Zotero = undefined;
      assert.isFalse(setAutoBriefingMode("manual"));
      (globalThis as any).Zotero = {
        Prefs: {
          set: () => {
            throw new Error("locked");
          },
        },
      };
      assert.isFalse(setAutoBriefingMode("manual"));
    });
  });
});
