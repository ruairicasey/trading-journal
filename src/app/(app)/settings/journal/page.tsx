import Link from "next/link";
import { VocabEditor } from "@/components/settings/vocab-editor";
import { listVocab } from "@/server/db/queries/settings";
import { VOCAB_KINDS, type VocabKind } from "@/server/db/schema";
import { VOCAB_KIND_LABELS } from "@/server/db/seed-data";
import { cn } from "@/lib/utils";

const HELP: Partial<Record<VocabKind, string>> = {
  checklist: "Your pre-trade checklist. Replace these with your own A-tier criteria; each trade records which ones you ticked.",
  confluence: "Tag pickers group by category. Star favourites to pin them to the top of the picker.",
  strategy: "Setups you trade. Each trade gets one strategy.",
};

export default async function JournalListsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const sp = await searchParams;
  const kind: VocabKind = (VOCAB_KINDS as readonly string[]).includes(sp.kind ?? "")
    ? (sp.kind as VocabKind)
    : "checklist";
  const data = await listVocab(kind);

  return (
    <div className="grid gap-6 md:grid-cols-[180px_1fr]">
      <ul className="flex flex-wrap gap-1 md:flex-col">
        {VOCAB_KINDS.map((k) => (
          <li key={k}>
            <Link
              href={`/settings/journal?kind=${k}`}
              className={cn(
                "block rounded-md px-2 py-1.5 text-sm",
                k === kind ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {VOCAB_KIND_LABELS[k]}
            </Link>
          </li>
        ))}
      </ul>
      <div className="space-y-3">
        <div>
          <h2 className="font-medium">{VOCAB_KIND_LABELS[kind]}</h2>
          {HELP[kind] && <p className="text-muted-foreground text-sm">{HELP[kind]}</p>}
        </div>
        <VocabEditor key={kind} kind={kind} data={data} />
      </div>
    </div>
  );
}
