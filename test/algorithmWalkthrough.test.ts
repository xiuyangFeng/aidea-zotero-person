import { expect } from "chai";
import {
  extractAlgorithms,
  buildAlgorithmWalkthroughPrompt,
} from "../src/utils/algorithmWalkthrough";

describe("algorithm walkthrough", function () {
  it("extracts algorithm block from text", function () {
    const raw = `
Algorithm 1: FlashAttention Forward Pass
Input: Q, K, V in Rd, block sizes Br, Bc
Output: O in Rd, L in R
1: Initialize O = (0), l = (0), m = (-inf)
2: for block j = 1 to Tc do
3:   Load Kj, Vj from HBM to SRAM
    `;

    const algos = extractAlgorithms(raw);
    expect(algos.length).to.be.greaterThan(0);
    expect(algos[0]).to.include("Algorithm 1: FlashAttention");
    expect(algos[0]).to.include("Initialize O = (0)");
  });

  it("builds walkthrough prompt in English", function () {
    const prompt = buildAlgorithmWalkthroughPrompt({
      algorithmText:
        "Algorithm 1: Gradient Descent\nInput: lr, params\n1: params = params - lr * grad",
      paperContext: "Optimization section",
      lang: "en-US",
    });

    expect(prompt).to.include("Toy Example Step-by-Step Trace");
    expect(prompt).to.include("Gradient Descent");
    expect(prompt).to.include("Optimization section");
  });

  it("builds walkthrough prompt in Chinese", function () {
    const prompt = buildAlgorithmWalkthroughPrompt({
      algorithmText: "Algorithm 2: Beam Search\nInput: beam_size B",
      lang: "zh-CN",
    });

    expect(prompt).to.include("微型数据玩具样例跟踪");
    expect(prompt).to.include("核心设计直觉");
  });
});
