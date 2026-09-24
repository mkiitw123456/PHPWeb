import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  onSnapshot,
  doc,
  documentId,
} from "firebase/firestore";
import type { Category, Channel, Profile, Message, Grant } from "./types";
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const configured = Object.values(config).every(Boolean);
export const demo =
  import.meta.env.DEV &&
  import.meta.env.VITE_DEMO_MODE === "true" &&
  !configured;
const app = configured ? initializeApp(config) : null;
export const db = app ? getFirestore(app) : null;
export const auth = app ? getAuth(app) : null;
export const observeAuth = (fn: (uid: string) => void) =>
  auth ? onAuthStateChanged(auth, (u) => fn(u?.uid || "")) : () => {};
export const login = (email: string, password: string) =>
  signInWithEmailAndPassword(auth!, email, password);
export const logout = () => signOut(auth!);
export async function request<T = any>(
  action: string,
  body: unknown = {},
): Promise<T> {
  const user = auth?.currentUser;
  if (!user) throw new Error("Sign in required");
  const token = await user.getIdToken();
  const response = await fetch(
    "/api/workspace?action=" + encodeURIComponent(action),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    },
  );
  const data = await response
    .json()
    .catch(() => ({ error: "Server request failed" }));
  if (!response.ok) throw new Error(data.error || "Server request failed");
  return data;
}
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

export async function snapshot(): Promise<Snapshot> {
  if (demo) return localData();
  return request<Snapshot>("snapshot");
}
export async function history(channel: string, before?: Message) {
  if (demo) return localData().messages.filter((m) => m.channel_id === channel);
  if (!db) throw new Error("Firebase is not configured");
  const base = collection(db, "channels", channel, "messages");
  const q = before
    ? query(
        base,
        orderBy("created_at", "desc"),
        orderBy(documentId(), "desc"),
        startAfter(before.created_at, before.id),
        limit(40),
      )
    : query(
        base,
        orderBy("created_at", "desc"),
        orderBy(documentId(), "desc"),
        limit(40),
      );
  return (await getDocs(q)).docs.map((d) => d.data() as Message).reverse();
}
export function watchChannels(
  channels: Channel[],
  receive: (m: Message, quiet?: boolean) => void,
  status: (value: boolean) => void,
) {
  if (!db) return () => {};
  const connected = new Set<string>();
  const unsubscribers = channels.map((channel) => {
    let initial = true;
    const seen = new Set<string>();
    return onSnapshot(
      query(
        collection(db!, "channels", channel.id, "messages"),
        orderBy("created_at", "desc"),
        limit(40),
      ),
      (snap) => {
        connected.add(channel.id);
        status(connected.size === channels.length);
        for (const change of snap.docChanges()) {
          if (change.type === "added" && !seen.has(change.doc.id))
            receive(change.doc.data() as Message, initial);
          seen.add(change.doc.id);
        }
        initial = false;
      },
      () => {
        connected.delete(channel.id);
        status(false);
      },
    );
  });
  return () => unsubscribers.forEach((fn) => fn());
}
export function watchProfile(uid: string, change: () => void) {
  if (!db) return () => {};
  // One small revision document replaces periodic scans of all members/channels.
  let timer: ReturnType<typeof setTimeout>;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(change, 100);
  };
  const stopProfile = onSnapshot(doc(db, "profiles", uid), refresh, refresh);
  const stopWorkspace = onSnapshot(
    doc(db, "system", "workspace"),
    refresh,
    refresh,
  );
  return () => {
    clearTimeout(timer);
    stopProfile();
    stopWorkspace();
  };
}
export async function loadImage(id: string) {
  const token = await auth!.currentUser!.getIdToken();
  const response = await fetch(
    "/api/workspace?action=image&id=" + encodeURIComponent(id),
    { headers: { Authorization: "Bearer " + token }, cache: "no-store" },
  );
  if (!response.ok) throw new Error("Image unavailable");
  return URL.createObjectURL(await response.blob());
}
export async function sendMessage(message: Message, image?: string) {
  return request<{ message: Message; notification: string }>("send", {
    id: message.id,
    channel_id: message.channel_id,
    body: message.body,
    image,
  });
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
