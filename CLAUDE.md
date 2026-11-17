# Trading Journal: working rules for Claude Code

## Context
- Personal Hyperliquid trading journal. Public repo, private data.
- Stack: Next.js 15, Drizzle + Turso, R2, Vercel (syd1), Cloudflare Worker cron.
- Reference docs: `docs/roadmap.md` (what's next), `docs/hyperliquid.md` (verified API facts), `docs/deploy.md`.
- The production URL and the last verified figures are in `CLAUDE.local.md` (gitignored).
- The owner often drives this session from his phone through Remote Control, sometimes by voice. Keep messages short and scannable, lead with the outcome, and never paste long logs.

## The loop (work autonomously)
For each roadmap item:
1. **Plan.** Post the plan in 10 lines or fewer, then build. Don't wait for approval unless a stop condition below applies.
2. **Test.** Run lint, typecheck and unit tests, plus e2e tests for the areas you touched.
3. **Review.** Run the `reviewer` subagent on the diff. Fix what it finds and re-run it until it says LGTM.
4. **Ship.** Commit with no trailers and push to main. Wait for CI to pass (`gh run watch`) and for the Vercel production deploy to be Ready. Vercel doesn't report deploys to GitHub, so `gh` can't see them: open the project's production Deployments page in Claude in Chrome (URL in `CLAUDE.local.md`; read-only) and check that the top row shows your commit's short SHA with status **Ready**. If it shows Error or Canceled, read the build log there and fix it; never redeploy or change settings from the dashboard.
5. **Verify on production yourself** (see Verification below). If anything fails, fix it and repeat from step 2.
6. **Report** in the format below, update `docs/roadmap.md` and `CLAUDE.local.md` baselines, then start the next item.

## Stop and ask only when
- a secret, password, token, new account, payment or new paid service is needed
- an action is irreversible or destructive, e.g. deleting data, force-pushing, a migration that drops or rewrites user data, or rotating credentials
- a product decision has no clear default. Ask one short question with 2–3 options and your recommendation.
- verification fails twice and you can't find the cause
- the owner must act physically, e.g. a browser login or a Mac-only prompt

When you stop, end with the question as the last line, so the push notification shows it. Otherwise keep going.

## Verification (do it yourself; don't hand it to the owner)
- **Data:** run the read-only probes with `npm run debug:* -- --remote`, which uses `.env.production.local`. If you need a new check, add or extend a read-only debug script rather than asking the owner. Probes print percentages and counts only, never addresses or amounts.
- **Live site:** use Claude in Chrome on the production URL; the owner's browser is logged in.
  - Checks are read-only: navigate, read, count and reconcile.
  - Don't change journal data. The one exception is a clearly reversible test that you undo straight away and mention in the report.
- **Reconcile:** every breakdown must add up to its total, in both trade count and net P&L. Compare against the baselines in `CLAUDE.local.md`; differences must be explained, e.g. by new trades or an intended rule change.
- **Browser scope:** only the journal domain, github.com, vercel.com and dash.cloudflare.com (read-only there). Never open Hyperliquid or any exchange or wallet site.

## Hard rules
- Never put wallet addresses, balances, P&L amounts, secrets or the production domain in anything public: commits, code, tests, fixtures, docs, CI logs or error messages.
- Never read or print the contents of `.env*` files; scripts load them.
- Sync and rebuild write exchange-owned fields only. Never overwrite journal fields the owner entered, including fields he deliberately cleared.
- Never type passwords, keys or tokens into web pages; ask the owner.
- No commit trailers, no force-push, no `--no-verify`. The secret guard and gitleaks must stay green.

## Report format (phone-friendly)
**Done:** one line, plus the commit and CI/deploy status
**Verified on prod:** 3–6 bullets with ✓ or ✗ and the numbers that reconcile
**Found and fixed:** bullets, or "nothing"
**Next:** what you're starting now, or the single question you need answered

## Commands
- Checks: `npm run lint` · `npm run typecheck` · `npm test` · `npm run test:e2e` · `npm run build`
- Probes: `npm run debug:orders` · `npm run debug:r` · `npm run debug:ledger` (add `-- --remote` for production) · `npm run verify:sync`
- Backup: `npm run backup -- --remote`
- Worker: `cd workers/sync-cron && npm run deploy`
