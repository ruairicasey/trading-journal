import { getConfig } from "../config";
import { createLighterClient, type LighterClient } from "./client";

const g = globalThis as unknown as { __lighterClient?: LighterClient };

/** Process-wide client so the rate limiter is shared across requests. */
export function getLighterClient(): LighterClient {
  return (g.__lighterClient ??= createLighterClient({ apiUrl: getConfig().lighter.apiUrl }));
}
