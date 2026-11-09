import { ListOrdered } from "lucide-react";
import { EmptyState } from "@/components/shell/empty-state";

export default function TradesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Trades</h1>
      <EmptyState
        icon={ListOrdered}
        title="Nothing imported"
        body="Trades reconstructed from your Hyperliquid fills will appear here."
      />
    </div>
  );
}
