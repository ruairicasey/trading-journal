import { execFileSync } from "node:child_process";
import { test } from "vitest";

test("privacy guard self-test passes", () => {
  execFileSync("node", ["scripts/check-secrets.mjs", "--self-test"], { stdio: "pipe" });
});
