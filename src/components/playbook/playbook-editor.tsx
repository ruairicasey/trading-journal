"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { savePlaybookAction } from "@/app/(app)/playbook/actions";

const DESCRIPTION_MAX = 500;
const RULES_MAX = 4000;

/** Edit a strategy's description and rules in place. Sends only the fields you changed. */
export function PlaybookEditor({
  id,
  description,
  rules,
}: {
  id: string;
  description: string;
  rules: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState(description);
  const [text, setText] = useState(rules);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open)
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setDesc(description);
          setText(rules);
          setError(null);
          setOpen(true);
        }}
        data-testid="playbook-edit"
      >
        {rules ? "Edit rules" : "Write rules"}
      </Button>
    );

  const save = () =>
    start(async () => {
      const patch: { description?: string; rules?: string } = {};
      if (desc !== description) patch.description = desc;
      if (text !== rules) patch.rules = text;
      const res = await savePlaybookAction(id, patch);
      if (!res.ok) return setError(res.error);
      setOpen(false);
      router.refresh();
    });

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      data-testid="playbook-form"
    >
      <label className="text-ink-2 text-xs font-medium" htmlFor={`desc-${id}`}>
        What it is
      </label>
      <Textarea
        id={`desc-${id}`}
        name="description"
        value={desc}
        maxLength={DESCRIPTION_MAX}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="One line on the setup, e.g. 4h range low swept, then reclaimed"
        className="min-h-10"
      />
      <label className="text-ink-2 text-xs font-medium" htmlFor={`rules-${id}`}>
        Rules, one per line
      </label>
      <Textarea
        id={`rules-${id}`}
        name="rules"
        value={text}
        maxLength={RULES_MAX}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
        placeholder={"Daily bias agrees\nStop beyond the sweep\nAt least 2R to the first target"}
        className="min-h-28"
      />
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
