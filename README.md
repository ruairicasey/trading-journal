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
| `npm test` | Unit tests (Vitest) |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm run check:secrets` | Scan all tracked files for personal data / secrets |

More scripts arrive as the build continues: `seed:demo`, `sync:backfill`, `backup`, `hash-password`.

## Data model in one line

Exchange-derived data (raw fills, reconstructed trades) and your journal data (setup, notes, grades, screenshots) live in separate tables. A re-sync can never overwrite anything you've written. Journal lists (strategies, confluences, checklist, exit reasons, mistakes, emotions) are editable under **Settings → Journal lists**.

## Contributing

Test fixtures and demo data must be **synthetic**. Use placeholder addresses such as `0x0000000000000000000000000000000000000001`, and never paste real fills.

## License

[MIT](./LICENSE)
