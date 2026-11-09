import { getConfig } from "../config";
import { createHlClient, type HlClient } from "./client";

const g = globalThis as unknown as { __hlClient?: HlClient };

/** Process-wide client so the rate limiter is shared across requests. */
export function getHlClient(): HlClient {
  return (g.__hlClient ??= createHlClient({ apiUrl: getConfig().hyperliquid.apiUrl }));
}
