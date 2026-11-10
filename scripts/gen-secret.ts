/**
 * npm run gen-secret — prints fresh random values for AUTH_SECRET and CRON_SECRET.
 * Paste them into Vercel (Production only) / GitHub Actions secrets. Never into chat or a commit.
 */
import { randomBytes } from "node:crypto";

const secret = () => randomBytes(48).toString("base64url");
console.log("\nAUTH_SECRET=" + secret());
console.log("CRON_SECRET=" + secret() + "\n");
console.log("Use each value in exactly one place (see docs/deploy.md). Re-run for new values.\n");
