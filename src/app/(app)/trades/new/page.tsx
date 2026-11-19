import Link from "next/link";
import { notFound } from "next/navigation";
import { ManualTradeForm } from "@/components/trades/manual-trade-form";
import { getConfig } from "@/server/config";
import { getActiveScope, getSetting } from "@/server/db/queries/settings";

/** Add a trade by hand: the essentials here, then the full Edit form for the rest of the journal. */
export default async function NewTradePage() {
  const { active, walletId } = await getActiveScope();
  if (!active) notFound();
  const tz = await getSetting("timezone", getConfig().timezone);
  return (
    <div className="mx-auto max-w-[720px] space-y-7">
      <header className="flex flex-col gap-3">
        <Link href="/trades" className="link w-fit text-sm">
          All trades
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-22 font-semibold">Add trade</h1>
          <p className="text-muted-foreground text-13">
            For a trade sync can&apos;t see. It goes into {active.name}; you can add the setup, review and
            screenshots next.
            {walletId &&
              " Manual trades belong to no wallet, so with one wallet picked they show under All wallets."}
          </p>
        </div>
      </header>
      <ManualTradeForm tz={tz} accountId={active.id} cfd={active.type !== "crypto"} />
    </div>
  );
}
