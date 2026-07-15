// Supabase Edge Function: sends a real Web Push notification.
// Deploy via Supabase Dashboard -> Edge Functions -> Deploy a new function
// (name it exactly "send-push"), same as livekit-token was deployed.
// Then turn OFF "Verify JWT with legacy secret" in its Settings tab —
// this function is called by Supabase's own Database Webhooks, not by
// a signed-in browser session, so there's no user JWT to verify.
//
// Requires these secrets set in Project Settings -> Edge Functions -> Secrets:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

webpush.setVapidDetails(
  "mailto:admin@reelflix.app",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!
);

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  try {
    // Supabase Database Webhooks POST { type, table, record, schema, old_record }
    const payload = await req.json();
    const table = payload.table;
    const record = payload.record;

    let userId: string | undefined;
    let title = "Reelflix";
    let body = "You have a new notification";

    if (table === "notifications") {
      userId = record.user_id;
      if (record.type === "follow") {
        title = "New follower";
        body = "Someone followed you on Reelflix";
      } else if (record.type === "gift") {
        title = "You got a gift!";
        body = `+${record.data?.amount ?? ""} coins`;
      } else if (record.type === "comment") {
        title = "New comment";
        body = "Someone commented on your drama";
      } else if (record.type === "like") {
        title = "New like";
        body = "Someone liked your episode";
      } else if (record.type === "went_live") {
        title = "Live now";
        body = "Someone you follow just went live";
      } else if (record.type === "new_drama") {
        title = "New drama";
        body = `New upload: ${record.data?.title ?? ""}`;
      }
    } else if (table === "dm_messages") {
      userId = record.receiver_id;
      title = "New message";
      body = (record.text ?? "").slice(0, 100);
    } else {
      return new Response("ignored", { status: 200 });
    }

    if (!userId) return new Response("no user", { status: 200 });

    const { data: subs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", userId);

    await Promise.all(
      (subs || []).map((s) =>
        webpush
          .sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title, body, url: "./" })
          )
          .catch(() => {})
      )
    );

    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
