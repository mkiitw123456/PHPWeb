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
      error,
    } = await admin.auth.getUser(
      (req.headers.get("Authorization") || "").replace(/^Bearer /, ""),
    );
    if (error || !user) return reply({ error: "Unauthorized" }, 401);
    const { data: p } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (p?.role !== "admin") return reply({ error: "Forbidden" }, 403);
    const { email, password, name, role, category_ids = [] } = await req.json();
    if (
      typeof email !== "string" ||
      !email.includes("@") ||
      typeof password !== "string" ||
      password.length < 12 ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 60 ||
      !["user", "player"].includes(role) ||
      !Array.isArray(category_ids)
    )
      return reply({ error: "請填寫有效 Email、姓名及至少 12 字元密碼" }, 400);
    const { data: created, error: ce } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (ce) throw ce;
    const uid = created.user.id;
    const { error: pe } = await admin
      .from("profiles")
      .insert({ id: uid, name: name.trim(), role });
    if (pe) {
      await admin.auth.admin.deleteUser(uid);
      throw pe;
    }
    if (category_ids.length) {
      const { error: ge } = await admin
        .from("category_members")
        .insert(
          [...new Set(category_ids)].map((category_id) => ({
            user_id: uid,
            category_id,
          })),
        );
      if (ge) {
        await admin.auth.admin.deleteUser(uid);
        throw ge;
      }
    }
    return reply({ id: uid });
  } catch (e) {
    console.error(e);
    return reply(
      { error: e instanceof Error ? e.message : "建立帳號失敗" },
      400,
    );
  }
});
