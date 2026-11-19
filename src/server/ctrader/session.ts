/**
 * A short-lived cTrader Open API session over the JSON WebSocket (port 5036): open, authenticate the app, ask for
 * what we need, close. A sync is seconds of requests, so there's no long-lived connection to keep alive between
 * cron runs (a heartbeat goes out every 10 s while open; the server drops connections idle for 30 s).
 *
 * Requests are matched to responses by clientMsgId. Historical requests (deal lists) are paced to stay under the
 * documented 5/s per connection. Nothing here logs payloads: they carry tokens.
 */
import { z } from "zod";
import { ErrorRes, PT } from "./protocol";

export interface Transport {
  send(data: string): void;
  close(): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: (reason: string) => void): void;
}

export type TransportFactory = (url: string, timeoutMs: number) => Promise<Transport>;

/** Node 22's built-in WebSocket client. */
export const wsTransport: TransportFactory = (url, timeoutMs) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new CtraderError("CONNECT_TIMEOUT", "cTrader connection timed out"));
    }, timeoutMs);
    const closeCbs: ((r: string) => void)[] = [];
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve({
        send: (d) => ws.send(d),
        close: () => ws.close(),
        onMessage: (cb) =>
          ws.addEventListener("message", (e) => cb(typeof e.data === "string" ? e.data : String(e.data))),
        onClose: (cb) => closeCbs.push(cb),
      });
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new CtraderError("CONNECT_FAILED", "cTrader connection failed"));
    });
    ws.addEventListener("close", (e) => closeCbs.forEach((cb) => cb(`closed (${e.code})`)));
  });

export class CtraderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  expect: number;
  timer: ReturnType<typeof setTimeout>;
};

export class CtraderSession {
  private seq = 0;
  private pending = new Map<string, Pending>();
  private heartbeat: ReturnType<typeof setInterval>;
  private lastHistorical = 0;
  private closed: string | null = null;
  /** set when the server says the access token was invalidated mid-session */
  tokenInvalidated = false;

  constructor(
    private t: Transport,
    private o: {
      timeoutMs: number;
      historicalGapMs: number;
      sleep: (ms: number) => Promise<void>;
      now: () => number;
    },
  ) {
    t.onMessage((d) => this.onMessage(d));
    t.onClose((r) => this.fail(new CtraderError("DISCONNECTED", `cTrader connection ${r}`)));
    this.heartbeat = setInterval(
      () => this.safeSend({ payloadType: PT.HEARTBEAT_EVENT, payload: {} }),
      10_000,
    );
    (this.heartbeat as { unref?: () => void }).unref?.();
  }

  private safeSend(msg: object) {
    if (this.closed) return;
    try {
      this.t.send(JSON.stringify(msg));
    } catch {
      /* the close handler reports it */
    }
  }

  private onMessage(data: string) {
    let m: { clientMsgId?: string; payloadType?: number; payload?: unknown };
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m.payloadType === PT.ACCOUNTS_TOKEN_INVALIDATED_EVENT) this.tokenInvalidated = true;
    if (m.payloadType === PT.CLIENT_DISCONNECT_EVENT)
      this.fail(new CtraderError("DISCONNECTED", "cTrader closed the session"));
    const p = m.clientMsgId ? this.pending.get(m.clientMsgId) : undefined;
    if (!p) return; // heartbeats and events
    this.pending.delete(m.clientMsgId!);
    clearTimeout(p.timer);
    if (m.payloadType === PT.OA_ERROR_RES || m.payloadType === PT.ERROR_RES) {
      const e = ErrorRes.safeParse(m.payload);
      const code = e.success ? e.data.errorCode : "UNKNOWN";
      p.reject(
        new CtraderError(
          code,
          `cTrader error ${code}${e.success && e.data.description ? `: ${e.data.description}` : ""}`,
        ),
      );
    } else if (m.payloadType !== p.expect) {
      p.reject(new CtraderError("UNEXPECTED", `cTrader answered ${m.payloadType} instead of ${p.expect}`));
    } else p.resolve(m.payload ?? {});
  }

  private fail(e: Error) {
    if (this.closed) return;
    this.closed = e.message;
    clearInterval(this.heartbeat);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
  }

  async request<S extends z.ZodTypeAny>(
    reqType: number,
    payload: object,
    resType: number,
    schema: S,
    opts: { historical?: boolean } = {},
  ): Promise<z.output<S>> {
    if (this.closed) throw new CtraderError("DISCONNECTED", this.closed);
    if (opts.historical) {
      const wait = this.lastHistorical + this.o.historicalGapMs - this.o.now();
      if (wait > 0) await this.o.sleep(wait);
      this.lastHistorical = this.o.now();
    }
    const clientMsgId = `tj${++this.seq}`;
    const raw = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(clientMsgId);
        reject(new CtraderError("TIMEOUT", `cTrader did not answer request ${reqType}`));
      }, this.o.timeoutMs);
      this.pending.set(clientMsgId, { resolve, reject, expect: resType, timer });
      this.safeSend({ clientMsgId, payloadType: reqType, payload });
    });
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      throw new CtraderError("BAD_RESPONSE", `cTrader response ${resType} had an unexpected shape`);
    return parsed.data;
  }

  close() {
    this.fail(new CtraderError("CLOSED", "session closed"));
    try {
      this.t.close();
    } catch {
      /* already closed */
    }
  }
}

export async function openSession(
  url: string,
  creds: { clientId: string; clientSecret: string },
  o: {
    transport?: TransportFactory;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<CtraderSession> {
  const timeoutMs = o.timeoutMs ?? 20_000;
  const t = await (o.transport ?? wsTransport)(url, timeoutMs);
  const s = new CtraderSession(t, {
    timeoutMs,
    historicalGapMs: 250,
    sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: o.now ?? Date.now,
  });
  try {
    await s.request(
      PT.APPLICATION_AUTH_REQ,
      { clientId: creds.clientId, clientSecret: creds.clientSecret },
      PT.APPLICATION_AUTH_RES,
      z.unknown(),
    );
  } catch (e) {
    s.close();
    throw e;
  }
  return s;
}
