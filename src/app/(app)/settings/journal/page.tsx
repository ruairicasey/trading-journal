import Link from "next/link";
import { VocabEditor } from "@/components/settings/vocab-editor";
import { listVocab } from "@/server/db/queries/settings";
import { VOCAB_KINDS, type VocabKind } from "@/server/db/schema";
import { VOCAB_KIND_LABELS } from "@/server/db/seed-data";
import { cn } from "@/lib/utils";

const HELP: Partial<Record<VocabKind, string>> = {
  checklist:
    "Your pre-trade checklist. Replace these with your own A-tier criteria; each trade records which ones you ticked.",
  confluence: "Tag pickers group by category. Star favourites to pin them to the top of the picker.",
  strategy: "Setups you trade. Each trade gets one strategy.",
};

export default async function JournalListsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const sp = await searchParams;
  const kind: VocabKind = (VOCAB_KINDS as readonly string[]).includes(sp.kind ?? "")
    ? (sp.kind as VocabKind)
    : "checklist";
  const data = await listVocab(kind);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[180px_minmax(0,1fr)]">
      <ul className="flex min-w-0 flex-wrap gap-1 md:flex-col">
        {VOCAB_KINDS.map((k) => (
          <li key={k}>
            <Link
              href={`/settings/journal?kind=${k}`}
              aria-current={k === kind ? "page" : undefined}
              className={cn(
                "block rounded-lg px-2.5 py-1.5 text-sm",
                k === kind ? "bg-subtle text-ink font-medium" : "text-ink-2 hover:text-ink",
              )}
            >
              {VOCAB_KIND_LABELS[k]}
            </Link>
          </li>
        ))}
      </ul>
      <div className="min-w-0 space-y-3">
        <div>
          <h2 className="text-17 font-semibold tracking-[-0.01em]">{VOCAB_KIND_LABELS[kind]}</h2>
          {HELP[kind] && <p className="text-muted-foreground text-sm">{HELP[kind]}</p>}
        </div>
        <VocabEditor key={kind} kind={kind} data={data} />
      </div>
    </div>
  );
}
