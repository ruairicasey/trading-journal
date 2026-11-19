"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Link2, RefreshCw, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fmtDateTime, timeAgo } from "@/lib/format";
import {
  disconnectCtrader,
  importCtraderCsv,
  refreshCtraderAccounts,
  syncCtraderNow,
  updateCtraderAccount,
} from "@/app/(app)/settings/ctrader/actions";

type Account = {
  ctid: number;
  login: number | null;
  broker: string | null;
  isLive: boolean;
  currency: string | null;
  accountId: string;
  enabled: boolean;
  connected: boolean;
  lastSyncedAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  dealsSyncedTo: number | null;
  deals: number;
};

const FLASH_ERRORS: Record<string, string> = {
  demo: "cTrader is disabled for the demo account.",
  "not-configured": "cTrader isn't configured yet (see below).",
  state: "That sign-in didn't start here (or took over 10 minutes). Try Connect again.",
  denied: "Access wasn't granted in cTrader.",
  "no-code": "cTrader didn't return a sign-in code. Try Connect again.",
  token:
    "cTrader refused the sign-in code. Try Connect again; check the app's client ID, secret and redirect URI.",
  "trade-scope":
    "That grant allowed trading, so it was discarded. This journal only accepts view-only access.",
  discovery: "Connected, but listing your accounts failed. Use Refresh accounts.",
};

