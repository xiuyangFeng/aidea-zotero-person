import { assert } from "chai";

import {
  normalizeSelectionBilingual,
  normalizeSelectionSourceText,
  resolveSelectionBilingualViewState,
  toggleSelectionBilingual,
} from "../src/modules/contextPanel/selectionTranslateBilingual";
import { getSelectionTranslateSourceMaxHeight } from "../src/modules/contextPanel/selectionTranslatePopupSize";

const labels = {
  showSource: "Show the original text",
  hideSource: "Hide the original text",
};

describe("selection translation bilingual mode", function () {
  describe("normalizeSelectionBilingual", function () {
    it("defaults to monolingual so existing readers see no change", function () {
      assert.isFalse(normalizeSelectionBilingual(undefined));
      assert.isFalse(normalizeSelectionBilingual(""));
      assert.isFalse(normalizeSelectionBilingual(null));
    });

    it("reads the string forms a preference can come back as", function () {
      assert.isTrue(normalizeSelectionBilingual("true"));
      assert.isTrue(normalizeSelectionBilingual("1"));
      assert.isTrue(normalizeSelectionBilingual(" ON "));
      assert.isFalse(normalizeSelectionBilingual("false"));
      assert.isFalse(normalizeSelectionBilingual("0"));
      assert.isFalse(normalizeSelectionBilingual("off"));
    });

    it("keeps booleans and falls back on nonsense", function () {
      assert.isTrue(normalizeSelectionBilingual(true));
      assert.isFalse(normalizeSelectionBilingual(false));
      assert.isTrue(normalizeSelectionBilingual("maybe", true));
      assert.isFalse(normalizeSelectionBilingual("maybe", false));
    });
  });

  describe("toggleSelectionBilingual", function () {
    it("flips a stored value whatever shape it had", function () {
      assert.isTrue(toggleSelectionBilingual(false));
      assert.isFalse(toggleSelectionBilingual(true));
      assert.isTrue(toggleSelectionBilingual(""));
      assert.isFalse(toggleSelectionBilingual("1"));
    });

    it("round-trips back to where it started", function () {
      assert.isFalse(toggleSelectionBilingual(toggleSelectionBilingual(false)));
    });
  });

  describe("normalizeSelectionSourceText", function () {
    it("keeps line breaks but drops carriage returns and trailing blanks", function () {
      assert.equal(
        normalizeSelectionSourceText("  first line   \r\n second line \r\n"),
        "first line\n second line",
      );
    });

    it("collapses runs of blank lines a PDF layer emits", function () {
      assert.equal(normalizeSelectionSourceText("a\n\n\n\n\nb"), "a\n\nb");
    });

    it("treats a blank selection as no source text", function () {
      assert.equal(normalizeSelectionSourceText("  \n\t "), "");
      assert.equal(normalizeSelectionSourceText(undefined), "");
    });
  });

  describe("resolveSelectionBilingualViewState", function () {
    it("shows the source block and offers to hide it when on", function () {
      const state = resolveSelectionBilingualViewState({
        bilingual: true,
        sourceText: "The GAN objective\r\nis unstable.",
        labels,
      });

      assert.isTrue(state.bilingual);
      assert.isTrue(state.showSourceBlock);
      assert.isTrue(state.togglePressed);
      assert.equal(state.sourceText, "The GAN objective\nis unstable.");
      assert.equal(state.toggleLabel, labels.hideSource);
    });

    it("hides the source block and offers to show it when off", function () {
      const state = resolveSelectionBilingualViewState({
        bilingual: false,
        sourceText: "The GAN objective is unstable.",
        labels,
      });

      assert.isFalse(state.showSourceBlock);
      assert.isFalse(state.togglePressed);
      assert.equal(state.toggleLabel, labels.showSource);
      assert.equal(
        state.sourceText,
        "The GAN objective is unstable.",
        "the text stays resolved so a later toggle needs no re-read",
      );
    });

    it("never renders an empty bordered block", function () {
      const state = resolveSelectionBilingualViewState({
        bilingual: true,
        sourceText: "   ",
        labels,
      });

      assert.isTrue(state.bilingual);
      assert.isFalse(state.showSourceBlock);
      assert.equal(state.toggleLabel, labels.hideSource);
    });

    it("reads a preference-shaped string as the mode", function () {
      assert.isTrue(
        resolveSelectionBilingualViewState({
          bilingual: "true",
          sourceText: "text",
          labels,
        }).showSourceBlock,
      );
    });
  });

  describe("getSelectionTranslateSourceMaxHeight", function () {
    it("takes a slice of the viewer and stops at the cap", function () {
      assert.equal(
        getSelectionTranslateSourceMaxHeight({
          viewerHeight: 400,
          minimumHeight: 44,
        }),
        88,
      );
      assert.equal(
        getSelectionTranslateSourceMaxHeight({
          viewerHeight: 1200,
          minimumHeight: 44,
        }),
        180,
        "a tall viewer must not hand the whole popup to the source",
      );
    });

    it("always leaves room for one complete line", function () {
      assert.equal(
        getSelectionTranslateSourceMaxHeight({
          viewerHeight: 100,
          minimumHeight: 44,
        }),
        44,
      );
      assert.equal(
        getSelectionTranslateSourceMaxHeight({
          viewerHeight: 0,
          minimumHeight: 44,
        }),
        44,
      );
    });

    it("accepts an explicit ratio and cap", function () {
      assert.equal(
        getSelectionTranslateSourceMaxHeight({
          viewerHeight: 600,
          minimumHeight: 44,
          ratio: 0.5,
          cap: 500,
        }),
        300,
      );
    });
  });
});
