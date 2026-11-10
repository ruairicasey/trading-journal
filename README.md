# Trading Journal

A self-hosted trading journal for **Hyperliquid** perps traders. It auto-imports your fills, rebuilds them into round-trip trades (scale-ins, partial closes and position flips are all handled), and lets you journal each trade: setup, confluences, stops, grades, notes and screenshots. Analytics sit on top.

> **Status:** early development (Phase 1 MVP in progress).

## Privacy model

- **Your data never lives in this repo.** Everything personal (database, screenshots, exports, logs) goes in one gitignored folder, `DATA_DIR` (default `./data`). Secrets go in `.env.local`.
- **A Hyperliquid wallet address gives read-only access.** The app only calls Hyperliquid's public `info` API. It never asks for a private key or API key and can't place trades.
- Hyperliquid activity is public on-chain. Anyone who knows an address can see its fills. The journal keeps *your* notes, grades and screenshots private and never ties an address to a person in code.
- A pre-commit hook (`scripts/check-secrets.mjs`) and CI (the same script plus gitleaks) block commits that contain env files, DB files or wallet addresses.
- Deployed instances require a login on every page and API route.

## Quick start (local)

```bash
npm install
cp .env.example .env.local     # optional: set HL_WALLET_ADDRESS, or add the wallet later in Settings
npm run dev                    # http://localhost:3000
```

There's no login locally unless you set `AUTH_PASSWORD_HASH`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Apply migrations + seed defaults, then start the app |
| `npm run db:migrate` | Apply migrations and seed defaults (idempotent) |
| `npm run db:generate` | Generate a migration after editing `src/server/db/schema.ts` |
| `npm run db:studio` | Browse the database (Drizzle Studio) |
| `npm run seed:demo` | Build a fake demo account (about 250 synthetic trades with journal entries) in `data/demo/` |
| `npm run dev:demo` | Run the app against the demo account (seeds it first if missing) |
| `npm run sync:backfill` | Import all available fills for your wallet(s) from your machine, with no time limit (use it for the first big import) |
| `npm run verify:sync` | Print an address-free report (counts, last 10 trades, per-fill detail with `-- --trade N`) to compare against Hyperliquid's UI |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm run check:secrets` | Scan all tracked files for personal data / secrets |

| `npm run hash-password` / `npm run gen-secret` | Create your login hash and random secrets (output stays in your terminal) |

More scripts arrive as the build continues: `backup`.

`npm run dev` listens on `127.0.0.1` only until login is added.

## Syncing from Hyperliquid

1. Put your wallet address in `.env.local` (`HL_WALLET_ADDRESS=0x…`) or add it under **Settings → Wallets & sync**.
2. Run `npm run sync:backfill` once for the full history, then use **Sync now** or leave auto-sync on while the app is open.
3. Re-syncing any range is safe: fills are keyed by trade id, so nothing is duplicated, and your journal fields are never touched.
4. A deployed instance also syncs on a schedule: hourly via GitHub Actions, plus a daily Vercel Cron backstop. The header shows
   a **Stale** warning if no sync has succeeded for 3 hours. GitHub disables scheduled workflows after 60 days without repository
   activity, so if the warning persists, re-enable "Scheduled sync" under Actions.

> **History limit:** Hyperliquid's API only serves your **10,000 most recent fills**. Sync regularly and back up
> your data folder; fills already stored are never deleted. Details are in [docs/hyperliquid.md](docs/hyperliquid.md).

## Demo data

`npm run dev:demo` runs the app against a separate database in `data/demo/` filled with generated trades (random-walk prices, placeholder wallet). It never touches your real journal, ignores the personal values in `.env.local`, and shows a **Demo data** badge. Every screenshot in this README comes from it.

## Data model in one line

Exchange-derived data (raw fills, reconstructed trades) and your journal data (setup, notes, grades, screenshots) live in separate tables. A re-sync can never overwrite anything you've written. Journal lists (strategies, confluences, checklist, exit reasons, mistakes, emotions) are editable under **Settings → Journal lists**.

## Deploying

See [docs/deploy.md](docs/deploy.md): Vercel + Turso + a private Cloudflare R2 bucket. Every page and API route
requires your password, the app refuses to start without one (503 on every route), and preview deployments get
no data access.

## Contributing

Test fixtures and demo data must be **synthetic**. Use placeholder addresses such as `0x0000000000000000000000000000000000000001`, and never paste real fills.

## License

[MIT](./LICENSE)
