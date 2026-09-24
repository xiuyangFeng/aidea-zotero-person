/**
 * Local LLM Auto-Discovery — automated local port probing and model enumeration.
 *
 * Scans standard local ports (Ollama, LM Studio, vLLM, LocalAI) and fetches
 * available model catalogs to enable zero-configuration local AI workflows.
 */

export type LocalServiceType =
  "Ollama" | "LM Studio" | "LocalAI" | "vLLM" | "TextGen" | "Custom";

export interface LocalEndpointConfig {
  serviceType: LocalServiceType;
  apiBase: string;
}

export interface DiscoveredLocalService {
  serviceType: LocalServiceType;
  apiBase: string;
  models: string[];
  latencyMs: number;
}

export const COMMON_LOCAL_ENDPOINTS: readonly LocalEndpointConfig[] = [
  { serviceType: "Ollama", apiBase: "http://127.0.0.1:11434/v1" },
  { serviceType: "LM Studio", apiBase: "http://127.0.0.1:1234/v1" },
  { serviceType: "LocalAI", apiBase: "http://127.0.0.1:8080/v1" },
  { serviceType: "vLLM", apiBase: "http://127.0.0.1:8000/v1" },
  { serviceType: "TextGen", apiBase: "http://127.0.0.1:5000/v1" },
];

/**
 * Parses model identifiers from standard OpenAI `/v1/models` or Ollama `/api/tags` formats.
 */
export function parseLocalModelsResponse(data: any): string[] {
  if (!data || typeof data !== "object") return [];

  // OpenAI format: { data: [{ id: "llama3" }] } or { data: ["llama3"] }
  if (Array.isArray(data.data)) {
    return data.data
      .map((item: any) => (typeof item === "string" ? item : item?.id))
      .filter(
        (id: any): id is string => typeof id === "string" && Boolean(id.trim()),
      );
  }

  // Ollama native format: { models: [{ name: "llama3:latest" }] }
  if (Array.isArray(data.models)) {
    return data.models
      .map((item: any) =>
        typeof item === "string" ? item : item?.name || item?.id,
      )
      .filter(
        (id: any): id is string => typeof id === "string" && Boolean(id.trim()),
      );
  }

  return [];
}

/**
 * Probes an individual endpoint for active service and model list.
 */
export async function probeLocalEndpoint(
  endpoint: LocalEndpointConfig,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<DiscoveredLocalService | null> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const modelsUrl = `${endpoint.apiBase.replace(/\/+$/, "")}/models`;
    const res = await fetchFn(modelsUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return null;
    const json = await res.json();
    const models = parseLocalModelsResponse(json);
    const latencyMs = Date.now() - start;

    return {
      serviceType: endpoint.serviceType,
      apiBase: endpoint.apiBase,
      models,
      latencyMs,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Concurrently discovers all active local LLM services across standard ports.
 */
export async function discoverLocalLlmServices(
  endpoints: readonly LocalEndpointConfig[] = COMMON_LOCAL_ENDPOINTS,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<DiscoveredLocalService[]> {
  const promises = endpoints.map((ep) =>
    probeLocalEndpoint(ep, fetchFn, timeoutMs),
  );
  const results = await Promise.all(promises);
  return results.filter((r): r is DiscoveredLocalService => r !== null);
}
