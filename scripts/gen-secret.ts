/**
 * npm run gen-secret — prints fresh random values for AUTH_SECRET, CRON_SECRET and CTRADER_TOKEN_KEY.
 * Paste them into Vercel (Production only) / GitHub Actions secrets. Never into chat or a commit.
 */
import { randomBytes } from "node:crypto";

const secret = () => randomBytes(48).toString("base64url");
console.log("\nAUTH_SECRET=" + secret());
console.log("CRON_SECRET=" + secret());
console.log("CTRADER_TOKEN_KEY=" + secret() + "\n");
console.log("Use each value in exactly one place (see docs/deploy.md). Re-run for new values.\n");
