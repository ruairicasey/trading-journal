import { Settings } from "lucide-react";
import { EmptyState } from "@/components/shell/empty-state";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>
      <EmptyState
        icon={Settings}
        title="Coming in step 2"
        body="Accounts, wallets, journal vocabulary, sessions and timezone. Personal values live in the database, never in code."
      />
    </div>
  );
}
