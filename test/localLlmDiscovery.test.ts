import { expect } from "chai";
import {
  parseLocalModelsResponse,
  probeLocalEndpoint,
  discoverLocalLlmServices,
  type LocalEndpointConfig,
} from "../src/utils/localLlmDiscovery";

describe("local LLM auto-discovery", function () {
  it("parses OpenAI-format models response", function () {
    const openaiJson = {
      object: "list",
      data: [
        { id: "llama3:8b", object: "model" },
        { id: "qwen2.5:14b", object: "model" },
      ],
    };

    const models = parseLocalModelsResponse(openaiJson);
    expect(models).to.deep.equal(["llama3:8b", "qwen2.5:14b"]);
  });

  it("parses Ollama native tags format response", function () {
    const ollamaJson = {
      models: [{ name: "deepseek-r1:7b" }, { name: "mistral-nemo:latest" }],
    };

    const models = parseLocalModelsResponse(ollamaJson);
    expect(models).to.deep.equal(["deepseek-r1:7b", "mistral-nemo:latest"]);
  });

  it("handles empty or invalid model responses gracefully", function () {
    expect(parseLocalModelsResponse(null)).to.deep.equal([]);
    expect(parseLocalModelsResponse({})).to.deep.equal([]);
    expect(parseLocalModelsResponse("invalid")).to.deep.equal([]);
  });

  it("probes active endpoint with mock fetch successfully", async function () {
    const mockFetch = async () =>
      ({
        ok: true,
        json: async () => ({ data: [{ id: "llama3" }] }),
      }) as any;

    const endpoint: LocalEndpointConfig = {
      serviceType: "Ollama",
      apiBase: "http://127.0.0.1:11434/v1",
    };

    const service = await probeLocalEndpoint(endpoint, mockFetch);
    expect(service).to.not.be.null;
    expect(service?.serviceType).to.equal("Ollama");
    expect(service?.models).to.deep.equal(["llama3"]);
  });

  it("discovers active services while ignoring inactive ports", async function () {
    const mockFetch = async (url: string) => {
      if (url.includes("11434")) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: "ollama-model" }] }),
        } as any;
      }
      throw new Error("Connection refused");
    };

    const endpoints: LocalEndpointConfig[] = [
      { serviceType: "Ollama", apiBase: "http://127.0.0.1:11434/v1" },
      { serviceType: "LM Studio", apiBase: "http://127.0.0.1:1234/v1" },
    ];

    const discovered = await discoverLocalLlmServices(
      endpoints,
      mockFetch as any,
    );
    expect(discovered.length).to.equal(1);
    expect(discovered[0].serviceType).to.equal("Ollama");
    expect(discovered[0].models).to.deep.equal(["ollama-model"]);
  });
});
