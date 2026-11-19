"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock } from "lucide-react";
import { Logo } from "@/components/shell/logo";
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
    <Card className="w-full max-w-sm rounded-2xl py-7 [--card-spacing:--spacing(7)]">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex items-center justify-center gap-2.5">
          <Logo />
          <CardTitle className="text-ink text-17 font-semibold tracking-[-0.01em]">Journal</CardTitle>
        </div>
        <p className="text-muted-foreground text-13">Private instance. Sign in to continue.</p>
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
            <Label htmlFor="password" className="text-muted-foreground text-13 font-normal">
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
          {error && (
            <p className="text-destructive text-13" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="bg-ink hover:bg-ink/90 h-10 w-full rounded-[9px] text-white"
            disabled={pending || !password}
          >
            <Lock className="size-4" /> {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
