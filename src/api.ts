import { createClient } from "@supabase/supabase-js";
import type { Category, Channel, Profile, Message, Grant } from "./types";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const db = url && key ? createClient(url, key) : null;
export const demo = !db;
const seed = {
  profiles: [
    { id: "alex", name: "Alex", role: "admin" },
    { id: "miguel", name: "Miguel", role: "player" },
    { id: "jenny", name: "Jenny", role: "user" },
  ] as Profile[],
  categories: [
    { id: "workspace", name: "工作空間" },
    { id: "projects", name: "專案協作" },
  ],
  channels: [
    { id: "announcements", category_id: "workspace", name: "公告" },
    { id: "general", category_id: "workspace", name: "一般交流" },
    { id: "orders", category_id: "projects", name: "訂單討論" },
    { id: "delivery", category_id: "projects", name: "交付紀錄" },
  ],
  grants: [
    { user_id: "miguel", category_id: "workspace" },
    { user_id: "miguel", category_id: "projects" },
    { user_id: "jenny", category_id: "workspace" },
  ],
  messages: [
    {
      id: "m1",
      channel_id: "general",
      user_id: "alex",
      body: "大家早安！歡迎來到我們的新工作空間 👋\n之後的訂單討論與交付紀錄，都可以在這裡同步。",
      image_path: null,
      created_at: "2026-09-23T02:24:00Z",
    },
    {
      id: "m2",
      channel_id: "general",
      user_id: "miguel",
      body: "Got it! 我們這邊已經準備好了。\n今天的進度會更新在交付紀錄頻道。",
      image_path: null,
      created_at: "2026-09-23T02:26:00Z",
    },
    {
      id: "m3",
      channel_id: "general",
      user_id: "jenny",
      body: "收到，謝謝大家！有需要協助的地方再跟我說 ✨",
      image_path: null,
      created_at: "2026-09-23T02:28:00Z",
    },
  ],
} satisfies {
  profiles: Profile[];
  categories: Category[];
  channels: Channel[];
  grants: Grant[];
  messages: Message[];
};
export type Snapshot = {
  profiles: Profile[];
  categories: Category[];
  channels: Channel[];
  grants: Grant[];
  messages: Message[];
};
export function localData(): Snapshot {
  try {
    return (
      JSON.parse(localStorage.getItem("harbor-demo-v1") || "null") ||
      structuredClone(seed)
    );
  } catch {
    return structuredClone(seed);
  }
}
export function saveLocal(s: Snapshot) {
  localStorage.setItem("harbor-demo-v1", JSON.stringify(s));
}
export function check<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}
export async function snapshot(): Promise<Snapshot> {
  if (!db) return localData();
  const [profiles, categories, channels, grants] = await Promise.all(
    ["profiles", "categories", "channels", "category_members"].map((t) =>
      db!.from(t).select("*"),
    ),
  );
  return {
    profiles: check(profiles) || [],
    categories: check(categories) || [],
    channels: check(channels) || [],
    grants: check(grants) || [],
    messages: [],
  };
}
export async function history(channel: string, before?: string) {
  if (!db) return localData().messages.filter((m) => m.channel_id === channel);
  let q = db
    .from("messages")
    .select("*")
    .eq("channel_id", channel)
    .order("created_at", { ascending: false })
    .limit(40);
  if (before) q = q.lt("created_at", before);
  return (check(await q) || []).reverse() as Message[];
}
export async function compressImage(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("只支援 JPG、PNG、WebP 圖片");
  if (file.size > 20 * 1024 * 1024) throw new Error("圖片不可超過 20 MB");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width, 1200 / bitmap.height);
  const c = document.createElement("canvas");
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("圖片處理失敗"))),
      "image/webp",
      0.8,
    ),
  );
  if (blob.size > 3 * 1024 * 1024)
    throw new Error("壓縮後仍超過 3 MB，請縮小圖片");
  return blob;
}
export async function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
