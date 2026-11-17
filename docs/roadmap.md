# Roadmap

Phase 1 (MVP, **done**) is the sync, the trades list, the Edit Trade form, screenshots, backups and the dashboard, with a
Cloudflare Worker cron trigger as the primary sync scheduler (moved up from Phase 2 because GitHub's schedule kept missing runs).

## Phase 2: analytics and quality

- ~~Deposits and withdrawals from Hyperliquid (`userNonFundingLedgerUpdates`), so the equity curve tracks the real account
  balance~~ **done**: with full fill, funding and ledger history, the $ curve is the account balance (ledger flows + every
  fill's realised P&L − fee + funding), stepped at each event, with a dashed net-deposited line.
- ~~Analytics page: setup, timing, risk and execution, and behaviour sections, with show/hide widgets~~ **done**.
- ~~Drawdown tracker and weekly reflection card on the dashboard~~ **done**.
- ~~Auto-detect SL/TP from trigger orders~~ **done**: stop loss, take profit, TP ladders and stop moves from `historicalOrders`,
  never overwriting values you entered.
- ~~Funding attribution to trades~~ **done**; deposits, withdrawals and transfers are stored and drive the balance view.
- Stop-move history: your own stop moves alongside the ones read from exchange orders, each move classed (tighten,
  widen, to breakeven, trail into profit), and what moving the stop did to R.
- Multiple wallets per account in the UI.
- Manual trades for non-Hyperliquid accounts.
- Bulk select actions and custom saved filters on the Trades page; TradingView snapshot-link import.
- Importer for Hyperliquid's trade-history CSV (the API only serves the 10,000 most recent fills).
- CSV export; full-text search.

## Phase 3: insights and reports

- Rule-based insights (revenge trades, tilt, worst hour/day, missing stops…) ranked by $ impact.
- Discipline, review-coverage, compliance and mistake-cost scores.
- Exportable reports (CSV/PDF).
