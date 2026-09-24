import { t } from "./i18n";
import { useEffect, useState } from "react";
import { UserPlus, ShieldCheck, Check, Webhook } from "lucide-react";
import { db, request, type Snapshot } from "./api";
import { roleNames, type Role } from "./types";
import { Avatar } from "./components";
export default function Admin({
  data,
  update,
  onError,
}: {
  data: Snapshot;
  update: (s: Snapshot) => void;
  onError: (s: string) => void;
}) {
  const [tab, setTab] = useState("members"),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [grants, setGrants] = useState<string[]>([]),
    [notice, setNotice] = useState(""),
    [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  useEffect(() => {
    if (tab === "drive" && db) {
      request<{ connected: boolean }>("drive-status")
        .then((r) => setDriveConnected(r.connected))
        .catch((e) => onError(e.message));
    }
  }, [tab]);
  return (
    <>
      <div className="tabs">
        <button
          className={tab === "drive" ? "active" : ""}
          onClick={() => setTab("drive")}
        >
          Google Drive
        </button>
        <button
          className={tab === "members" ? "active" : ""}
          onClick={() => setTab("members")}
        >
          <ShieldCheck size={16} />
          {t("成員與權限")}
        </button>
        <button
          className={tab === "new" ? "active" : ""}
          onClick={() => setTab("new")}
        >
          <UserPlus size={16} />
          {t("建立帳號")}
        </button>
        <button
          className={tab === "webhook" ? "active" : ""}
          onClick={() => setTab("webhook")}
        >
          <Webhook size={16} />
          {t("通知串接")}
        </button>
      </div>
      <div className="modal-body">
        {tab === "drive" && (
          <div className="integration">
            <h3>Google Drive</h3>
            <p>
              {t(
                "圖片會存入你授權的 Google Drive 專用資料夾，檔案不會公開分享。",
              )}
            </p>
            <p className="info">
              {t(
                driveConnected
                  ? "Google Drive 已連接"
                  : "Google Drive 尚未連接",
              )}
            </p>
            <button
              className="primary"
              disabled={!db || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await request<{ url: string }>("drive-start");
                  window.location.assign(result.url);
                } catch (e) {
                  onError((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              {t(
                driveConnected ? "重新授權 Google Drive" : "連接 Google Drive",
              )}
            </button>
            <p className="muted">
              {t("只有管理員需要授權 Google；一般成員使用聊天室帳號即可。")}
            </p>
            <p className="muted">
              {t("請選擇有雲端空間的 Google 帳號，可以與 Firebase 帳號不同。")}
            </p>
            {!db && <small>{t("示範模式不會連接你的雲端硬碟。")}</small>}
          </div>
        )}
        {notice && (
          <p className="success" role="status">
            {t(notice)}
          </p>
        )}
        {tab === "members" && (
          <>
            <p className="muted">
              {t("勾選成員可存取的類別，底下所有文字頻道會自動繼承。")}
            </p>
            <div className="admin-members">
              {data.profiles.map((p) => (
                <button
                  key={p.id}
                  className={selected === p.id ? "selected" : ""}
                  onClick={() => {
                    setSelected(p.id);
                    setGrants(
                      data.grants
                        .filter((g) => g.user_id === p.id)
                        .map((g) => g.category_id),
                    );
                    setNotice("");
                  }}
                >
                  <Avatar person={p} />
                  <span>
                    {p.name}
                    <small>{t(roleNames[p.role])}</small>
                  </span>
                </button>
              ))}
            </div>
            {selected &&
              (data.profiles.find((p) => p.id === selected)?.role ===
              "admin" ? (
                <p className="info">
                  <ShieldCheck size={18} />
                  {t("管理員可存取所有類別。")}
                </p>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    try {
                      if (db)
                        await request("access", {
                          target: selected,
                          category_ids: grants,
                        });
                      update({
                        ...data,
                        grants: [
                          ...data.grants.filter((g) => g.user_id !== selected),
                          ...grants.map((category_id) => ({
                            user_id: selected,
                            category_id,
                          })),
                        ],
                      });
                      setNotice(t("類別權限已儲存"));
                    } catch (e) {
                      onError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <div className="checks">
                    {data.categories.map((c) => (
                      <label key={c.id}>
                        <input
                          type="checkbox"
                          checked={grants.includes(c.id)}
                          onChange={(e) =>
                            setGrants(
                              e.target.checked
                                ? [...grants, c.id]
                                : grants.filter((id) => id !== c.id),
                            )
                          }
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                  <button className="primary" disabled={busy}>
                    <Check size={16} />
                    {t("儲存權限")}
                  </button>
                </form>
              ))}
          </>
        )}
        {tab === "new" && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              setBusy(true);
              setNotice("");
              try {
                const name = String(f.get("name")),
                  role = f.get("role") as Role,
                  category_ids = f.getAll("category") as string[];
                let id = crypto.randomUUID();
                if (db) {
                  const r = await request("create-user", {
                    name,
                    username: f.get("username"),
                    password: f.get("password"),
                    role,
                    category_ids,
                  });
                  id = r.id;
                }
                update({
                  ...data,
                  profiles: [...data.profiles, { id, name, role }],
                  grants: [
                    ...data.grants,
                    ...category_ids.map((category_id) => ({
                      user_id: id,
                      category_id,
                    })),
                  ],
                });
                form.reset();
                setNotice(
                  db
                    ? t("帳號已建立，請私下提供帳密給成員。")
                    : t(
                        "示範成員已建立；密碼不會保存，正式登入需連接 Firebase。",
                      ),
                );
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t("顯示名稱")}
              <input
                name="name"
                maxLength={60}
                required
                placeholder={t("例如：Miguel")}
              />
            </label>
            <label>
              {t("帳號")}
              <input
                name="username"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                pattern="[a-zA-Z0-9_]{3,32}"
                minLength={3}
                maxLength={32}
                required
                placeholder={t("3–32 個英文字母、數字或底線")}
              />
            </label>
            <label>
              {t("初始密碼")}
              <input
                name="password"
                type="password"
                minLength={8}
                autoComplete="new-password"
                required
                placeholder={t("至少 8 個字元")}
              />
            </label>
            <label>
              {t("角色")}
              <select name="role">
                <option value="user">{t("使用者")}</option>
                <option value="player">{t("打手")}</option>
              </select>
            </label>
            <label>{t("可存取的類別")}</label>
            <div className="checks">
              {data.categories.map((c) => (
                <label key={c.id}>
                  <input type="checkbox" name="category" value={c.id} />
                  {c.name}
                </label>
              ))}
            </div>
            <button className="primary" disabled={busy}>
              {busy ? t("建立中…") : t("建立帳號")}
            </button>
          </form>
        )}
        {tab === "webhook" && (
          <div className="integration">
            <span className="integration-icon">
              <Webhook size={32} />
            </span>
            <h3>Discord Webhook</h3>
            <p>
              {t("新訊息會送出通知，讓還在使用 Discord 的夥伴也能跟上進度。")}
            </p>
            <div className="info">
              {db
                ? t(
                    "伺服器端串接已備妥，請在 Vercel 設定 DISCORD_WEBHOOK_URL。",
                  )
                : t("目前為本機示範，尚未連接通知服務。")}
            </div>
            <p className="muted">
              {t(
                "Webhook 網址僅存於 Vercel Secrets。通知只包含「有新訊息」與工作空間連結，不轉送私人文字、圖片或類別名稱。",
              )}
            </p>
            <small>
              {t("設定步驟請見專案 README.md。通知失敗時，聊天訊息仍會保存。")}
            </small>
          </div>
        )}
      </div>
    </>
  );
}
