export type Role = "admin" | "user" | "player";
export type Profile = { id: string; name: string; role: Role };
export type Category = { id: string; name: string };
export type Channel = { id: string; category_id: string; name: string };
export type Message = {
  id: string;
  channel_id: string;
  user_id: string;
  body: string;
  image_path: string | null;
  created_at: string;
};
export type Grant = { user_id: string; category_id: string };
export const roleNames = { admin: "管理員", user: "使用者", player: "打手" };
