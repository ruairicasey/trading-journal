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
- ~~Stop-move history~~ **done**: your own stop moves alongside the ones read from exchange orders, each move classed
  (tightened, widened, to breakeven, trailing in profit) with the R it locks, and Analytics → Behaviour → Stop management.
- ~~Multiple wallets per account in the UI~~ **done**: a wallet picker scopes the dashboard, trades, analytics, search and
  balance view to one wallet (transfers between your own wallets fold away in "All wallets"); wallet cards can be
  renamed, retyped and moved to another account with their trades.
- ~~Non-Hyperliquid accounts: a prop-firm account on cTrader~~ **built, awaiting real data**: Settings → cTrader connects
  through the cTrader Open API with view-only (`accounts`) access, refresh token encrypted at rest; discovers each account
  (demo host for challenge accounts, live host for live ones) as a prop journal account; syncs deals hourly on the
  existing cron in short WebSocket sessions (one trade per cTrader position); imports cTrader's history CSV as a backup,
  with a preview. Built against the documented messages with synthetic fixtures; verify with `npm run debug:ctrader`
  once the first real trade closes (commission semantics, JSON encoding, the CSV's exact headers). Non-USD accounts
  aren't converted to USD yet.
- ~~Bulk select actions and custom saved filters on the Trades page; TradingView snapshot-link import~~ **done**: select rows,
  a page or every matching trade, then add a tag, set grade or strategy, or delete with Undo; save the current filters
  as a chip; paste a `tradingview.com/x/…` link to store the chart as a screenshot.
- Importer for Hyperliquid's trade-history CSV (the API only serves the 10,000 most recent fills). **Parked until
  needed**: sync flags a wallet as truncated when it hits that window. Building it needs a real export file, because the
  CSV lacks the fill id, order id, hash and start position that trade reconstruction uses; it must only add fills older
  than the earliest API fill.
- ~~CSV export; full-text search~~ **done**: CSV export lives on the Reports page; search matches every word across
  pair, notes, reflection, tags, strategy, confluences, mistakes, reasons, emotions, captions and stop-move notes, with
  highlighted snippets.

- ~~Journal start date~~ **done**: Settings → Accounts → "Journal starts on". Every view uses only trades opened on or after
  it (the new "Since start" period is Analytics' default); "All time" looks further back. Nothing is deleted; sync is
  unaffected; the balance curve starts at the real balance on that date.

- Redesign (light theme), in cycles. Cycle 1 design tokens **done**: palette, type scale (IBM Plex), focus ring and link
  style as tokens; light mode; hard-coded colours moved onto tokens; red/green kept for realised money, gold for warnings.
  Cycle 2a shell **done**: inset white sheet on the ground, sidebar with logo, white-pill current page, account block and
  sync status in the footer (top bar on phones, icon when collapsed; one sync loop in a provider).
  Cycle 2b dashboard **done**: a hero (balance or what the curve shows, period net, net deposits, open positions, the
  curve), a ruled figures strip, then the calendar and week beside leaks, scores and recent trades; risk and drawdown
  below. Calendar keeps its week totals, so it takes the wide column.
  Cycle 2c spec fixes **done**: balance chart scaled to the balance (net deposits drawn when in range, else behind a
  toggle; no fill); red/green only for realised money; no middle-dot labels or link arrows; direction as an arrow and
  word; risk and drawdown moved to Analytics → Risk; no desktop top bar (search and privacy in the sidebar).
  Cycle 3 Trades **done**: underlined status tabs, search and chips, a table (pair, side, opened, stop, review, return,
  net) that stacks below 1024px, "Showing N of M" footer, an "Export closed trades" link. HIP-3 pairs read
  "SPX/USD (xyz)" (migration 0011 rewrites the stored labels). Manual "Add trade" from the design is not built: the
  app has no manual trade creation yet.
  Next: cycle 4, trade detail and the edit form.

## Phase 3: insights and reports

- ~~Rule-based insights (revenge trades, tilt, worst hour/day, missing stops…) ranked by $ impact~~ **done**: Analytics →
  Insights and a Top leaks card on the dashboard; nine rules, judged on what you knew at entry; `npm run debug:insights`.
- ~~Discipline, review-coverage, compliance and mistake-cost scores~~ **done**: a Scores card on the dashboard and atop
  Analytics → Insights; discipline uses the Insights habits, coverage the weekly card's "Not reviewed" definition.
- ~~Risk-adjusted metrics~~ **done**: Sharpe, Sortino, time-weighted return, drawdowns, Calmar, recovery factor,
  expectancy, payoff and SQN on the dashboard, Analytics → Risk and Reports; daily returns net of deposits/withdrawals.
- ~~Exportable reports (CSV/PDF)~~ **done**: Reports page (KPIs, scores, top leaks, by month / pair / direction, every
  trade) with Print / Save as PDF, and trades and monthly CSVs pinned to the moment the page was built.
