"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setSetting } from "@/server/db/queries/settings";

/** Widgets the user has hidden on /analytics (settings.analytics_hidden). */
export async function setAnalyticsHiddenAction(ids: string[]) {
  const clean = z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(100).parse(ids);
  await setSetting("analytics_hidden", [...new Set(clean)]);
  revalidatePath("/analytics");
}
