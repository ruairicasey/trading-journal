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
  "SPX/USD (xyz)" (migration 0011 rewrites the stored labels). Manual "Add trade" is now built (see below).
  Cycle 4 trade detail **done**: header with pair, direction, status pill, source and the net figure; underlined
  Basic / Analysis / Notes tabs in a one-row sticky bar with Save; form sections on hairline rules; plain fills table.
  Every $ hint in the form now blurs in privacy mode.
  Cycle 5 Analytics **done**: underlined section tabs, widgets on hairline rules, plain risk and scores, insights as
  ruled rows with a leak bar scaled to the worst pattern (dashboard and Reports too); no sideways scroll on phones.
  Cycle 6 Reports **done**: report title and meta, a ruled figures strip (one row in print), plain risk, scores and
  leaks, tables on hairline rules; Print / Save as PDF still prints just the report on white.
  Cycle 7 Settings and login **done**: settings aligned with the other pages, underlined section tabs (the current
  one kept in view on phones), journal lists without sideways scroll, softer card rings; login with the logo on the
  ground. The redesign is complete.

## Phase 3: insights and reports

- ~~Rule-based insights (revenge trades, tilt, worst hour/day, missing stops…) ranked by $ impact~~ **done**: Analytics →
  Insights and a Top leaks card on the dashboard; nine rules, judged on what you knew at entry; `npm run debug:insights`.
- ~~Discipline, review-coverage, compliance and mistake-cost scores~~ **done**: a Scores card on the dashboard and atop
  Analytics → Insights; discipline uses the Insights habits, coverage the weekly card's "Not reviewed" definition.
- ~~Risk-adjusted metrics~~ **done**: Sharpe, Sortino, time-weighted return, drawdowns, Calmar, recovery factor,
  expectancy, payoff and SQN in Analytics → Risk and Reports (moved off the dashboard in redesign cycle 2c); daily returns net of deposits/withdrawals.
- ~~Exportable reports (CSV/PDF)~~ **done**: Reports page (KPIs, scores, top leaks, by month / pair / direction, every
  trade) with Print / Save as PDF, and trades and monthly CSVs pinned to the moment the page was built.
- ~~Weekly review flow~~ **done**: `/review` steps through closed, unreviewed trades one at a time, oldest first (chart,
  key figures, grade, strategy, emotions, exit reason, mistakes, notes), with ← / → and ⌘↵ / ⌘S. Opened from the week
  card's "Review the N unreviewed trades" and a Reviews callout on the dashboard for the current period. Saving writes
  only the review fields you changed and marks the trade reviewed, so edits made elsewhere survive.
- ~~Manual trade entry~~ **done**: Trades → Add trade (`/trades/new`) for a trade sync can't see: pair, direction, status
  (closed, open or planned), prices, size, stop, times in your timezone and fees, with a live net figure; then the full
  Edit form for setup, review and screenshots. Crypto accounts use Hyperliquid's names (BTC, kPEPE, xyz:SPX); prop and
  other accounts store cTrader-style CFD symbols (EURUSD), reusing a spelling the account already has. Manual trades
  belong to no wallet (they show under All wallets) and count in P&L, but not in the balance curve.
- ~~Risk rules~~ **done**: Settings → Accounts → Risk rules: a daily loss limit ($), max trades a day and stop after N
  losses in a row, each off until set. Days are local, midnight to midnight; a trade breaks a rule when you opened it
  after that day's realised loss reached the limit (in cents), beyond the cap (open trades count), or after N losses in a
  row that day. Judged over the whole account, whatever wallet is picked. A Today card on the dashboard (within / close /
  stop for today), a "Past your limits" insight, and "Within your limits" in discipline (only when a rule is set, so the
  score is unchanged otherwise). `npm run debug:insights` prints the breach counts.
- ~~Strategy playbook~~ **done**: `/playbook` (sidebar) shows one card per strategy for the period: what it is, its
  written rules (one per line, edited in place), trades, win rate, net, avg trade and avg R, and rules followed (yes 1,
  partial ½, no 0 over marked trades) with net split followed / partly or not / not marked. A "No strategy" card means
  the cards add up to the period's closed trades. Counted by exit over whole local days, so each card's "View N trades"
  link opens exactly its trades. Archived strategies show only with trades. `npm run debug:playbook` reconciles it.
- ~~Rules in the review flow~~ **done**: once a trade has a strategy, "Rules followed?" (review flow and the trade's
  Notes tab) lists its playbook rules with Kept / Broke for each (click again to unmark). Only marked rules are stored,
  as a snapshot on the journal (migration 0014 `rules_check`); once every rule is marked the answer follows (all kept
  Yes, none No, else Partial), and Yes / Partial / No can still be picked by hand. Changing a trade's strategy drops the
  old check and the answer it gave; a check left by a bulk retag is ignored and never erases an answer. The Playbook
  shows "kept X of Y" for each rule over the period.
- ~~Monthly goals~~ **done**: Settings → Accounts → Monthly goals: a net target ($), most trades a month and a review
  target (%), each off until set (migration 0015). A dashboard card for this month: net against the target with a pace
  mark (met / on pace / behind), trades opened against the cap (open trades count), reviewed share of closed trades,
  days left, and how many of the last six full months hit each goal (none before the journal start or the first trade).
  Calendar months in your timezone, over the whole account. `npm run debug:insights` prints the states and counts.
