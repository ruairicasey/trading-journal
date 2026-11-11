"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const PRIVACY_KEY = "tj:privacy";

/** Inline, runs before paint so amounts never flash unblurred. */
export const privacyBootScript = `try{var v=localStorage.getItem("${PRIVACY_KEY}");if(v==="on")document.documentElement.dataset.privacy="on"}catch(e){}`;

/** Header toggle that blurs every `.money` element (see globals.css). Per-browser preference. */
export function PrivacyToggle({ defaultOn }: { defaultOn: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let v: string | null = null;
    try {
      v = localStorage.getItem(PRIVACY_KEY);
    } catch {}
    const initial = v === null ? defaultOn : v === "on";
    setOn(initial);
    document.documentElement.dataset.privacy = initial ? "on" : "off";
  }, [defaultOn]);
  const toggle = () => {
    const next = !on;
    setOn(next);
    document.documentElement.dataset.privacy = next ? "on" : "off";
    try {
      localStorage.setItem(PRIVACY_KEY, next ? "on" : "off");
    } catch {}
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={on}
          aria-label={on ? "Show amounts" : "Hide amounts"}
          className="text-muted-foreground hover:text-foreground hover:bg-muted flex size-7 items-center justify-center rounded-md border"
        >
          {on ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{on ? "Show $ amounts" : "Hide $ amounts (privacy)"}</TooltipContent>
    </Tooltip>
  );
}
