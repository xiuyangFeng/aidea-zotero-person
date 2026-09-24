/**
 * Presentation helpers for the "scan local services" card in the settings page.
 *
 * The probing itself lives in `src/utils/localLlmDiscovery.ts`; this file only
 * formats and orders what came back, so it stays pure and testable.
 */

import {
  COMMON_LOCAL_ENDPOINTS,
  type DiscoveredLocalService,
  type LocalEndpointConfig,
} from "../../utils/localLlmDiscovery";

/** `http://127.0.0.1:11434/v1` → `11434` (empty when the URL has no port). */
export function getEndpointPort(apiBase: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/:]+:(\d+)/i.exec(
    String(apiBase ?? "").trim(),
  );
  return match ? match[1] : "";
}

/** Comma-separated port list shown when a scan finds nothing. */
export function formatScannedPorts(
  endpoints: readonly LocalEndpointConfig[] = COMMON_LOCAL_ENDPOINTS,
): string {
  const ports: string[] = [];
  for (const endpoint of endpoints) {
    const port = getEndpointPort(endpoint.apiBase);
    if (port && !ports.includes(port)) ports.push(port);
  }
  return ports.join(", ");
}

/**
 * Most useful result first: services that actually reported models, then the
 * fastest to answer, then alphabetically so the order never flickers.
 */
export function sortDiscoveredServices(
  services: readonly DiscoveredLocalService[],
): DiscoveredLocalService[] {
  return [...services].sort((a, b) => {
    const aHasModels = a.models.length > 0 ? 1 : 0;
    const bHasModels = b.models.length > 0 ? 1 : 0;
    if (aHasModels !== bHasModels) return bHasModels - aHasModels;
    if (a.models.length !== b.models.length) {
      return b.models.length - a.models.length;
    }
    if (a.latencyMs !== b.latencyMs) return a.latencyMs - b.latencyMs;
    return a.serviceType.localeCompare(b.serviceType);
  });
}

/** `12` → `12 ms`, `1530` → `1.5 s`. */
export function formatLatency(latencyMs: number): string {
  const value = Number(latencyMs);
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

/**
 * Secondary line of a result row, e.g. `3 models · 12 ms`.
 * `modelCountTemplate` follows the `{n}` convention used elsewhere in the
 * settings dictionaries.
 */
export function formatServiceMeta(
  service: DiscoveredLocalService,
  modelCountTemplate: string,
): string {
  const models = String(modelCountTemplate ?? "").replace(
    "{n}",
    String(service.models.length),
  );
  return `${models} · ${formatLatency(service.latencyMs)}`;
}
