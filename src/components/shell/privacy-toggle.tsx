"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { SidebarMenuButton } from "@/components/ui/sidebar";

export const PRIVACY_KEY = "tj:privacy";

/** Inline, runs before paint so amounts never flash unblurred. */
export const privacyBootScript = `try{var v=localStorage.getItem("${PRIVACY_KEY}");if(v==="on")document.documentElement.dataset.privacy="on"}catch(e){}`;

const CHANGED = "tj:privacy-changed";
const isOn = () => document.documentElement.dataset.privacy === "on";

/**
 * Applies the privacy default (Settings) when this browser has no choice saved yet. Mounted once in the app layout,
 * so it runs whether or not a toggle is on screen (on phones the toggle lives in the sidebar sheet).
 */
export function PrivacyInit({ defaultOn }: { defaultOn: boolean }) {
  useEffect(() => {
    let v: string | null = null;
    try {
      v = localStorage.getItem(PRIVACY_KEY);
    } catch {}
    document.documentElement.dataset.privacy = (v === null ? defaultOn : v === "on") ? "on" : "off";
    window.dispatchEvent(new Event(CHANGED));
  }, [defaultOn]);
  return null;
}

/** Sidebar toggle that blurs every `.money` element (see globals.css). Per-browser preference. */
export function PrivacyToggle({ className }: { className?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(isOn());
    sync();
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, []);
  const toggle = () => {
    const next = !isOn();
    document.documentElement.dataset.privacy = next ? "on" : "off";
    try {
      localStorage.setItem(PRIVACY_KEY, next ? "on" : "off");
    } catch {}
    window.dispatchEvent(new Event(CHANGED));
  };
  return (
    <SidebarMenuButton
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Show amounts" : "Hide amounts"}
      tooltip={on ? "Show $ amounts" : "Hide $ amounts (privacy)"}
      className={className}
    >
      {on ? <EyeOff /> : <Eye />}
      <span>{on ? "Show amounts" : "Hide amounts"}</span>
    </SidebarMenuButton>
  );
}
