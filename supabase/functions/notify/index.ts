import { createClient } from "npm:@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin":
    Deno.env.get("APP_ORIGIN") || "http://localhost:5173",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const {
      data: { user },
    } = await admin.auth.getUser(
      (req.headers.get("Authorization") || "").replace(/^Bearer /, ""),
    );
    if (!user) return reply({ error: "Unauthorized" }, 401);
    const { message_id } = await req.json();
    const { data: m } = await admin
      .from("messages")
      .select("id,user_id,channel_id,created_at")
      .eq("id", message_id)
      .single();
    if (
      !m ||
      m.user_id !== user.id ||
      Date.now() - Date.parse(m.created_at) > 120000
    )
      return reply({ error: "Forbidden" }, 403);
    const webhook = Deno.env.get("DISCORD_WEBHOOK_URL");
    if (!webhook) return reply({ status: "not_configured" });
    if (!/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(webhook))
      throw new Error("Invalid webhook configuration");
    const { error: claim } = await admin
      .from("notification_deliveries")
      .insert({ message_id });
    if (claim) {
      if (claim.code === "23505") return reply({ status: "already_claimed" });
      throw claim;
    }
    // Only generic metadata: private message text, image URLs, and category names never leave Harbor.
    const origin = Deno.env.get("APP_ORIGIN") || "";
    const res = await fetch(webhook + "?wait=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Harbor",
        content: `Harbor 有新訊息，請登入工作空間查看。\n${origin}`,
        allowed_mentions: { parse: [] },
      }),
    });
    await admin
      .from("notification_deliveries")
      .update({ status: res.ok ? "sent" : "failed" })
      .eq("message_id", message_id);
    if (!res.ok) return reply({ error: "Discord 通知未送達，訊息已儲存" }, 502);
    return reply({ status: "sent" });
  } catch (e) {
    console.error(e);
    return reply({ error: "通知服務暫時無法使用" }, 500);
  }
});
