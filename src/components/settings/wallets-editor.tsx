"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Eye, EyeOff, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ADDRESS_RE, fmtDateTime, maskAddr, timeAgo } from "@/lib/format";
import { EXCHANGE_LABEL, type Exchange } from "@/lib/enums";
import { cn } from "@/lib/utils";
import {
  addLighterAccount,
  addWallet,
  moveWallet,
  removeLighterToken,
  replaceLighterToken,
  updateWallet,
} from "@/app/(app)/settings/wallets/actions";
import { runSync } from "@/components/sync/run-sync";

type Wallet = {
  id: string;
  exchange: Exchange;
  accountIndex: number;
  lighter: { hasToken: boolean; expiresAt: number | null; reconciledAt: number | null } | null;
  address: string;
  label: string;
  kind: "main" | "sub" | "vault";
  accountId: string;
  enabled: boolean;
  autoSync: boolean;
  lastSyncedAt: number | null;
  lastSuccessAt: number | null;
  oldestFillTime: number | null;
  lastFillTime: number | null;
  backfillCompletedAt: number | null;
  historyTruncated: boolean;
  fills: number;
  trades: number;
};
type Run = {
  id: string;
  wallet: string;
  trigger: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  pages: number;
  fillsNew: number;
  tradesTouched: number;
  gapsDetected: number;
  done: boolean;
  error: string | null;
};

export function WalletsEditor(props: {
  isDemo: boolean;
  timezone: string;
  accounts: { id: string; name: string }[];
  wallets: Wallet[];
  runs: Run[];
}) {
  const [adding, setAdding] = useState(props.wallets.length === 0);
  return (
    <div className="space-y-4">
      {props.isDemo && (
        <p className="border-rule bg-gold-tint text-gold-ink rounded-md border px-3 py-2 text-xs">
          Demo mode: the demo wallet is a placeholder and syncing is disabled.
        </p>
      )}
      {props.wallets.map((w) => (
        <WalletCard
          key={w.id}
          wallet={w}
          tz={props.timezone}
          isDemo={props.isDemo}
          accounts={props.accounts}
        />
      ))}
      {adding ? (
        <AddWallet accounts={props.accounts} onDone={() => setAdding(false)} />
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Add wallet
        </Button>
      )}
      <RunsTable runs={props.runs} tz={props.timezone} />
    </div>
  );
}

