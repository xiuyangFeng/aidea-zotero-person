import { expect } from "chai";

import {
  isMenuFocusKey,
  resolveMenuFocusIndex,
} from "../src/modules/contextPanel/menuKeyboard";

describe("menu keyboard navigation", function () {
  it("recognizes only the keys it answers for", function () {
    expect(isMenuFocusKey("ArrowDown")).to.equal(true);
    expect(isMenuFocusKey("ArrowUp")).to.equal(true);
    expect(isMenuFocusKey("Home")).to.equal(true);
    expect(isMenuFocusKey("End")).to.equal(true);
    expect(isMenuFocusKey("Enter")).to.equal(false);
    expect(isMenuFocusKey("Escape")).to.equal(false);
  });

  it("enters the list from either end when nothing is focused", function () {
    expect(resolveMenuFocusIndex(4, -1, "ArrowDown")).to.equal(0);
    expect(resolveMenuFocusIndex(4, -1, "ArrowUp")).to.equal(3);
  });

  it("moves one row at a time", function () {
    expect(resolveMenuFocusIndex(4, 1, "ArrowDown")).to.equal(2);
    expect(resolveMenuFocusIndex(4, 2, "ArrowUp")).to.equal(1);
  });

  it("wraps around both ends", function () {
    expect(resolveMenuFocusIndex(4, 3, "ArrowDown")).to.equal(0);
    expect(resolveMenuFocusIndex(4, 0, "ArrowUp")).to.equal(3);
  });

  it("jumps to the ends with Home and End", function () {
    expect(resolveMenuFocusIndex(4, 2, "Home")).to.equal(0);
    expect(resolveMenuFocusIndex(4, 2, "End")).to.equal(3);
  });

  it("treats an out-of-range index as no focus", function () {
    expect(resolveMenuFocusIndex(3, 9, "ArrowDown")).to.equal(0);
    expect(resolveMenuFocusIndex(3, -5, "ArrowUp")).to.equal(2);
  });

  it("reports nothing to focus for an empty menu", function () {
    expect(resolveMenuFocusIndex(0, -1, "ArrowDown")).to.equal(-1);
    expect(resolveMenuFocusIndex(Number.NaN, 0, "End")).to.equal(-1);
  });
});
