# Hyperliquid integration notes

Verified **2026-11-09** against the official docs (`hyperliquid.gitbook.io`, Info endpoint and
rate-limits pages) and live, non-personal calls to `https://api.hyperliquid.xyz/info`. Re-check
these if Hyperliquid changes its API. Every response is parsed with zod
(`src/server/hyperliquid/schemas.ts`), so changes to the shape fail loudly instead of corrupting data.

All requests are read-only `POST /info` calls that need only a wallet address. No API key or private
key is ever used.

## Fills

| Request | Limits |
|---|---|
| `{"type":"userFills","user"}` | at most 2000 most recent fills |
| `{"type":"userFillsByTime","user","startTime","endTime?"}` | at most **2000 per response**; docs: only the **10,000 most recent fills** are available. `startTime`/`endTime` are **inclusive** |

- Results are **ascending by time**: a call from `startTime: 0` returns the oldest available fills first (checked live).
- **Pagination:** use the last returned `time` as the next `startTime`. Because the bound is inclusive, fills
  sharing that millisecond are returned again (89 overlapped at one live boundary), so we dedupe on
  `(wallet, tid)`. If an entire 2000-fill page shares one millisecond, we step `startTime + 1` and record a
  gap warning. This was seen live on an address with mass delisting settlements; it can't happen with normal trading.
- **History depth:** treat the 10,000-fill cap as real. We never delete stored fills and warn when a wallet
  has ≥10,000 fills. One public address returned more than 10,000 fills by time, so the cap isn't applied
  identically everywhere. Don't rely on getting more.
- **Fields:** `coin, px, sz, side ("B"/"A"), time, startPosition, dir, closedPnl, hash, oid, crossed, fee, tid, feeToken`,
  plus optional `builderFee` (absent when 0), `liquidation`, and `twapId` (seen as `null`). Numerics are strings. `tid` fits in a JS number.
- **`fee` is "the total fee, inclusive of builderFee"** (docs). We use `fee` only; `builderFee` is stored for reference.
  A negative `fee` is a maker rebate.
- **`closedPnl`** is the realised P&L of the closing portion, gross of fees. Trade net = Σ closedPnl − Σ fee (+ funding later).
- **`dir`** includes `Open Long`, `Close Long`, `Open Short`, `Close Short`, `Long > Short`, `Short > Long`, `Buy`/`Sell` (spot),
  and `Settlement` (delisting). Reconstruction uses `startPosition` + signed size, not `dir`.
- Strings can carry stray whitespace in the official examples (`"feeToken": " USDC"`, `"usdc": " -3.625312"`), so all strings are trimmed.
- **Same-millisecond fills are not in tid order.** One order usually produces several fills with the same `time`,
  and their `tid`s do not follow the position sequence. On live market-maker fills, about half of the multi-fill groups ran in
  descending tid order. Sorting by `(time, tid)` gave 2,338 false position jumps in 13,935 fills, which split trades.
  Reconstruction therefore chains each same-ms group by `startPosition` (next fill starts where the previous ended); with that,
  jumps dropped to 0. Found from a real-wallet check on 2026-11-10.
- **`startPosition` carries float dust**, e.g. `2059303.0999999999` after a fill ending at `2059303.1000000001`.
  Positions are compared with a tolerance of max(1e-8 units, 1e-12 relative).
- **`liquidation` on a fill does not mean you were liquidated.** It is attached to every fill that took part in a liquidation,
  including the counterparty's (a liquidator's fills carry it with someone else as `liquidatedUser`, and their `dir` still reads
  `Liquidated Isolated Long` etc.). Only `liquidation.liquidatedUser == your address` marks your own liquidation; otherwise the
  trade is flagged `liquidationCounterparty` for information. Object keys seen live: `liquidatedUser`, `markPx`, `method` (`market` / `backstop`).

## HIP-3 (builder-deployed perps)

- Fills for **all dexes** come back from the same fills calls. HIP-3 coins carry the dex prefix: `xyz:XYZ100`, `xyz:TSLA`, …
- `{"type":"perpDexs"}` returns `[null, {"name":"xyz", …}, …]`; `null` is the first (main) dex. Live on 2026-11-09:
  `xyz, flx, vntl, hyna, km, abcd, cash, para, mkts, io`.
- `clearinghouseState`, `meta`, `frontendOpenOrders` and `openOrders` take `dex` (default `""` = main dex). Open positions are
  fetched once per dex.
- **Fee tokens differ by dex.** Seen live: USDC (main, xyz, para, mkts), USDH (vntl, km, flx), USDT0 (cash), USDE (hyna).
  These USD stablecoins are treated as $1; any other fee token flags the trade `nonUsdcFee`.

## Positions

`{"type":"clearinghouseState","user","dex?"}` returns
`assetPositions[].position{coin, szi, entryPx, leverage{type,value}, liquidationPx, positionValue, unrealizedPnl, returnOnEquity, marginUsed, cumFunding{allTime,sinceChange,sinceOpen}}`
plus `marginSummary`, `withdrawable` and `time`. Under unified-account or portfolio margin, the docs say to use the spot balances endpoint for the account balance.

## Funding

`{"type":"userFunding","user","startTime","endTime?"}` returns
`[{time, hash, delta{type:"funding", coin, usdc, szi, fundingRate, nSamples}}]`, including HIP-3 coins.
Time-range responses return at most **500** items; paginate by last timestamp (cursor saved after every page).

- **Every funding row has the all-zero `hash`** (verified live 2026-11-10: 500 rows, 1 distinct hash, 500 distinct
  `(coin, time)`). Funding is therefore keyed by `(wallet, coin, time)`; the original `(wallet, hash, coin)` key kept only one row
  per coin. Migration `0002` re-keys the table and resets the funding cursor so everything is re-fetched.

## Rate limits (per IP)

- 1200 weight per minute across REST requests.
- `clearinghouseState` = 2; most other info requests = 20.
- `userFills`, `userFillsByTime`, `userFunding` and `historicalOrders` add **+1 per 20 items returned** (a full 2000-fill page ≈ 120).
- The client keeps a token bucket at 900/min and retries 429/5xx with backoff (1, 2, 4, 8s).

## Not used yet (Phase 2)

- `historicalOrders` (2000 most recent) and `frontendOpenOrders` (`isTrigger`, `triggerPx`, `orderType`, `reduceOnly`, `isPositionTpsl`)
  for SL/TP auto-detection.
- `userNonFundingLedgerUpdates` (deposits, transfers, withdrawals) for equity curves.