function WalletCard({
  wallet: w,
  tz,
  isDemo,
  accounts,
}: {
  wallet: Wallet;
  tz: string;
  isDemo: boolean;
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [reveal, setReveal] = useState(false);
  const [pending, start] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const doSync = async (range?: { start: number; end: number }) => {
    setSyncing(true);
    setMsg(null);
    try {
      let rounds = 0;
      const r = await runSync(
        { trigger: range ? "range" : "manual", walletId: w.id, range },
        (_, n) => (rounds = n),
      );
      const res = r.results.find((x) => x.label === w.label) ?? r.results[0];
      setMsg(
        res?.status === "error"
          ? `Failed: ${res.error}`
          : res
            ? `${res.status === "skipped" ? "Already syncing" : "Done"}: ${res.fillsNew} new fills, ${res.tradesTouched} trades updated${res.gapsDetected ? `, ${res.gapsDetected} gap warning(s)` : ""}${rounds > 1 ? ` (${rounds} rounds)` : ""}`
            : "Nothing to sync (wallet disabled?)",
      );
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const toggle = (patch: { enabled?: boolean; autoSync?: boolean }) =>
    start(() => updateWallet({ id: w.id, ...patch }));

  return (
    <Card className={cn(!w.enabled && "opacity-60")}>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm">{w.label}</CardTitle>
        <Badge variant="secondary" className="text-[10px]" data-testid="wallet-exchange">
          {EXCHANGE_LABEL[w.exchange]}
        </Badge>
        <Badge variant="secondary" className="text-[10px] capitalize">
          {w.kind}
        </Badge>
        <code className="text-muted-foreground font-mono text-xs">
          {reveal ? w.address : maskAddr(w.address)}
        </code>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={reveal ? "Hide address" : "Show address"}
          onClick={() => setReveal((r) => !r)}
        >
          {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
        <div className="flex-1" />
        {w.historyTruncated && <Badge className="bg-gold-tint text-gold-ink">History may be truncated</Badge>}
        {!w.backfillCompletedAt && w.enabled && (
          <Badge className="bg-subtle text-ink-2">Import pending</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="text-muted-foreground grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          <Stat label="Fills" value={w.fills.toLocaleString()} />
          <Stat label="Trades" value={w.trades.toLocaleString()} />
          <Stat label="Coverage from" value={fmtDateTime(w.oldestFillTime, tz)} />
          <Stat label="Latest fill" value={fmtDateTime(w.lastFillTime, tz)} />
          <Stat label="Last sync" value={timeAgo(w.lastSyncedAt)} />
          <Stat label="Last success" value={timeAgo(w.lastSuccessAt)} />
        </dl>

        {w.exchange === "lighter" && <LighterToken wallet={w} tz={tz} isDemo={isDemo} />}

        <WalletDetails wallet={w} accounts={accounts} />

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={w.enabled} disabled={pending} onCheckedChange={(v) => toggle({ enabled: v })} />{" "}
            Enabled
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={w.autoSync}
              disabled={pending || !w.enabled}
              onCheckedChange={(v) => toggle({ autoSync: v })}
            />
            Auto-sync
          </label>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="secondary"
            disabled={isDemo || syncing || !w.enabled}
            onClick={() => doSync()}
          >
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} /> Sync now
          </Button>
        </div>

        {w.exchange === "hyperliquid" && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const startMs = new Date(from).getTime();
              const endMs = new Date(to).getTime() + 86_399_999;
              if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
                setMsg("Pick a valid date range");
                return;
              }
              void doSync({ start: startMs, end: endMs });
            }}
          >
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-xs">Re-sync from</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 w-40"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-xs">to</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40" />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              disabled={isDemo || syncing || !w.enabled || !from || !to}
            >
              Re-sync range
            </Button>
            <span className="text-muted-foreground text-xs">
              Safe to repeat: never duplicates trades or touches your journal.
            </span>
          </form>
        )}
        {msg && <p className="text-xs">{msg}</p>}
      </CardContent>
    </Card>
  );
}

/** Token status for a Lighter account, with a way to replace or forget it. The token itself is never shown. */
function LighterToken({ wallet: w, tz, isDemo }: { wallet: Wallet; tz: string; isDemo: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const st = w.lighter;
  const expired = !!st?.expiresAt && st.expiresAt <= Date.now();
  const needs = !st?.hasToken || expired;

  return (
    <div className="space-y-2" data-testid="lighter-token">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn(needs && "text-gold-ink")} suppressHydrationWarning>
          {!st?.hasToken
            ? "No token: this account isn't syncing"
            : expired
              ? "Token expired: paste a new one to keep syncing"
              : `Read-only token until ${fmtDateTime(st.expiresAt, tz)}`}
        </span>
        <span className="text-muted-foreground">
          {st?.reconciledAt
            ? `Balance matched Lighter ${timeAgo(st.reconciledAt)}`
            : "Balance not matched to Lighter yet"}
        </span>
        <div className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isDemo}
          onClick={() => setEditing((x) => !x)}
        >
          {st?.hasToken ? "Replace token" : "Add token"}
        </Button>
        {st?.hasToken && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isDemo || pending}
            onClick={() =>
              start(async () => {
                await removeLighterToken({ id: w.id });
                setMsg("Token removed. Your trades stay; also revoke it on Lighter if you're done with it.");
                router.refresh();
              })
            }
          >
            Remove token
          </Button>
        )}
      </div>
      {editing && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await replaceLighterToken({ id: w.id, token });
              setToken("");
              setMsg(r.ok ? "Token saved" : r.error);
              if (r.ok) {
                setEditing(false);
                router.refresh();
              }
            });
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor={`lt-${w.id}`} className="text-muted-foreground text-xs">
              Read-only token
            </Label>
            <TokenInput id={`lt-${w.id}`} value={token} onChange={setToken} />
          </div>
          <Button type="submit" size="sm" variant="secondary" disabled={pending || !token.trim()}>
            {pending ? "Checking…" : "Save token"}
          </Button>
        </form>
      )}
      {msg && <p className="text-xs">{msg}</p>}
    </div>
  );
}

function TokenInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Input
      id={id}
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="ro:…"
      autoComplete="off"
      spellCheck={false}
      maxLength={400}
      className="h-8 w-full max-w-80 font-mono"
    />
  );
}

const KIND_LABEL = { main: "Main account", sub: "Sub-account", vault: "Vault" } as const;

/** Rename, change the type, or move the wallet (and its trades) to another journal account. */
function WalletDetails({
  wallet: w,
  accounts,
}: {
  wallet: Wallet;
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [label, setLabel] = useState(w.label);
  const [kind, setKind] = useState(w.kind);
  const [accountId, setAccountId] = useState(w.accountId);
  const [confirmMove, setConfirmMove] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = label.trim() !== w.label || kind !== w.kind || accountId !== w.accountId;
  const moving = accountId !== w.accountId;
  const target = accounts.find((a) => a.id === accountId)?.name ?? "the other account";

  const save = () =>
    start(async () => {
      setMsg(null);
      try {
        if (label.trim() !== w.label || kind !== w.kind)
          await updateWallet({ id: w.id, label: label.trim(), kind });
        if (moving) {
          const r = await moveWallet({ id: w.id, accountId });
          setMsg(`Moved to ${target} with ${r.trades} trade${r.trades === 1 ? "" : "s"}`);
        }
        setConfirmMove(false);
        router.refresh();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Couldn't save");
      }
    });

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      data-testid="wallet-details"
      onSubmit={(e) => {
        e.preventDefault();
        if (!label.trim()) return setMsg("Give the wallet a name");
        if (moving && !confirmMove) return setConfirmMove(true);
        save();
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor={`wl-${w.id}`} className="text-muted-foreground text-xs">
          Name
        </Label>
        <Input
          id={`wl-${w.id}`}
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          className="h-8 w-40"
        />
      </div>
      <div className="grid gap-1">
        <Label className="text-muted-foreground text-xs">Type</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as Wallet["kind"])}>
          <SelectTrigger className="h-8 w-36" aria-label="Wallet type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_LABEL) as Wallet["kind"][]).map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {accounts.length > 1 && (
        <div className="grid gap-1">
          <Label className="text-muted-foreground text-xs">Journal account</Label>
          <Select
            value={accountId}
            onValueChange={(v) => {
              setAccountId(v);
              setConfirmMove(false);
            }}
          >
            <SelectTrigger className="h-8 w-40" aria-label="Journal account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {confirmMove ? (
        <span className="flex flex-wrap items-center gap-2 text-xs" role="alert">
          Move this wallet and its {w.trades} trade{w.trades === 1 ? "" : "s"} to {target}? Journal entries go
          with them; you can move it back.
          <Button type="submit" size="sm" disabled={pending}>
            Move
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => (setConfirmMove(false), setAccountId(w.accountId))}
          >
            Keep
          </Button>
        </span>
      ) : (
        <Button type="submit" size="sm" variant="secondary" disabled={pending || !dirty}>
          Save details
        </Button>
      )}
      {msg && <span className="text-xs">{msg}</span>}
    </form>
  );
}

