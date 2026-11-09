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
};

export function AccountsEditor({ accounts }: { accounts: Account[] }) {
  const [adding, setAdding] = useState(accounts.length === 0);
  return (
    <div className="space-y-4">
      {accounts.map((a) => (
        <AccountForm key={a.id} account={a} canArchive={accounts.length > 1} />
      ))}
      {adding ? (
        <AccountForm onDone={() => setAdding(false)} />
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> New account
        </Button>
      )}
    </div>
  );
}

function AccountForm({ account, canArchive, onDone }: { account?: Account; canArchive?: boolean; onDone?: () => void }) {
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
            <Input name="startingBalance" type="number" step="any" min={0} defaultValue={account?.startingBalance ?? 0} />
          </Field>
          <Field label="Standard risk % per trade">
            <Input name="standardRiskPct" type="number" step="any" min={0} max={100} defaultValue={account?.standardRiskPct ?? 1} />
          </Field>
          <Field label="Currency">
            <Input name="currency" defaultValue={account?.currency ?? "USD"} maxLength={8} />
          </Field>
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
