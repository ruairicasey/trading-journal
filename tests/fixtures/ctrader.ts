/**
 * Synthetic cTrader Open API messages, shaped like the documented JSON (spotware/openapi-proto-messages).
 * All ids, logins and amounts are made up. A fake server answers per payloadType so sync runs end to end offline.
 */
import { PT } from "@/server/ctrader/protocol";
import type { Transport, TransportFactory } from "@/server/ctrader/session";

export const CTID = 900001;
export const LOGIN = 5550001;
export const MD = 2; // moneyDigits: cents

type DealOpts = {
  id: number;
  pos: number;
  side: "BUY" | "SELL" | 1 | 2;
  units: number;
  price: number;
  t: number;
  commission?: number; // account money, e.g. -3.5
  status?: number | string;
  close?: {
    entry: number;
    gross: number;
    swap?: number;
    commission?: number;
    balance: number;
    units?: number;
  };
  symbolId?: number;
};

const cents = (x: number) => Math.round(x * 10 ** MD);

/** Mixes number and string int64s and enum names vs numbers on purpose: the docs don't say which JSON uses. */
export function deal(o: DealOpts) {
  return {
    dealId: o.id,
    orderId: o.id + 10_000,
    positionId: String(o.pos),
    volume: o.units * 100,
    filledVolume: o.units * 100,
    symbolId: o.symbolId ?? 1,
    createTimestamp: o.t - 5,
    executionTimestamp: String(o.t),
    executionPrice: o.price,
    tradeSide: o.side,
    dealStatus: o.status ?? "FILLED",
    commission: cents(o.commission ?? 0),
    moneyDigits: MD,
    baseToUsdConversionRate: 1.1,
    ...(o.close
      ? {
          closePositionDetail: {
            entryPrice: o.close.entry,
            grossProfit: cents(o.close.gross),
            swap: cents(o.close.swap ?? 0),
            commission: cents(o.close.commission ?? 0),
            balance: cents(o.close.balance),
            closedVolume: (o.close.units ?? o.units) * 100,
            moneyDigits: MD,
          },
        }
      : {}),
  };
}

export type ServerState = {
  scope: number | string;
  accounts: {
    ctidTraderAccountId: number;
    isLive: boolean;
    traderLogin: number;
    brokerTitleShort: string;
    lastClosingDealTimestamp?: number;
  }[];
  deals: ReturnType<typeof deal>[];
  balance: number;
  registeredAt: number;
  /** deal list page size the fake server uses (tests hasMore paging) */
  pageSize: number;
  /** error code to answer every account auth with */
  accountAuthError?: string;
  log: { url: string; payloadType: number; payload: Record<string, unknown> }[];
};

export function serverState(over: Partial<ServerState> = {}): ServerState {
  return {
    scope: "SCOPE_VIEW",
    accounts: [{ ctidTraderAccountId: CTID, isLive: false, traderLogin: LOGIN, brokerTitleShort: "PropCo" }],
    deals: [],
    balance: 100_000,
    registeredAt: Date.UTC(2026, 9, 1),
    pageSize: 1000,
    log: [],
    ...over,
  };
}

export function fakeTransport(st: ServerState): TransportFactory {
  return async (url) => {
    let onMsg: (d: string) => void = () => {};
    const reply = (clientMsgId: string, payloadType: number, payload: object) =>
      queueMicrotask(() => onMsg(JSON.stringify({ clientMsgId, payloadType, payload })));
    const t: Transport = {
      send(data) {
        const m = JSON.parse(data) as {
          clientMsgId: string;
          payloadType: number;
          payload: Record<string, unknown>;
        };
        st.log.push({ url, payloadType: m.payloadType, payload: m.payload });
        const id = m.clientMsgId;
        switch (m.payloadType) {
          case PT.HEARTBEAT_EVENT:
            return;
          case PT.APPLICATION_AUTH_REQ:
            return m.payload.clientSecret === "secret-x"
              ? reply(id, PT.APPLICATION_AUTH_RES, {})
              : reply(id, PT.OA_ERROR_RES, { errorCode: "CH_CLIENT_AUTH_FAILURE" });
          case PT.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ:
            return reply(id, PT.GET_ACCOUNTS_BY_ACCESS_TOKEN_RES, {
              accessToken: m.payload.accessToken,
              permissionScope: st.scope,
              ctidTraderAccount: st.accounts,
            });
          case PT.ACCOUNT_AUTH_REQ: {
            const a = st.accounts.find((x) => x.ctidTraderAccountId === m.payload.ctidTraderAccountId);
            // a host only serves its own kind of account
            if (!a || a.isLive !== url.includes("live."))
              return reply(id, PT.OA_ERROR_RES, { errorCode: "CH_CTID_TRADER_ACCOUNT_NOT_FOUND" });
            if (st.accountAuthError)
              return reply(id, PT.OA_ERROR_RES, {
                errorCode: st.accountAuthError,
                description: "Access token expired",
              });
            return reply(id, PT.ACCOUNT_AUTH_RES, { ctidTraderAccountId: a.ctidTraderAccountId });
          }
          case PT.TRADER_REQ:
            return reply(id, PT.TRADER_RES, {
              ctidTraderAccountId: m.payload.ctidTraderAccountId,
              trader: {
                ctidTraderAccountId: m.payload.ctidTraderAccountId,
                balance: cents(st.balance),
                depositAssetId: 7,
                moneyDigits: MD,
                registrationTimestamp: st.registeredAt,
                brokerName: "PropCo",
              },
            });
          case PT.ASSET_LIST_REQ:
            return reply(id, PT.ASSET_LIST_RES, {
              asset: [
                { assetId: 7, name: "USD" },
                { assetId: 8, name: "EUR" },
              ],
            });
          case PT.SYMBOLS_LIST_REQ:
            return reply(id, PT.SYMBOLS_LIST_RES, {
              symbol: [
                { symbolId: 1, symbolName: "EURUSD" },
                { symbolId: 2, symbolName: "XAUUSD" },
              ],
              archivedSymbol: [{ symbolId: 3, name: "OLDSYM" }],
            });
          case PT.DEAL_LIST_REQ: {
            const from = Number(m.payload.fromTimestamp);
            const to = Number(m.payload.toTimestamp);
            const hits = st.deals
              .filter((d) => Number(d.executionTimestamp) >= from && Number(d.executionTimestamp) < to)
              // newest first: the worst case for a client that pages forward (the docs don't say which end is kept)
              .sort((a, b) => Number(b.executionTimestamp) - Number(a.executionTimestamp));
            return reply(id, PT.DEAL_LIST_RES, {
              ctidTraderAccountId: m.payload.ctidTraderAccountId,
              deal: hits.slice(0, st.pageSize),
              hasMore: hits.length > st.pageSize,
            });
          }
          default:
            return reply(id, PT.OA_ERROR_RES, { errorCode: "UNSUPPORTED" });
        }
      },
      close() {},
      onMessage(cb) {
        onMsg = cb;
      },
      onClose() {},
    };
    return t;
  };
}

export const CFG = {
  clientId: "client-x",
  clientSecret: "secret-x",
  tokenKey: "k".repeat(40),
  configured: true,
};
