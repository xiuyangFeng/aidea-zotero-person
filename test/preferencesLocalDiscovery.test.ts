import { expect } from "chai";
import {
  formatLatency,
  formatScannedPorts,
  formatServiceMeta,
  getEndpointPort,
  sortDiscoveredServices,
} from "../src/modules/preferences/localDiscovery";
import type { DiscoveredLocalService } from "../src/utils/localLlmDiscovery";

const service = (
  overrides: Partial<DiscoveredLocalService>,
): DiscoveredLocalService => ({
  serviceType: "Ollama",
  apiBase: "http://127.0.0.1:11434/v1",
  models: [],
  latencyMs: 10,
  ...overrides,
});

describe("local service scan formatting", function () {
  it("extracts ports and lists the scanned defaults", function () {
    expect(getEndpointPort("http://127.0.0.1:11434/v1")).to.equal("11434");
    expect(getEndpointPort("https://localhost:1234")).to.equal("1234");
    expect(getEndpointPort("http://localhost/v1")).to.equal("");
    expect(getEndpointPort("")).to.equal("");
    expect(formatScannedPorts()).to.equal("11434, 1234, 8080, 8000, 5000");
    expect(
      formatScannedPorts([
        { serviceType: "Custom", apiBase: "http://127.0.0.1:9000/v1" },
        { serviceType: "Custom", apiBase: "http://127.0.0.1:9000/v1" },
      ]),
    ).to.equal("9000");
  });

  it("puts services that reported models first, then the fastest", function () {
    const sorted = sortDiscoveredServices([
      service({ serviceType: "vLLM", models: [], latencyMs: 5 }),
      service({ serviceType: "LM Studio", models: ["a"], latencyMs: 90 }),
      service({ serviceType: "Ollama", models: ["a", "b"], latencyMs: 40 }),
      service({ serviceType: "LocalAI", models: ["a", "b"], latencyMs: 12 }),
    ]);
    expect(sorted.map((entry) => entry.serviceType)).to.deep.equal([
      "LocalAI",
      "Ollama",
      "LM Studio",
      "vLLM",
    ]);
  });

  it("does not mutate the input array", function () {
    const input = [
      service({ serviceType: "vLLM", models: [] }),
      service({ serviceType: "Ollama", models: ["a"] }),
    ];
    sortDiscoveredServices(input);
    expect(input.map((entry) => entry.serviceType)).to.deep.equal([
      "vLLM",
      "Ollama",
    ]);
  });

  it("formats latency and the result meta line", function () {
    expect(formatLatency(12)).to.equal("12 ms");
    expect(formatLatency(999)).to.equal("999 ms");
    expect(formatLatency(1530)).to.equal("1.5 s");
    expect(formatLatency(Number.NaN)).to.equal("—");
    expect(
      formatServiceMeta(
        service({ models: ["a", "b"], latencyMs: 12 }),
        "{n} models",
      ),
    ).to.equal("2 models · 12 ms");
    expect(
      formatServiceMeta(service({ models: [], latencyMs: 2000 }), "{n} 个模型"),
    ).to.equal("0 个模型 · 2.0 s");
  });
});
