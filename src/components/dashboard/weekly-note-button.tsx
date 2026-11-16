"use client";

import { useState } from "react";
import { NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NoteDialog } from "@/components/trades/notes-list";

type Note = { id: string; title: string | null; body: string; date: number };

/** Opens this week's note if it exists, else a new one pre-filled with the reflection template. */
export function WeeklyNoteButton({ existing, draft }: { existing: Note | null; draft: Omit<Note, "id"> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" className="h-7" onClick={() => setOpen(true)} data-testid="weekly-note">
        <NotebookPen className="size-3.5" /> {existing ? "Open weekly note" : "Write weekly note"}
      </Button>
      <NoteDialog open={open} onOpenChange={setOpen} note={existing ?? undefined} draft={existing ? undefined : draft} />
    </>
  );
}
