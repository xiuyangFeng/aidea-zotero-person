import { expect } from "chai";

import {
  EMPTY_GUIDE_ENTRY_TARGETS,
  isEmptyGuideEntryId,
  selectEmptyGuideEntries,
} from "../src/modules/contextPanel/emptyGuide";

describe("empty conversation guide", function () {
  it("leads a reader panel with the briefing and the selection", function () {
    expect(
      selectEmptyGuideEntries({ hasPaper: true, isReader: true }),
    ).to.deep.equal([
      "paper-briefing",
      "ask-selection",
      "annotation-summary",
      "reading-menu",
    ]);
  });

  it("offers no selection action where no reader is open", function () {
    const entries = selectEmptyGuideEntries({
      hasPaper: true,
      isReader: false,
    });
    expect(entries).to.not.include("ask-selection");
    expect(entries).to.include("reading-card");
    expect(entries[0]).to.equal("paper-briefing");
  });

  it("offers only paper-gathering entries without a primary paper", function () {
    for (const isReader of [true, false]) {
      const entries = selectEmptyGuideEntries({ hasPaper: false, isReader });
      expect(entries).to.deep.equal([
        "add-library-items",
        "select-references",
        "reading-menu",
      ]);
    }
  });

  it("keeps every panel between three and four entries", function () {
    for (const hasPaper of [true, false]) {
      for (const isReader of [true, false]) {
        const count = selectEmptyGuideEntries({ hasPaper, isReader }).length;
        expect(count).to.be.within(3, 4);
      }
    }
  });

  it("points every entry at an existing menu row", function () {
    for (const hasPaper of [true, false]) {
      for (const isReader of [true, false]) {
        for (const id of selectEmptyGuideEntries({ hasPaper, isReader })) {
          expect(isEmptyGuideEntryId(id)).to.equal(true);
          if (id === "reading-menu") continue;
          expect(EMPTY_GUIDE_ENTRY_TARGETS[id]).to.match(/^#llm-/);
        }
      }
    }
  });

  it("rejects unknown action ids", function () {
    expect(isEmptyGuideEntryId("delete-everything")).to.equal(false);
    expect(isEmptyGuideEntryId(undefined)).to.equal(false);
    expect(isEmptyGuideEntryId("toString")).to.equal(false);
  });
});
