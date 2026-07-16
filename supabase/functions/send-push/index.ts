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
      body = record.text ? record.text.slice(0, 100) : "📷 Sent a photo";

      const { data: meta } = await supabaseAdmin
        .from("dm_conversation_meta")
        .select("muted")
        .eq("owner_id", record.receiver_id)
        .eq("partner_id", record.sender_id)
        .maybeSingle();
      if (meta?.muted) return new Response("muted", { status: 200 });
    } else if (table === "group_messages") {
      const { data: members } = await supabaseAdmin
        .from("group_members")
        .select("user_id")
        .eq("group_id", record.group_id)
        .neq("user_id", record.sender_id);
      const { data: group } = await supabaseAdmin.from("groups").select("name").eq("id", record.group_id).single();
      title = group?.name ? `New message in ${group.name}` : "New group message";
      body = record.text ? record.text.slice(0, 100) : "📷 Sent a photo";
      const recipientIds = (members || []).map((m) => m.user_id);
      if (!recipientIds.length) return new Response("no recipients", { status: 200 });

      const { data: subs } = await supabaseAdmin
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .in("user_id", recipientIds);

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
    } else if (table === "calls") {
      if (record.status !== "ringing") return new Response("ignored", { status: 200 });
      userId = record.callee_id;
      title = record.is_video ? "Incoming video call" : "Incoming voice call";
      body = "Tap to answer";
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
