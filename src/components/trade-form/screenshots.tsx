"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/image-compress";
import { MAX_SCREENSHOTS } from "@/lib/journal-options";
import { deleteScreenshotAction, moveScreenshotAction, updateScreenshotCaptionAction } from "@/app/(app)/trades/[id]/actions";

export type Shot = { id: string; url: string; caption: string | null; width: number | null; height: number | null };
type Pending = { key: string; name: string; error?: string };

/**
 * Upload by click, drag-drop or paste (Cmd/Ctrl+V while `pasteEnabled`). Images are compressed in the
 * browser, then uploaded to private storage and shown through the authenticated /api/files route.
 */
export function Screenshots({ tradeId, initial, pasteEnabled }: { tradeId: string; initial: Shot[]; pasteEnabled: boolean }) {
  const [shots, setShots] = useState(initial);
  const [pending, setPending] = useState<Pending[]>([]);
  const [drag, setDrag] = useState(false);
  const [view, setView] = useState<Shot | null>(null);
  const [, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const count = useRef(initial.length);
  count.current = shots.length;

  const upload = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (files.length && !images.length) toast.error("Only image files can be added");
      for (const f of images) {
        if (count.current >= MAX_SCREENSHOTS) {
          toast.error(`Up to ${MAX_SCREENSHOTS} screenshots per trade`);
          break;
        }
        count.current++;
        const key = `${Date.now()}-${Math.random()}`;
        setPending((p) => [...p, { key, name: f.name || "Pasted image" }]);
        try {
          const c = await compressImage(f);
          const body = new FormData();
          body.set("tradeId", tradeId);
          body.set("file", c.blob, "screenshot");
          body.set("width", String(c.width));
          body.set("height", String(c.height));
          const res = await fetch("/api/screenshots", { method: "POST", body });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
          setShots((s) => [...s, json as Shot]);
          setPending((p) => p.filter((x) => x.key !== key));
        } catch (e) {
          count.current--;
          const msg = e instanceof Error ? e.message : "Upload failed";
          setPending((p) => p.map((x) => (x.key === key ? { ...x, error: msg } : x)));
          toast.error(msg);
        }
      }
    },
    [tradeId],
  );

  useEffect(() => {
    if (!pasteEnabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return; // let text paste into fields normally
      e.preventDefault();
      void upload(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pasteEnabled, upload]);

  const move = (i: number, dir: -1 | 1) => {
    const shot = shots[i];
    setShots((s) => {
      const n = [...s];
      [n[i], n[i + dir]] = [n[i + dir], n[i]];
      return n;
    });
    start(() => moveScreenshotAction(shot.id, dir < 0 ? "left" : "right"));
  };

  const remove = (shot: Shot) => {
    if (!window.confirm("Delete this screenshot?")) return;
    setShots((s) => s.filter((x) => x.id !== shot.id));
    start(async () => {
      await deleteScreenshotAction(shot.id);
      toast("Screenshot deleted");
    });
  };

  return (
    <div className="grid gap-3" data-testid="screenshots">
      <div
        role="button"
        tabIndex={0}
        aria-label="Add screenshots"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload([...e.dataTransfer.files]);
        }}
        className={cn(
          "text-muted-foreground flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center text-xs transition-colors",
          drag ? "border-primary bg-primary/5" : "hover:border-foreground/30",
        )}
      >
        <ImagePlus className="size-5" />
        <span>
          Drop images, click to choose, or paste with <kbd className="rounded border px-1">⌘/Ctrl V</kbd>
        </span>
        <span className="opacity-70">
          {shots.length}/{MAX_SCREENSHOTS} · compressed automatically
        </span>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          data-testid="screenshot-input"
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      {(shots.length > 0 || pending.length > 0) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shots.map((s, i) => (
            <figure key={s.id} className="group grid gap-1.5" data-testid="screenshot">
              <button type="button" onClick={() => setView(s)} className="bg-muted overflow-hidden rounded-md border" aria-label="View screenshot">
                {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated URL; no image optimizer */}
                <img src={s.url} alt={s.caption ?? `Screenshot ${i + 1}`} className="aspect-video w-full object-cover" loading="lazy" />
              </button>
              <Caption shot={s} onSaved={(caption) => setShots((xs) => xs.map((x) => (x.id === s.id ? { ...x, caption } : x)))} />
              <div className="flex items-center justify-between opacity-70 group-hover:opacity-100">
                <div className="flex">
                  <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Move left" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Move right" disabled={i === shots.length - 1} onClick={() => move(i, 1)}>
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
                <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Delete screenshot" onClick={() => remove(s)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </figure>
          ))}
          {pending.map((p) => (
            <div key={p.key} className="bg-muted/40 flex aspect-video flex-col items-center justify-center gap-1 rounded-md border p-2 text-center text-[11px]">
              {p.error ? (
                <>
                  <span className="text-destructive">{p.error}</span>
                  <button type="button" className="hover:underline" onClick={() => setPending((xs) => xs.filter((x) => x.key !== p.key))}>
                    Dismiss
                  </button>
                </>
              ) : (
                <>
                  <Loader2 className="size-4 animate-spin" /> Uploading…
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-[min(96vw,1400px)] p-2 sm:max-w-[min(96vw,1400px)]">
          <DialogTitle className="sr-only">{view?.caption ?? "Screenshot"}</DialogTitle>
          {view && (
            <figure className="grid gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={view.url} alt={view.caption ?? "Screenshot"} className="max-h-[85vh] w-full rounded object-contain" />
              {view.caption && <figcaption className="text-muted-foreground px-1 text-sm">{view.caption}</figcaption>}
            </figure>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Caption({ shot, onSaved }: { shot: Shot; onSaved: (c: string | null) => void }) {
  const [v, setV] = useState(shot.caption ?? "");
  const [, start] = useTransition();
  const save = () => {
    const next = v.trim() || null;
    if (next === shot.caption) return;
    start(async () => {
      await updateScreenshotCaptionAction(shot.id, next);
      onSaved(next);
    });
  };
  return (
    <Input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      placeholder="Caption"
      maxLength={300}
      className="h-7 text-xs"
      aria-label="Screenshot caption"
    />
  );
}
