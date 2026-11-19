import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1180px] space-y-7">
      <h1 className="text-22 font-semibold">Settings</h1>
      <SettingsNav />
      <div className="max-w-4xl">{children}</div>
    </div>
  );
}
