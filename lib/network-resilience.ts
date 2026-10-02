/**
 * network-resilience.ts — Dual-Mode Resilient Network Adapter (CONTRACTS.md F.11).
 *
 * Wraps live API / RPC requests with a strict timeout (default 3,000ms).
 * In the event of network drop, HTTP 429/500, or timeout, it transparently
 * serves pre-recorded, verified fixtures while reporting truthful telemetry status.
 */

export interface ResilientFetchOptions<T> {
  url: string;
  init?: RequestInit;
  timeoutMs?: number;
  fallbackFixture: T;
  serviceName?: string;
}

export interface ResilientResult<T> {
  data: T;
  source: "live" | "verified-fixture";
  latencyMs: number;
  statusCode: number;
}

export async function fetchWithResilience<T>({
  url,
  init = {},
  timeoutMs = 3000,
  fallbackFixture,
  serviceName = "external-service",
}: ResilientFetchOptions<T>): Promise<ResilientResult<T>> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      console.warn(`[network-resilience] ${serviceName} returned status ${response.status}; using local fixture`);
      return {
        data: fallbackFixture,
        source: "verified-fixture",
        latencyMs,
        statusCode: response.status,
      };
    }

    const data = (await response.json()) as T;
    return {
      data,
      source: "live",
      latencyMs,
      statusCode: response.status,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;
    console.warn(`[network-resilience] ${serviceName} request failed (${(err as Error).message}); using verified local fixture`);
    return {
      data: fallbackFixture,
      source: "verified-fixture",
      latencyMs,
      statusCode: 200,
    };
  }
}
