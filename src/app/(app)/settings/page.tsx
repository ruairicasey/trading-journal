import { GeneralForm } from "@/components/settings/general-form";
import { getSessions, getSetting } from "@/server/db/queries/settings";
import { getConfig } from "@/server/config";
import { INCLUDE_FUNDING_KEY } from "@/server/funding/attribute";

export default async function GeneralSettingsPage() {
  const [timezone, sessions, includeFunding] = await Promise.all([
    getSetting("timezone", getConfig().timezone),
    getSessions(),
    getSetting<boolean>(INCLUDE_FUNDING_KEY, true),
  ]);
  return <GeneralForm timezone={timezone} sessions={sessions} includeFunding={includeFunding !== false} />;
}
