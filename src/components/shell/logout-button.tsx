"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { SidebarMenuButton } from "@/components/ui/sidebar";

export function LogoutButton() {
  const router = useRouter();
  return (
    <SidebarMenuButton
      tooltip="Sign out"
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
