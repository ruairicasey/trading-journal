#!/usr/bin/env node
/**
 * Privacy guard. Blocks commits that would leak personal data into this public repo.
 *
 *   node scripts/check-secrets.mjs --staged   # pre-commit (husky): checks staged content
 *   node scripts/check-secrets.mjs --all      # CI: checks every tracked file
 *   node scripts/check-secrets.mjs --self-test
 *
 * Blocks:
 *   - env files, database files, anything under data/ uploads/ exports/ backups/
 *   - 0x-prefixed 40-hex addresses outside tests/fixtures/ (placeholder 0x000…000NNNN allowed)
 *   - 64-hex strings (possible private keys) outside tests/fixtures/
 *   - bcrypt hashes, JWT-looking tokens, populated secret env assignments
 * A single line can be exempted with the marker `secret-check:allow` (use sparingly).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const BLOCKED_PATHS = [
  { re: /(^|\/)\.env(\..+)?$/, why: "env file", allow: /(^|\/)\.env\.example$/ },
  { re: /\.(db|sqlite|sqlite3)(-journal|-wal|-shm)?$/i, why: "database file" },
  { re: /\.db[-.]/i, why: "database file" },
  { re: /(^|\/)(data|uploads|exports|backups|logs|private-docs)\//, why: "private data directory" },
  { re: /\.(log|csv|zip)$/i, why: "log/export/archive file" },
  { re: /\.pdf$/i, why: "export file", allow: /^docs\// },
  { re: /(^|\/)hl-dump|\.dump\.json$/i, why: "raw API dump" },
  { re: /\.(pem|key)$/i, why: "key file" },
];

const FIXTURE_DIR = /^tests\/fixtures\//;
// Placeholder addresses: at least 30 leading zeros after 0x.
const PLACEHOLDER_ADDR = /^0x0{30}[0-9a-f]{10}$/i;

const CONTENT_RULES = [
  {
    name: "wallet address (0x + 40 hex)",
    re: /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g,
    fixturesOk: true,
    allowMatch: (m) => PLACEHOLDER_ADDR.test(m),
  },
  {
    name: "64-hex string (possible private key / tx hash)",
    re: /(?<![0-9a-zA-Z])(0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/g,
    fixturesOk: true,
    allowMatch: (m) => /^(0x)?0+[0-9a-f]{0,8}$/i.test(m),
  },
  { name: "bcrypt hash", re: /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g },
  { name: "JWT / bearer token", re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    name: "populated secret variable",
    re: /\b(AUTH_SECRET|AUTH_PASSWORD_HASH|CRON_SECRET|DATABASE_AUTH_TOKEN|R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID|HL_WALLET_ADDRESS)\s*[=:]\s*["']?(?!\$\{|process\.env|<)[^\s"'#()\[\]{},;]{8,}/g,
  },
];

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|eot|mp4|mov|wasm)$/i;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function listFiles(mode) {
  if (mode === "staged") {
    return git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]).split("\0").filter(Boolean);
  }
  return git(["ls-files", "-z"]).split("\0").filter(Boolean);
}

function readContent(mode, path) {
  try {
    if (mode === "staged") return git(["show", `:${path}`]);
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  } catch {
    return "";
  }
}

export function checkPath(path) {
  const problems = [];
  for (const rule of BLOCKED_PATHS) {
    if (rule.re.test(path) && !(rule.allow && rule.allow.test(path))) {
      problems.push(`${path}: ${rule.why} must never be committed`);
    }
  }
  return problems;
}

export function checkContent(path, content) {
  if (BINARY_EXT.test(path) || content.includes("\0")) return [];
  const inFixtures = FIXTURE_DIR.test(path);
  const problems = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes("secret-check:allow")) return;
    for (const rule of CONTENT_RULES) {
      if (rule.fixturesOk && inFixtures) continue;
      for (const m of line.matchAll(rule.re)) {
        if (rule.allowMatch && rule.allowMatch(m[0])) continue;
        const shown = m[0].length > 14 ? `${m[0].slice(0, 6)}…${m[0].slice(-4)}` : "…";
        problems.push(`${path}:${i + 1}: ${rule.name} (${shown})`);
      }
    }
  });
  return problems;
}

function selfTest() {
  const a = (cond, msg) => {
    if (!cond) {
      console.error("self-test FAILED:", msg);
      process.exit(1);
    }
  };
  const fakeAddr = "0x" + "ab12".repeat(10);
  a(checkPath(".env.local").length === 1, ".env.local blocked");
  a(checkPath(".env.example").length === 0, ".env.example allowed");
  a(checkPath("data/journal.db").length > 0, "db blocked");
  a(checkPath("foo/journal.db-wal").length > 0, "wal blocked");
  a(checkPath("src/app/page.tsx").length === 0, "source allowed");
  a(checkContent("src/x.ts", `const a = "${fakeAddr}"`).length === 1, "address blocked");
  a(checkContent("tests/fixtures/f.ts", `const a = "${fakeAddr}"`).length === 0, "fixture address allowed");
  a(checkContent("src/x.ts", `const a = "0x${"0".repeat(38)}01"`).length === 0, "placeholder allowed");
  a(checkContent("src/x.ts", `k = "${"cd34".repeat(16)}"`).length === 1, "64 hex blocked");
  a(checkContent("src/x.ts", "AUTH_SECRET=supersecretvalue123").length === 1, "secret var blocked"); // secret-check:allow (self-test fixture)
  a(checkContent(".env.example", "AUTH_SECRET=").length === 0, "empty var allowed");
  a(checkContent("src/x.ts", "const s = process.env.AUTH_SECRET").length === 0, "env read allowed");
  a(checkContent("src/x.ts", `f("AUTH_SECRET=").length`).length === 0, "code mentioning var allowed");
  console.log("check-secrets self-test passed");
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const mode = args.includes("--all") ? "all" : "staged";
  const files = listFiles(mode);
  const problems = [];
  for (const f of files) {
    problems.push(...checkPath(f));
    problems.push(...checkContent(f, readContent(mode, f)));
  }
  if (problems.length) {
    console.error("\n✖ Privacy guard blocked this " + (mode === "staged" ? "commit" : "check") + ":\n");
    for (const p of problems) console.error("  - " + p);
    console.error(
      "\nThis repo is public. Personal data (wallets, DBs, env files, screenshots) must stay in DATA_DIR / .env.local." +
        "\nSynthetic fixtures belong in tests/fixtures/ and must use placeholder addresses (0x000…0001).\n",
    );
    process.exit(1);
  }
  console.log(`✓ privacy guard: ${files.length} file(s) clean`);
}

main();
