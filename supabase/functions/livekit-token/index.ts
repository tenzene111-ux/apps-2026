// Supabase Edge Function: mints a short-lived LiveKit access token.
// Deploy via Supabase Dashboard -> Edge Functions -> Deploy a new function
// (name it exactly "livekit-token"), or via the Supabase CLI.
//
// Requires these secrets set in Project Settings -> Edge Functions -> Secrets:
//   LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL
// SUPABASE_URL / SUPABASE_ANON_KEY are injected automatically, no setup needed.

import { createClient } from "npm:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);

    const { room } = await req.json();
    if (!room || typeof room !== "string") return json({ error: "room is required" }, 400);

    // Only mint a token for a room that actually has an active live session.
    const { data: session } = await supabase
      .from("live_sessions")
      .select("id")
      .eq("room_name", room)
      .is("ended_at", null)
      .maybeSingle();
    if (!session) return json({ error: "Room is not live" }, 404);

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single();

    const at = new AccessToken(
      Deno.env.get("LIVEKIT_API_KEY")!,
      Deno.env.get("LIVEKIT_API_SECRET")!,
      { identity: user.id, name: profile?.username || "Guest" }
    );
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return json({ token: await at.toJwt(), url: Deno.env.get("LIVEKIT_URL") });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
