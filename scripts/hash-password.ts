/**
 * npm run hash-password — prompts for a password (hidden) and prints AUTH_PASSWORD_HASH.
 * Paste the output into .env.local and/or Vercel's env settings. Never into chat or a commit.
 */
import readline from "node:readline";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../src/server/auth/password";

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  out._writeToOutput = (s: string) => {
    if (!muted || s.includes(question)) process.stdout.write(s);
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const a = await ask(`New password (min ${MIN_PASSWORD_LENGTH} chars, input hidden): `);
  const b = await ask("Repeat password: ");
  if (a !== b) throw new Error("Passwords do not match.");
  const hash = await hashPassword(a);
  console.log("\nAdd this line to .env.local (local) and as AUTH_PASSWORD_HASH in Vercel (Production only):\n");
  console.log(`AUTH_PASSWORD_HASH=${hash}\n`);
}

main().catch((e) => {
  console.error("hash-password:", e instanceof Error ? e.message : e);
  process.exit(1);
});
