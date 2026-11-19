import { AccountsEditor } from "@/components/settings/accounts-editor";
import { localDateKey } from "@/lib/periods";
import { getConfig } from "@/server/config";
import { getSetting, listAccounts } from "@/server/db/queries/settings";

export default async function AccountsPage() {
  const [accounts, tz] = await Promise.all([listAccounts(), getSetting("timezone", getConfig().timezone)]);
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Starting balance drives the equity curve; standard risk % is the default when a trade has no risk
        multiplier. These values are stored in your private database only.
      </p>
      <AccountsEditor
        timezone={tz}
        accounts={accounts.map((a) => ({
          ...a,
          journalStartDate: a.journalStart === null ? "" : localDateKey(a.journalStart, tz),
        }))}
      />
    </div>
  );
}
