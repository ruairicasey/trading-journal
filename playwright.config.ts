import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests run against the SYNTHETIC demo account (npm run dev:demo), never real data.
 * Run: npm run test:e2e
 */
const PORT = 3110;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx tsx scripts/seed-demo.ts && npx tsx scripts/with-demo.ts dev -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/trades`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
