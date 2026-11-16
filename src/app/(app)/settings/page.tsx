import { GeneralForm } from "@/components/settings/general-form";
import { getSessions, getSetting } from "@/server/db/queries/settings";
import { getConfig } from "@/server/config";

export default async function GeneralSettingsPage() {
  const [timezone, sessions] = await Promise.all([
    getSetting("timezone", getConfig().timezone),
    getSessions(),
  ]);
  return <GeneralForm timezone={timezone} sessions={sessions} />;
}
