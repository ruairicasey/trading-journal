# Roadmap

Phase 1 (MVP) is the sync, the trades list, the Edit Trade form, screenshots, backups and the dashboard, with a
Cloudflare Worker cron trigger as the primary sync scheduler (moved up from Phase 2 because GitHub's schedule kept missing runs).

## Phase 2: analytics and quality

- **Deposits and withdrawals from Hyperliquid** (`userNonFundingLedgerUpdates`), so the equity curve tracks the real account
  balance instead of starting balance + realised P&L.
- Analytics page: setup, timing, risk and execution, and behaviour sections, with show/hide widgets.
- Drawdown tracker and weekly reflection card on the dashboard.
- R-multiples everywhere; auto-detect SL/TP from trigger orders (`historicalOrders` / `frontendOpenOrders`).
- Funding attribution to trades (raw funding is already stored).
- Multiple wallets per account in the UI; manual trades for non-Hyperliquid accounts; stop-move history.
- Bulk select actions and custom saved filters on the Trades page; TradingView snapshot-link import.
- Importer for Hyperliquid's trade-history CSV (the API only serves the 10,000 most recent fills).
- CSV export; full-text search.

## Phase 3: insights and reports

- Rule-based insights (revenge trades, tilt, worst hour/day, missing stops…) ranked by $ impact.
- Discipline, review-coverage, compliance and mistake-cost scores.
- Exportable reports (CSV/PDF).
