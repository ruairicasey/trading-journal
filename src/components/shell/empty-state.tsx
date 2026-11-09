import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
      <Icon className="text-muted-foreground size-8" />
      <h2 className="text-base font-medium">{title}</h2>
      <p className="text-muted-foreground max-w-sm text-sm">{body}</p>
    </div>
  );
}
