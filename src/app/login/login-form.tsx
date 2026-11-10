"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpenText, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <div className="bg-sidebar-primary text-sidebar-primary-foreground mb-2 flex size-10 items-center justify-center rounded-md">
          <BookOpenText className="size-5" />
        </div>
        <CardTitle className="text-base">Trading Journal</CardTitle>
        <p className="text-muted-foreground text-xs">Private instance. Sign in to continue.</p>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            try {
              const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password, next }),
              });
              const json = await res.json().catch(() => ({}));
              if (!res.ok) {
                setError(json.error ?? "Sign-in failed");
                setPassword("");
                return;
              }
              router.replace(json.next ?? "/dashboard");
              router.refresh();
            } finally {
              setPending(false);
            }
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="password" className="text-xs">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-destructive text-xs">{error}</p>}
          <Button type="submit" className="w-full" disabled={pending || !password}>
            <Lock className="size-4" /> {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
