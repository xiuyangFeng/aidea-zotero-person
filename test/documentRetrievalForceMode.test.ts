import { assert } from "chai";
import {
  buildDocumentContext,
  createDocumentTextContext,
} from "../src/modules/contextPanel/document/retrieval";

const originalZtoolkit = (globalThis as Record<string, unknown>).ztoolkit;

/** Long enough to produce several chunks, with one clearly on-topic section. */
function buildSampleText(): string {
  const filler = Array.from(
    { length: 40 },
    (_v, index) =>
      `Section ${index} discusses unrelated background material about instrumentation and calibration procedures used by the laboratory.`,
  );
  filler.splice(
    20,
    0,
    "The randomized controlled trial enrolled 480 participants and reported a mortality reduction of 12 percent.",
  );
  return filler.join("\n\n");
}

describe("buildDocumentContext force-retrieval mode", function () {
  beforeEach(function () {
    (globalThis as Record<string, unknown>).ztoolkit = { log: () => undefined };
  });

  afterEach(function () {
    if (originalZtoolkit === undefined) {
      delete (globalThis as Record<string, unknown>).ztoolkit;
    } else {
      (globalThis as Record<string, unknown>).ztoolkit = originalZtoolkit;
    }
  });

  const context = () =>
    createDocumentTextContext({
      title: "Sample Paper",
      text: buildSampleText(),
      kind: "pdf",
    });

  it("sends the whole document when the adapter allows it", async function () {
    const output = await buildDocumentContext(
      context(),
      "what was the mortality reduction?",
      false,
      undefined,
      { contextStrategy: "full-or-retrieval", useEmbeddings: false },
    );
    assert.include(output, "Full document content provided");
  });

  it("skips the whole-document branch when retrieval is forced", async function () {
    const output = await buildDocumentContext(
      context(),
      "what was the mortality reduction?",
      false,
      undefined,
      {
        contextStrategy: "full-or-retrieval",
        useEmbeddings: false,
        forceRetrieval: true,
      },
    );
    assert.notInclude(output, "Full document content provided");
    // The query-relevant passage must still survive retrieval.
    assert.include(output, "mortality reduction of 12 percent");
  });

  it("honours the length budget once retrieval is forced", async function () {
    const budget = 2000;
    const output = await buildDocumentContext(
      context(),
      "what was the mortality reduction?",
      false,
      undefined,
      {
        contextStrategy: "full-or-retrieval",
        useEmbeddings: false,
        forceRetrieval: true,
        maxChunks: 2,
        maxLength: budget,
      },
    );
    const fullLength = buildSampleText().length;
    assert.isBelow(output.length, fullLength);
  });
});
