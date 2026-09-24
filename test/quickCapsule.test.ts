import { expect } from "chai";
import {
  CAPSULE_ACTIONS,
  detectTextFeatures,
  recommendCapsuleActions,
} from "../src/utils/quickCapsule";

describe("quick capsule action helpers", function () {
  it("defines all core action kinds with labels and icons", function () {
    expect(CAPSULE_ACTIONS.translate.icon).to.equal("🔤");
    expect(CAPSULE_ACTIONS.dissect.label["zh-CN"]).to.equal("长难句解构");
    expect(CAPSULE_ACTIONS.algorithm.label["en-US"]).to.equal("Step Trace");
  });

  it("detects formula text and prioritizes formula action", function () {
    const formulaText =
      "$$\\mathcal{L}_{\\text{adv}} = \\mathbb{E}[\\log D(x)]$$";
    const features = detectTextFeatures(formulaText);
    expect(features.isFormula).to.be.true;

    const recommended = recommendCapsuleActions(formulaText);
    expect(recommended[0]).to.equal("formula");
  });

  it("detects algorithm text and prioritizes algorithm action", function () {
    const algoText =
      "Algorithm 1: Policy Gradient\nInput: learning rate alpha\nfor each step do\n  update policy";
    const features = detectTextFeatures(algoText);
    expect(features.isAlgorithm).to.be.true;

    const recommended = recommendCapsuleActions(algoText);
    expect(recommended[0]).to.equal("algorithm");
  });

  it("detects long sentences and prioritizes dissect action", function () {
    const longSentence =
      "While existing benchmark suites offer comprehensive evaluations across standard vision domains, their reliance on homogeneous distribution assumptions prevents rigorous stress-testing against catastrophic covariate shifts in production.";
    const features = detectTextFeatures(longSentence);
    expect(features.isLongSentence).to.be.true;

    const recommended = recommendCapsuleActions(longSentence);
    expect(recommended[0]).to.equal("dissect");
  });

  it("detects short terms and prioritizes concept card action", function () {
    const term = "LoRA adapter";
    const features = detectTextFeatures(term);
    expect(features.isShortTerm).to.be.true;

    const recommended = recommendCapsuleActions(term);
    expect(recommended[0]).to.equal("concept");
  });
});
