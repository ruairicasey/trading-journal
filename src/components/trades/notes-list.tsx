"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { NotebookPen, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime } from "@/lib/format";
import { deleteNoteAction, saveNoteAction } from "@/app/(app)/trades/actions";

type Note = { id: string; title: string | null; body: string; date: number };

export function AddNoteButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" className="h-8" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add note
      </Button>
      <NoteDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function NotesList({ notes, tz }: { notes: Note[]; tz: string }) {
  const [editing, setEditing] = useState<Note | null>(null);
  const [pending, start] = useTransition();
  if (!notes.length) return null;
  return (
    <>
      <ul className="divide-y rounded-lg border" data-testid="notes-list">
        {notes.map((n) => (
          <li key={n.id} className="group flex gap-3 px-3 py-2.5">
            <NotebookPen className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium">{n.title || "Untitled note"}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{fmtDateTime(n.date, tz)}</span>
              </div>
              <p className="text-muted-foreground line-clamp-2 text-xs whitespace-pre-line">{n.body}</p>
            </div>
            <div className="flex shrink-0 items-start opacity-60 group-hover:opacity-100">
              <Button variant="ghost" size="icon" className="size-7" aria-label="Edit note" onClick={() => setEditing(n)}>
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Delete note"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    if (!window.confirm("Delete this note?")) return;
                    await deleteNoteAction(n.id);
                    toast("Note deleted");
                  })
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <NoteDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} note={editing ?? undefined} />
    </>
  );
}

function toLocalInput(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function NoteDialog({ open, onOpenChange, note }: { open: boolean; onOpenChange: (o: boolean) => void; note?: Note }) {
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [when, setWhen] = useState(toLocalInput(note?.date ?? Date.now()));
  const [lastNote, setLastNote] = useState(note);
  if (note !== lastNote) {
    setLastNote(note);
    setTitle(note?.title ?? "");
    setBody(note?.body ?? "");
    setWhen(toLocalInput(note?.date ?? Date.now()));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{note ? "Edit note" : "New note"}</DialogTitle>
        </DialogHeader>
        <form
          id="note-form"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              await saveNoteAction({ id: note?.id, title: title || null, body, date: new Date(when).getTime() });
              toast.success(note ? "Note saved" : "Note added");
              onOpenChange(false);
              if (!note) {
                setTitle("");
                setBody("");
              }
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly review, market notes…" maxLength={200} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Date</Label>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Note</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} required />
          </div>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="note-form" disabled={pending || !body.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
