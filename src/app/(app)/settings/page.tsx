import { GeneralForm } from "@/components/settings/general-form";
import { getSetting } from "@/server/db/queries/settings";
import { DEFAULT_SESSIONS } from "@/server/db/seed-data";
import { getConfig } from "@/server/config";

export default async function GeneralSettingsPage() {
  const [timezone, sessions] = await Promise.all([
    getSetting("timezone", getConfig().timezone),
    getSetting("sessions", DEFAULT_SESSIONS),
  ]);
  return <GeneralForm timezone={timezone} sessions={sessions} />;
}
