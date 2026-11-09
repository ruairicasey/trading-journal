/**
 * npm run dev:demo — run the app against the demo database (seeding it first if missing).
 */
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import { applyDemoEnv, DEMO_DB_FILE } from "./demo-env";

const env = applyDemoEnv({ ...process.env });
if (!fs.existsSync(DEMO_DB_FILE)) {
  const r = spawnSync("npx", ["tsx", "scripts/seed-demo.ts"], { stdio: "inherit", env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const args = process.argv.slice(2);
const child = spawn("npx", ["next", ...(args.length ? args : ["dev"])], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
