"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { SidebarMenuButton } from "@/components/ui/sidebar";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <SidebarMenuButton
      tooltip="Sign out"
      className={className}
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut />
      <span>Sign out</span>
    </SidebarMenuButton>
  );
}
