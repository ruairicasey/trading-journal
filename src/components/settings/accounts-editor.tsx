"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { archiveAccount, saveAccount } from "@/app/(app)/settings/actions";

type Account = {
  id: string;
  name: string;
  type: "crypto" | "prop" | "other";
  startingBalance: number;
  standardRiskPct: number;
  currency: string;
  /** YYYY-MM-DD in your timezone, or "" */
  journalStartDate: string;
  dailyLossLimit: number | null;
  maxTradesPerDay: number | null;
  maxLossStreak: number | null;
  goalMonthlyNet: number | null;
  goalMonthlyTrades: number | null;
  goalReviewPct: number | null;
};

export function AccountsEditor({ accounts, timezone }: { accounts: Account[]; timezone: string }) {
  const [adding, setAdding] = useState(accounts.length === 0);
  return (
    <div className="space-y-4">
      {accounts.map((a) => (
        <AccountForm key={a.id} account={a} canArchive={accounts.length > 1} timezone={timezone} />
      ))}
      {adding ? (
        <AccountForm onDone={() => setAdding(false)} timezone={timezone} />
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> New account
        </Button>
      )}
    </div>
  );
}

function AccountForm({
  account,
  canArchive,
  onDone,
  timezone,
}: {
  account?: Account;
  canArchive?: boolean;
  onDone?: () => void;
  timezone: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [type, setType] = useState<Account["type"]>(account?.type ?? "crypto");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{account ? account.name : "New account"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          action={(fd) =>
            start(async () => {
              setMsg(null);
              try {
                await saveAccount({
                  id: account?.id,
                  name: String(fd.get("name") ?? ""),
                  type,
                  startingBalance: String(fd.get("startingBalance") ?? "0"),
                  standardRiskPct: String(fd.get("standardRiskPct") ?? "1"),
                  currency: String(fd.get("currency") ?? "USD"),
                  journalStartDate: String(fd.get("journalStartDate") ?? ""),
                  dailyLossLimit: String(fd.get("dailyLossLimit") ?? ""),
                  maxTradesPerDay: String(fd.get("maxTradesPerDay") ?? ""),
                  maxLossStreak: String(fd.get("maxLossStreak") ?? ""),
                  goalMonthlyNet: String(fd.get("goalMonthlyNet") ?? ""),
                  goalMonthlyTrades: String(fd.get("goalMonthlyTrades") ?? ""),
                  goalReviewPct: String(fd.get("goalReviewPct") ?? ""),
                });
                setMsg("Saved");
                onDone?.();
              } catch (e) {
                setMsg(e instanceof Error ? e.message : "Could not save");
              }
            })
          }
        >
          <Field label="Name">
            <Input name="name" defaultValue={account?.name} required maxLength={120} />
          </Field>
          <Field label="Type">
            <Select value={type} onValueChange={(v) => setType(v as Account["type"])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="crypto">Crypto</SelectItem>
                <SelectItem value="prop">Prop</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Starting balance">
            <Input
              name="startingBalance"
              type="number"
              step="any"
              min={0}
              defaultValue={account?.startingBalance ?? 0}
            />
          </Field>
          <Field label="Standard risk % per trade">
            <Input
              name="standardRiskPct"
              type="number"
              step="any"
              min={0}
              max={100}
              defaultValue={account?.standardRiskPct ?? 1}
            />
          </Field>
          <Field label="Currency">
            <Input name="currency" defaultValue={account?.currency ?? "USD"} maxLength={8} />
          </Field>
          <Field label="Journal starts on">
            <Input name="journalStartDate" type="date" defaultValue={account?.journalStartDate ?? ""} />
            <span className="text-muted-foreground text-xs">
              Stats, reports and lists use trades opened from midnight that day ({timezone}). Choose All time
              to see older ones. Leave empty to use everything.
            </span>
          </Field>
          <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3" aria-label="Risk rules">
            <legend className="text-13 mb-1 font-medium">Risk rules</legend>
            <Field label="Daily loss limit ($)">
              <Input
                name="dailyLossLimit"
                type="number"
                step="any"
                min={0}
                placeholder="Off"
                defaultValue={account?.dailyLossLimit ?? ""}
              />
            </Field>
            <Field label="Max trades a day">
              <Input
                name="maxTradesPerDay"
                type="number"
                step={1}
                min={1}
                placeholder="Off"
                defaultValue={account?.maxTradesPerDay ?? ""}
              />
            </Field>
            <Field label="Stop after losses in a row">
              <Input
                name="maxLossStreak"
                type="number"
                step={1}
                min={1}
                placeholder="Off"
                defaultValue={account?.maxLossStreak ?? ""}
              />
            </Field>
            <span className="text-muted-foreground text-xs sm:col-span-3">
              Days run midnight to midnight ({timezone}). A trade breaks a rule when you opened it after that
              day&apos;s realised loss reached the limit, beyond the day&apos;s trade cap, or after that many
              losses in a row that day. Leave a box empty to turn that rule off.
            </span>
          </fieldset>
          <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3" aria-label="Monthly goals">
            <legend className="text-13 mb-1 font-medium">Monthly goals</legend>
            <Field label="Net target ($)">
              <Input
                name="goalMonthlyNet"
                type="number"
                step="any"
                min={0}
                placeholder="Off"
                defaultValue={account?.goalMonthlyNet ?? ""}
              />
            </Field>
            <Field label="Most trades a month">
              <Input
                name="goalMonthlyTrades"
                type="number"
                step={1}
                min={1}
                placeholder="Off"
                defaultValue={account?.goalMonthlyTrades ?? ""}
              />
            </Field>
            <Field label="Review at least (%)">
              <Input
                name="goalReviewPct"
                type="number"
                step={1}
                min={1}
                max={100}
                placeholder="Off"
                defaultValue={account?.goalReviewPct ?? ""}
              />
            </Field>
            <span className="text-muted-foreground text-xs sm:col-span-3">
              Calendar months ({timezone}), over the whole account. Net counts trades closed that month, trades
              count those opened that month, and review counts closed trades marked reviewed. The dashboard shows
              this month and how many of the last six you hit. Leave a box empty to turn that goal off.
            </span>
          </fieldset>
          <div className="flex items-end gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {account && canArchive && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    try {
                      await archiveAccount(account.id);
                    } catch (e) {
                      setMsg(e instanceof Error ? e.message : "Could not archive");
                    }
                  })
                }
              >
                Archive
              </Button>
            )}
            {onDone && (
              <Button type="button" size="sm" variant="ghost" onClick={onDone}>
                Cancel
              </Button>
            )}
            {msg && <span className="text-muted-foreground text-xs">{msg}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      {children}
    </div>
  );
}
