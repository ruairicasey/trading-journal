import { LayoutDashboard } from "lucide-react";
import { EmptyState } from "@/components/shell/empty-state";

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Dashboard</h1>
      <EmptyState
        icon={LayoutDashboard}
        title="No trades yet"
        body="Add a Hyperliquid wallet in Settings and sync, or run npm run seed:demo to explore with fake data."
      />
    </div>
  );
}
