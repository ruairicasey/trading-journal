# Lighter integration notes

Read from `docs.lighter.xyz` on **2026-11-25** (base URL `https://mainnet.zklighter.elliot.ai`). Built from the published
schemas with synthetic fixtures: **no real account has been synced yet**. Every response is parsed with zod
(`src/server/lighter/schemas.ts`), so a changed shape fails loudly.

## Access

- A **read-only token** `ro:{account_index}:{single|all}:{expiry}:{hex}`: `read.*` scope only, 5 minutes to 10 years, revocable.
  Create it at `app.lighter.xyz/read-only-tokens`. The app refuses anything else.
- Stored with AES-256-GCM under a key derived from `AUTH_SECRET`; changing `AUTH_SECRET` means pasting the token again.
- It is sent only in the `Authorization` header, never in a URL, a log or an error. Redirects are refused.
- The account index comes from the token and the owning address from the public `account` endpoint, so the token is all you paste.

## Endpoints

| Data | Request | Notes |
|---|---|---|
| Fills | `trades` | newest first, ≤100 a page, opaque cursor |
| Orders | `accountActiveOrders`, `accountInactiveOrders` | the second by time window (seconds) |
| Funding | `positionFunding` | time window in ms, rows in seconds |
| Cash | `deposit/history`, `withdraw/history`, `transfer/history` | read whole every sync: statuses change later |
| Positions, collateral | `account` | public by index |

- Standard accounts: **60 requests a rolling minute**. The client allows 28 a minute on top of a full bucket of 28.
- A pass that stops halfway leaves a hole behind it, so trades are rebuilt only when a pass reaches its end (`lighter_state`).
- Only perps are journalled. Spot and binary-option fills are skipped.
- Zero or empty fields may be left out of a response.
- **Order ids pass 2^53** on higher markets (seen live: the market is in the high bits), so they are read from the string
  fields; one too big for a JS number is stored as a stable digest.
- A closing fill with neither P&L nor entry value fails the sync rather than storing a guess.
- The inactive-order window is by creation time (assumed), so it reaches back to the oldest order still stored as open.

## Stops and take-profits

- Stop-loss and take-profit orders (market or limit) feed the same detection as Hyperliquid's.
- An order attached to an entry exists before the entry fills: it counts from the parent order's first fill.
- An order edited in place keeps its index. When sync sees a new trigger price, what it had stored becomes a closed version
  of its own, so the first stop stays the first stop and the edit is a stop move. Edits between two syncs are seen as one,
  and an edit made before the order was first synced can't be seen at all.

## Balance view

Uses the wallet only while ledger + realised P&L − fees + funding is within 0.5% (at least $2) of the exchange's collateral.
Until it is (or after a day of not being) the wallet is left out of the balance and named on the dashboard; Hyperliquid's
balance is unaffected. A withdrawal from one exchange and a
deposit of about the same amount to another within a day fold into one internal flow worth the fee.

## Assumed: check on the first real trade with `npm run debug:lighter -- --remote`

1. Fee fields are millionths of the notional (documented for integrator fees only). Standard accounts pay 0.
2. `bid_account_pnl` / `ask_account_pnl` are gross of fees.
3. Funding `change` is the effect on your balance (negative = you paid).
4. A reduce-only trigger with no size covers the whole position.
5. In a liquidation the liquidated account is the taker.
6. Cash amounts are in whole tokens; a fast withdrawal isn't also listed as a transfer.
7. `initial_margin_fraction` is a percentage (20.00 = 5x).
