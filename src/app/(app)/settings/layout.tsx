import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>
      <SettingsNav />
      <div className="pt-2">{children}</div>
    </div>
  );
}
