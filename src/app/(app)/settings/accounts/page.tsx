import { AccountsEditor } from "@/components/settings/accounts-editor";
import { listAccounts } from "@/server/db/queries/settings";

export default async function AccountsPage() {
  const accounts = await listAccounts();
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Starting balance drives the equity curve; standard risk % is the default when a trade has no risk multiplier.
        These values are stored in your private database only.
      </p>
      <AccountsEditor accounts={accounts} />
    </div>
  );
}