function AddWallet({ accounts, onDone }: { accounts: { id: string; name: string }[]; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("Main");
  const [kind, setKind] = useState<"main" | "sub" | "vault">("main");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [exchange, setExchange] = useState<Exchange>("hyperliquid");
  const [token, setToken] = useState("");
  const router = useRouter();
  const lighter = exchange === "lighter";
  const valid = lighter ? token.trim().startsWith("ro:") : ADDRESS_RE.test(address.trim());

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Add wallet</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setMsg(null);
              if (lighter) {
                const r = await addLighterAccount({ token, label, accountId });
                setToken("");
                if (!r.ok) return setMsg(r.error);
                router.refresh();
                return onDone();
              }
              try {
                await addWallet({ address, label, kind, accountId });
                setAddress("");
                onDone();
              } catch (err) {
                setMsg(err instanceof Error ? err.message : "Could not add wallet");
              }
            });
          }}
        >
          <div className="grid gap-1.5 sm:col-span-2">
            <Label className="text-muted-foreground text-xs">Exchange</Label>
            <Select value={exchange} onValueChange={(v) => (setExchange(v as Exchange), setMsg(null))}>
              <SelectTrigger className="w-full" aria-label="Exchange">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hyperliquid">Hyperliquid</SelectItem>
                <SelectItem value="lighter">Lighter</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {lighter ? (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="new-lighter-token" className="text-muted-foreground text-xs">
                Read-only token
              </Label>
              <TokenInput id="new-lighter-token" value={token} onChange={setToken} />
              <span className="text-muted-foreground text-xs">
                Create one in Lighter under Read-only tokens. It starts with ro: and can&apos;t trade or
                withdraw. Never paste an API key or a private key.
              </span>
              {token.trim() !== "" && !valid && (
                <span className="text-destructive text-xs">Must start with ro:</span>
              )}
            </div>
          ) : (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label className="text-muted-foreground text-xs">Wallet address (public, read-only)</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
              {address && !valid && (
                <span className="text-destructive text-xs">Must be 0x followed by 40 hex characters.</span>
              )}
            </div>
          )}
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          </div>
          {!lighter && (
            <div className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs">Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="main">Main account</SelectItem>
                  <SelectItem value="sub">Sub-account</SelectItem>
                  <SelectItem value="vault">Vault</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Journal account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending || !valid || !accountId}>
              {pending ? "Adding…" : lighter ? "Add Lighter account" : "Add wallet"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            {msg && <span className="text-destructive text-xs">{msg}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RunsTable({ runs, tz }: { runs: Run[]; tz: string }) {
  if (!runs.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Recent syncs</h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground bg-muted/40 text-left">
            <tr>
              {["Started", "Wallet", "Trigger", "Status", "Pages", "New fills", "Trades", "Gaps", "Note"].map(
                (h) => (
                  <th key={h} className="px-2 py-1.5 font-medium">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="px-2 py-1.5 whitespace-nowrap">{fmtDateTime(r.startedAt, tz)}</td>
                <td className="px-2 py-1.5">{r.wallet}</td>
                <td className="px-2 py-1.5">{r.trigger}</td>
                <td
                  className={cn(
                    "px-2 py-1.5",
                    r.status === "error" && "text-destructive",
                    r.status === "partial" && "text-ink-2",
                    r.status === "success" && "text-profit",
                  )}
                >
                  {r.status}
                </td>
                <td className="px-2 py-1.5 tabular-nums">{r.pages}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.fillsNew}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.tradesTouched}</td>
                <td className={cn("px-2 py-1.5 tabular-nums", r.gapsDetected > 0 && "text-gold-ink")}>
                  {r.gapsDetected}
                </td>
                <td
                  className="text-muted-foreground max-w-64 truncate px-2 py-1.5"
                  title={r.error ?? undefined}
                >
                  {r.error ?? (r.status === "partial" ? "continues next run" : "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="opacity-70">{label}</dt>
      <dd className="text-foreground tabular-nums">{value}</dd>
    </div>
  );
}
