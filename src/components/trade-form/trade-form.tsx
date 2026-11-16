"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertCircle, Check, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { revertToAutoAction, saveTradeBasicAction } from "@/app/(app)/trades/[id]/actions";
import { AnalysisTab } from "./analysis-tab";
import { BasicTab } from "./basic-tab";
import { NotesTab } from "./notes-tab";
import { toast } from "sonner";
import {
  initialDraft,
  protectionBase,
  toPayload,
  type AnalysisDraft,
  type Draft,
  type FormProps,
  type NotesDraft,
  type ProtectionField,
  type ProtectionState,
} from "./types";

type Status = { kind: "saved"; at: number | null } | { kind: "dirty" } | { kind: "saving" } | { kind: "error"; message: string };

const AUTOSAVE_MS = 1200;

export function TradeForm(props: FormProps) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(props.data));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const payload = useMemo(() => toPayload(draft), [draft]);
  const json = useMemo(() => JSON.stringify(payload.input), [payload]);
  const savedJson = useRef(json);
  const [status, setStatus] = useState<Status>({ kind: "saved", at: props.data.journal?.updatedAt ?? null });
  const [, start] = useTransition();
  const inFlight = useRef(false);
  // auto-detected SL/TP: who owns each field, and the values last loaded/saved (sent with every save)
  const [protection, setProtection] = useState<ProtectionState>(props.data.protection);
  const base = useRef(protectionBase(initialDraft(props.data)));

  const dirty = json !== savedJson.current;

  const save = useCallback(() => {
    if (!payload.input || inFlight.current) return;
    const body = json;
    const input = payload.input;
    const sentBase = base.current;
    inFlight.current = true;
    setStatus({ kind: "saving" });
    start(async () => {
      try {
        const res = await saveTradeBasicAction(props.data.trade.id, input, sentBase);
        if (res.ok) {
          savedJson.current = body;
          const next = protectionBase(input);
          const changed = (k: "stopLoss" | "takeProfit" | "tpPartials") => JSON.stringify(next[k]) !== JSON.stringify(sentBase[k]);
          setProtection((p) => ({
            ...p,
            sources: {
              stopLoss: changed("stopLoss") ? "user" : p.sources.stopLoss,
              takeProfit: changed("takeProfit") ? "user" : p.sources.takeProfit,
              tpPartials: changed("tpPartials") ? "user" : p.sources.tpPartials,
            },
          }));
          base.current = next;
          setErrors({});
          setStatus({ kind: "saved", at: res.savedAt });
        } else {
          setErrors(res.errors as Record<string, string>);
          setStatus({ kind: "error", message: Object.values(res.errors)[0] ?? "Could not save" });
        }
      } catch {
        setStatus({ kind: "error", message: "Network error. Your changes are still here; try saving again." });
      } finally {
        inFlight.current = false;
      }
    });
  }, [json, payload.input, props.data.trade.id]);

  // autosave after a pause in typing
  useEffect(() => {
    if (!dirty) return;
    if (payload.error) {
      setStatus({ kind: "error", message: payload.error });
      return;
    }
    setStatus((s) => (s.kind === "saving" ? s : { kind: "dirty" }));
    const t = setTimeout(save, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [json, dirty, payload.error, save]);

  // ⌘S / Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // warn before leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const updateAnalysis = useCallback((patch: Partial<AnalysisDraft>) => setDraft((d) => ({ ...d, analysis: { ...d.analysis, ...patch } })), []);
  const updateNotes = useCallback((patch: Partial<NotesDraft>) => setDraft((d) => ({ ...d, notes: { ...d.notes, ...patch } })), []);
  const revert = useCallback(
    async (field: ProtectionField) => {
      const res = await revertToAutoAction(props.data.trade.id, field);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const patch: Partial<Draft> =
        field === "stopLoss" ? { stopLoss: res.stopLoss } : field === "takeProfit" ? { takeProfit: res.takeProfit } : { tpPartials: res.tpPartials };
      setDraft((d) => {
        const next = { ...d, ...patch };
        // the server already holds these values: don't autosave them back as a user edit
        base.current = { ...base.current, [field]: protectionBase(next)[field] };
        if (JSON.stringify(toPayload(d).input) === savedJson.current) savedJson.current = JSON.stringify(toPayload(next).input);
        return next;
      });
      setProtection((p) => ({ ...p, sources: { ...p.sources, [field]: "auto" } }));
      toast.success("Reverted to your exchange order");
    },
    [props.data.trade.id],
  );
  const [tab, setTab] = useState("basic");
  const account = props.accounts.find((a) => a.id === draft.accountId);
  const a = draft.analysis;
  const n = draft.notes;
  const hasAnalysis = !!(a.entryTimeframe || a.timeframeClass || a.marketCondition || a.grade || a.confluences.length || a.slReasons.length || a.tpReasons.length);
  const hasNotes = !!(n.rationale?.trim() || n.postNotes?.trim() || n.tags.length || n.rulesFollowed || n.exitReasonId || props.data.screenshots.length);
  const updateManual = useCallback(
    (patch: Partial<NonNullable<Draft["manual"]>>) => setDraft((d) => (d.manual ? { ...d, manual: { ...d.manual, ...patch } } : d)),
    [],
  );

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-4">
      <div className="bg-background/95 sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b px-4 py-2 backdrop-blur md:-mx-6 md:px-6">
        <TabsList>
          <TabsTrigger value="basic">Basic</TabsTrigger>
          <TabsTrigger value="analysis">
            Analysis {hasAnalysis && <span className="bg-primary size-1.5 rounded-full" aria-label="has content" />}
          </TabsTrigger>
          <TabsTrigger value="notes">
            Notes {hasNotes && <span className="bg-primary size-1.5 rounded-full" aria-label="has content" />}
          </TabsTrigger>
        </TabsList>
        <div className="flex-1" />
        <SaveStatus status={status} dirty={dirty} />
        <Button size="sm" onClick={save} disabled={!dirty || !payload.input || status.kind === "saving"}>
          <Save className="size-4" /> Save
          <kbd className="ml-1 hidden rounded border border-current/30 px-1 text-[10px] opacity-70 sm:inline">⌘S</kbd>
        </Button>
      </div>
      <TabsContent value="basic">
        <BasicTab {...props} draft={draft} update={update} updateManual={updateManual} errors={errors} protection={protection} onRevert={revert} />
      </TabsContent>
      <TabsContent value="analysis">
        <AnalysisTab data={props.data} value={draft.analysis} onChange={updateAnalysis} standardRiskPct={account?.standardRiskPct ?? null} />
      </TabsContent>
      <TabsContent value="notes" forceMount className="data-[state=inactive]:hidden">
        <NotesTab data={props.data} value={draft.notes} onChange={updateNotes} active={tab === "notes"} />
      </TabsContent>
    </Tabs>
  );
}

function SaveStatus({ status, dirty }: { status: Status; dirty: boolean }) {
  const base = "flex items-center gap-1.5 text-xs";
  if (status.kind === "saving")
    return (
      <span className={cn(base, "text-muted-foreground")} data-testid="save-status">
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  if (status.kind === "error")
    return (
      <span className={cn(base, "text-destructive")} data-testid="save-status" role="alert">
        <AlertCircle className="size-3.5" /> {status.message}
      </span>
    );
  if (dirty || status.kind === "dirty")
    return (
      <span className={cn(base, "text-amber-400")} data-testid="save-status">
        Unsaved changes
      </span>
    );
  return (
    <span className={cn(base, "text-muted-foreground")} data-testid="save-status">
      <Check className="size-3.5" />{" "}
      {status.at ? `Saved ${new Date(status.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "No changes"}
    </span>
  );
}
