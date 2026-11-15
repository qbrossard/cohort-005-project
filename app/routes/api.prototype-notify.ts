// PROTOTYPE — throwaway. Sends the selected DevUI user a catalogue Notification through
// Knock so the Notification Feed prototype has something real to show.

import { data } from "react-router";
import type { Route } from "./+types/api.prototype-notify";
import { getCurrentUserId } from "~/lib/session";
import {
  NOTIFICATION_KINDS,
  sendPrototypeNotifications,
  type NotificationKind,
} from "~/lib/notification-feed-prototype.server";

export async function action({ request }: Route.ActionArgs) {
  if (process.env.NODE_ENV === "production") {
    throw data("Not found", { status: 404 });
  }
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return { ok: false as const, error: "Select a user from the DevUI panel" };
  }

  const kind = String((await request.formData()).get("kind"));
  if (kind !== "burst" && !NOTIFICATION_KINDS.includes(kind as NotificationKind)) {
    return { ok: false as const, error: `Unknown kind: ${kind}` };
  }

  try {
    const sent = await sendPrototypeNotifications(
      userId,
      kind as NotificationKind | "burst"
    );
    return { ok: true as const, sent };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