export function CtraderSettings(p: {
  isDemo: boolean;
  configured: boolean;
  timezone: string;
  flash: { connected: string | null; added: string | null; error: string | null };
  connection: { since: number; expiresAt: number; lastError: string | null } | null;
  journalAccounts: { id: string; name: string }[];
  accounts: Account[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const run = (fn: () => Promise<string | void>) =>
    start(async () => {
      setMsg(null);
      try {
        const text = await fn();
        if (text) setMsg({ ok: true, text });
        router.refresh();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
      }
    });

  const flashError = p.flash.error ? (FLASH_ERRORS[p.flash.error] ?? "Something went wrong.") : null;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Sync a cTrader account (e.g. a prop-firm challenge) through the cTrader Open API with{" "}
        <strong>view-only</strong> access: the journal can read your accounts and history, never trade. Tokens
        are stored encrypted.
      </p>

      {(flashError || p.flash.connected) && (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${flashError ? "border-destructive text-destructive" : ""}`}
          role="status"
        >
          {flashError ??
            `Connected: ${p.flash.connected} account${p.flash.connected === "1" ? "" : "s"} found${
              p.flash.added && p.flash.added !== "0" ? `, ${p.flash.added} added as journal accounts` : ""
            }.`}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {p.isDemo ? (
            <p className="text-muted-foreground">Disabled for the demo account.</p>
          ) : !p.configured ? (
            <div className="space-y-2" data-testid="ctrader-setup">
              <p>Not configured. Add these environment variables in Vercel (Production), then redeploy:</p>
              <ul className="list-disc pl-5 font-mono text-xs">
                <li>CTRADER_CLIENT_ID: from your app at openapi.ctrader.com</li>
                <li>CTRADER_CLIENT_SECRET: from the same app</li>
                <li>CTRADER_TOKEN_KEY: a random value of 32+ characters (`npm run gen-secret`)</li>
              </ul>
              <p className="text-muted-foreground">
                The app&apos;s redirect URI must be exactly{" "}
                <code className="text-xs">{origin}/api/ctrader/callback</code>.
              </p>
            </div>
          ) : !p.connection ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="sm">
                <a href="/api/ctrader/connect">
                  <Link2 className="size-4" /> Connect cTrader
                </a>
              </Button>
              <span className="text-muted-foreground">
                Opens cTrader to grant view-only access (scope: accounts).
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <p>
                <Badge variant="outline">view-only</Badge> Connected {timeAgo(p.connection.since)}; access
                renews automatically (current token valid until{" "}
                {fmtDateTime(p.connection.expiresAt, p.timezone)}).
              </p>
              {p.connection.lastError && <p className="text-destructive">{p.connection.lastError}</p>}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const r = await refreshCtraderAccounts();
                      return `${r.found} account${r.found === 1 ? "" : "s"} found, ${r.added} added.`;
                    })
                  }
                >
                  <RefreshCw className="size-4" /> Refresh accounts
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const r = await syncCtraderNow();
                      const err = r.results.find((x) => x.status === "error");
                      if (err) throw new Error(err.error ?? "Sync failed");
                      const deals = r.results.reduce((a, x) => a + x.dealsFetched, 0);
                      return `Synced: ${deals} deal${deals === 1 ? "" : "s"} read${r.done ? "" : ", more to fetch (run again)"}.`;
                    })
                  }
                >
                  <RefreshCw className="size-4" /> Sync now
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <a href="/api/ctrader/connect">Reconnect</a>
                </Button>
                {confirmDisconnect ? (
                  <>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          await disconnectCtrader();
                          setConfirmDisconnect(false);
                          return "Disconnected. Your trades are kept.";
                        })
                      }
                    >
                      Confirm disconnect
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(false)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(true)}>
                    Disconnect
                  </Button>
                )}
              </div>
            </div>
          )}
          {msg && (
            <p className={msg.ok ? "text-muted-foreground" : "text-destructive"} role="status">
              {msg.text}
            </p>
          )}
        </CardContent>
      </Card>

      {p.accounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {p.accounts.map((a) => (
              <div key={a.ctid} className="space-y-2 rounded-md border p-3" data-testid="ctrader-account">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {a.broker ?? "cTrader"} {a.login ?? a.ctid}
                  </span>
                  <Badge variant="outline">{a.isLive ? "live" : "demo"}</Badge>
                  {a.currency && <Badge variant="outline">{a.currency}</Badge>}
                  {!a.connected && <Badge variant="outline">not connected</Badge>}
                  <label className="ml-auto flex items-center gap-2">
                    <span className="text-muted-foreground">Sync</span>
                    <Switch
                      checked={a.enabled}
                      disabled={pending}
                      onCheckedChange={(v) =>
                        run(async () => updateCtraderAccount({ ctid: a.ctid, enabled: v }))
                      }
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">Journal account</span>
                  <Select
                    value={a.accountId}
                    disabled={pending}
                    onValueChange={(v) =>
                      run(async () => updateCtraderAccount({ ctid: a.ctid, accountId: v }))
                    }
                  >
                    <SelectTrigger className="h-8 w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {p.journalAccounts.map((j) => (
                        <SelectItem key={j.id} value={j.id}>
                          {j.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-muted-foreground text-xs">
                  {a.deals} deal{a.deals === 1 ? "" : "s"} · history to{" "}
                  {a.dealsSyncedTo ? fmtDateTime(a.dealsSyncedTo, p.timezone) : "—"} · last sync{" "}
                  {a.lastSyncedAt ? timeAgo(a.lastSyncedAt) : "never"}
                </p>
                {a.currency && a.currency !== "USD" && (
                  <p className="text-xs text-gold-ink">
                    This account is in {a.currency}: its P&amp;L is shown as is, not converted to USD, so keep
                    it out of all-account totals.
                  </p>
                )}
                {a.lastError && <p className="text-destructive text-xs">{a.lastError}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!p.isDemo && (
        <CsvImport timezone={p.timezone} accounts={p.accounts} journalAccounts={p.journalAccounts} />
      )}
    </div>
  );
}

type Preview = Awaited<ReturnType<typeof importCtraderCsv>>;

function CsvImport(p: {
  timezone: string;
  accounts: Account[];
  journalAccounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const first = p.accounts[0];
  const [accountId, setAccountId] = useState(first?.accountId ?? p.journalAccounts[0]?.id ?? "");
  const [login, setLogin] = useState(first?.login ? String(first.login) : "");
  const [tz, setTz] = useState("UTC");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const call = (commit: boolean) =>
    start(async () => {
      setErr(null);
      try {
        const r = await importCtraderCsv({ text: file!.text, accountId, login, tz, commit });
        setPreview(r);
        if (commit) router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Import failed");
      }
    });
  const money = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Import a cTrader history file</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          A backup for history the API can&apos;t reach: in cTrader, History → export, saved as CSV with
          English headers and all columns on. You&apos;ll see a preview first; importing the same file twice
          changes nothing, and a later API sync replaces imported trades with the exchange&apos;s own figures.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ct-file">File</Label>
            <Input
              id="ct-file"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setPreview(null);
                setErr(null);
                if (!f) return setFile(null);
                if (f.size > 900_000) return setErr("That file is over 900 KB: export a shorter date range.");
                setFile({ name: f.name, text: await f.text() });
              }}
            />
          </div>
          <div className="space-y-1">
            <Label>Journal account</Label>
            <Select value={accountId} onValueChange={(v) => (setAccountId(v), setPreview(null))}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Pick an account" />
              </SelectTrigger>
              <SelectContent>
                {p.journalAccounts.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ct-login">cTrader account login</Label>
            <Input
              id="ct-login"
              inputMode="numeric"
              value={login}
              onChange={(e) => (setLogin(e.target.value), setPreview(null))}
              placeholder="digits, as shown in cTrader"
            />
          </div>
          <div className="space-y-1">
            <Label>Times in the file are in</Label>
            <Select value={tz} onValueChange={(v) => (setTz(v), setPreview(null))}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UTC">UTC (cTrader&apos;s default)</SelectItem>
                {p.timezone !== "UTC" && <SelectItem value={p.timezone}>{p.timezone}</SelectItem>}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !file || !login || !accountId}
            onClick={() => call(false)}
          >
            Preview
          </Button>
          <Button
            size="sm"
            disabled={
              pending ||
              !preview ||
              preview.imported !== null ||
              preview.missing.length > 0 ||
              preview.trades === 0
            }
            onClick={() => call(true)}
          >
            <Upload className="size-4" /> Import{" "}
            {preview && preview.imported === null ? `${preview.trades} trades` : ""}
          </Button>
        </div>
        {err && <p className="text-destructive">{err}</p>}
        {preview && (
          <div className="space-y-1 rounded-md border p-3" data-testid="ctrader-preview">
            {preview.missing.length ? (
              <p className="text-destructive">Columns not found: {preview.missing.join(", ")}.</p>
            ) : (
              <p>
                {preview.rows} rows → {preview.trades} closed trades
                {preview.first && preview.last
                  ? `, ${fmtDateTime(preview.first, p.timezone)} → ${fmtDateTime(preview.last, p.timezone)}`
                  : ""}
                , net <span className="money">{money(preview.net)}</span>.
              </p>
            )}
            {preview.issueCount > 0 && (
              <div className="text-xs">
                <p className="text-gold-ink">
                  {preview.issueCount} row{preview.issueCount === 1 ? "" : "s"} flagged:
                </p>
                <ul className="text-muted-foreground list-disc pl-5">
                  {preview.issues.map((i) => (
                    <li key={`${i.row}-${i.problem}`}>
                      row {i.row}: {i.problem}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.imported && (
              <p className="font-medium">
                Imported: {preview.imported.created} new, {preview.imported.updated} updated
                {preview.imported.skipped
                  ? `, ${preview.imported.skipped} already synced from the API (kept)`
                  : ""}
                .
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
