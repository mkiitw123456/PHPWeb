import { t, useLanguage, LanguagePicker } from "./i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Hash,
  Plus,
  ChevronDown,
  Settings,
  Volume2,
  VolumeX,
  Users,
  ShieldCheck,
  Send,
  Menu,
  LogOut,
  X,
  ArrowDown,
  Wifi,
  FlaskConical,
  ImagePlus,
} from "lucide-react";
import {
  db,
  demo,
  localData,
  saveLocal,
  snapshot,
  history,
  configured,
  observeAuth,
  logout,
  watchChannels,
  watchProfile,
  request,
  sendMessage,
  compressImage,
  dataUrl,
  type Snapshot,
} from "./api";
import { type Message, roleNames } from "./types";
import { Avatar, Modal, Login, ChatImage, Busy } from "./components";
import Admin from "./Admin";
const empty: Snapshot = {
  profiles: [],
  categories: [],
  channels: [],
  messages: [],
  grants: [],
};
export default function App() {
  const { dateLocale } = useLanguage();
  const [data, setData] = useState<Snapshot>(() =>
      demo ? localData() : empty,
    ),
    [uid, setUid] = useState(demo ? "alex" : ""),
    [ready, setReady] = useState(demo),
    [channel, setChannel] = useState(demo ? "general" : ""),
    [messages, setMessages] = useState<Message[]>([]),
    [text, setText] = useState(""),
    [modal, setModal] = useState(""),
    [category, setCategory] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [mobile, setMobile] = useState(false),
    [showMembers, setShowMembers] = useState(true),
    [mobileMembers, setMobileMembers] = useState(false),
    [collapsed, setCollapsed] = useState<string[]>([]),
    [sound, setSound] = useState(
      () => localStorage.getItem("harbor-sound") !== "off",
    ),
    [pending, setPending] = useState<{
      blob: Blob;
      url: string;
      name: string;
      original: number;
      channel: string;
    } | null>(null),
    [lightbox, setLightbox] = useState(""),
    [unread, setUnread] = useState<Record<string, number>>({}),
    [live, setLive] = useState(demo ? t("本機示範") : t("連線中"));
  const file = useRef<HTMLInputElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    audio = useRef<AudioContext | null>(null),
    current = useRef(channel),
    soundRef = useRef(sound),
    userRef = useRef(uid),
    stick = useRef(true),
    loadToken = useRef(0),
    dataRef = useRef(data);
  dataRef.current = data;
  current.current = channel;
  soundRef.current = sound;
  userRef.current = uid;
  const me = data.profiles.find((p) => p.id === uid);
  const admin = me?.role === "admin";
  const allowed = data.categories.filter(
    (c) =>
      admin ||
      data.grants.some((g) => g.user_id === uid && g.category_id === c.id),
  );
  const channels = data.channels.filter((c) =>
    allowed.some((a) => a.id === c.category_id),
  );
  const active = channels.find((c) => c.id === channel);
  const close = useCallback(() => {
    setModal("");
    setPending(null);
    setLightbox("");
  }, []);
  const update = useCallback((s: Snapshot) => {
    if (demo) saveLocal(s);
    setData(s);
  }, []);
  const fail = useCallback((e: unknown) => {
    const message =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : t("操作失敗，請稍後再試");
    setError(message);
    setToast(message);
  }, []);
  async function reload() {
    const requestedUser = userRef.current;
    try {
      const s = await snapshot();
      if (requestedUser === userRef.current) setData(s);
    } catch (e) {
      if (
        requestedUser === userRef.current &&
        e instanceof Error &&
        [
          "Workspace access is not enabled",
          "Session expired",
          "Sign in required",
        ].includes(e.message)
      ) {
        setData(empty);
        setMessages([]);
        close();
      }
      fail(e);
    }
  }
  useEffect(() => {
    if (!db) return;
    return observeAuth((next) => {
      setUid(next);
      setReady(true);
      if (!next) {
        setData(empty);
        setMessages([]);
      }
    });
  }, []);
  useEffect(() => {
    if (uid && !demo) void reload();
  }, [uid]);
  useEffect(() => {
    if (!active) {
      setChannel(channels[0]?.id || "");
      setMessages([]);
    }
  }, [active?.id, channels.map((c) => c.id).join(",")]);
  useEffect(() => {
    const token = ++loadToken.current;
    if (!channel || !uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessages([]);
    stick.current = true;
    history(channel)
      .then((ms) => {
        if (token !== loadToken.current) return;
        setMessages((existing) => [
          ...ms,
          ...existing.filter(
            (m) => m.channel_id === channel && !ms.some((x) => x.id === m.id),
          ),
        ]);
        setMore(!demo && ms.length === 40);
      })
      .catch(fail)
      .finally(() => {
        if (token === loadToken.current) setLoading(false);
      });
    setUnread((u) => ({ ...u, [channel]: 0 }));
    return () => {
      ++loadToken.current;
    };
  }, [channel, uid]);
  function beep() {
    if (!soundRef.current || !audio.current) return;
    const a = audio.current;
    if (a.state !== "running") void a.resume();
    const osc = a.createOscillator(),
      gain = a.createGain();
    osc.connect(gain);
    gain.connect(a.destination);
    osc.frequency.setValueAtTime(660, a.currentTime);
    osc.frequency.setValueAtTime(880, a.currentTime + 0.09);
    gain.gain.setValueAtTime(0.035, a.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.22);
    osc.start();
    osc.stop(a.currentTime + 0.23);
  }
  function receive(m: Message, quiet = false) {
    if (m.channel_id === current.current)
      setMessages((ms) =>
        ms.some((x) => x.id === m.id)
          ? ms
          : [...ms, m].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      );
    else if (!quiet)
      setUnread((u) => ({ ...u, [m.channel_id]: (u[m.channel_id] || 0) + 1 }));
    if (!quiet && m.user_id !== userRef.current) beep();
  }
  useEffect(() => {
    const unlock = () => {
      if (!audio.current) audio.current = new AudioContext();
      void audio.current.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);
  useEffect(() => {
    if (!uid) return;
    if (!db) {
      const sync = (e: StorageEvent) => {
        if (e.key !== "harbor-demo-v1") return;
        const next = localData();
        next.messages
          .filter((m) => !dataRef.current.messages.some((x) => x.id === m.id))
          .filter((m) => {
            const c = next.channels.find((c) => c.id === m.channel_id);
            return (
              next.profiles.find((p) => p.id === userRef.current)?.role ===
                "admin" ||
              next.grants.some(
                (g) =>
                  g.user_id === userRef.current &&
                  g.category_id === c?.category_id,
              )
            );
          })
          .forEach((m) => receive(m));
        setData(next);
      };
      window.addEventListener("storage", sync);
      return () => window.removeEventListener("storage", sync);
    }
    const stop = watchProfile(uid, () => void reload());
    const refresh = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [uid]);
  useEffect(() => {
    if (!db || !uid) return;
    return watchChannels(channels, receive, (ok) =>
      setLive(ok ? t("即時連線") : t("連線中斷")),
    );
  }, [uid, channels.map((c) => c.id).join(",")]);
  useEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);
  useEffect(() => {
    localStorage.setItem("harbor-sound", sound ? "on" : "off");
  }, [sound]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  async function prepare(f?: File) {
    if (!f || !channel) return;
    try {
      const blob = await compressImage(f);
      setPending({
        blob,
        url: await dataUrl(blob),
        name: f.name,
        original: f.size,
        channel,
      });
      setModal("upload");
    } catch (e) {
      fail(e);
    }
  }
  async function send(image?: typeof pending) {
    if (busy || !me || !active || (!text.trim() && !image)) return;
    setBusy(true);
    const channelId = image?.channel || channel;
    let path: string | null = null;
    try {
      if (image) path = demo ? image.url : null;
      const message: Message = {
        id: crypto.randomUUID(),
        channel_id: channelId,
        user_id: uid,
        body: text.trim(),
        image_path: path,
        created_at: new Date().toISOString(),
      };
      if (db) {
        const result = await sendMessage(message, image?.url);
        receive(result.message);
        if (result.notification === "failed")
          setToast(t("訊息已傳送；Discord 通知失敗。"));
        else if (result.notification === "not_configured")
          setToast(t("訊息已傳送；尚未設定 Discord Webhook。"));
      } else {
        const next = {
          ...localData(),
          messages: [...localData().messages, message],
        };
        update(next);
        receive(message);
      }
      setText("");
      close();
      stick.current = true;
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  if (!configured && !demo)
    return (
      <div className="login">
        <LanguagePicker />
        <ShieldCheck size={44} />
        <h1>{t("工作空間尚未啟用")}</h1>
        <p>{t("管理員正在設定 Firebase，完成後才會開放帳密登入。")}</p>
      </div>
    );
  if (!ready) return <Busy />;
  if (!uid) return <Login onLogin={() => void reload()} />;
  if (!me && !demo)
    return (
      <div className="login">
        <LanguagePicker />
        <ShieldCheck size={40} />
        <h1>{t("等待工作空間權限")}</h1>
        <p>{t("若你是首位管理員，請依 README 建立管理員資料。")}</p>
        {error && <p className="error">{t(error)}</p>}
        <button onClick={() => void reload()}>{t("重新載入")}</button>
        <button onClick={() => void logout()}>{t("登出")}</button>
      </div>
    );
  const visiblePeople = data.profiles.filter(
    (p) =>
      admin ||
      p.role === "admin" ||
      p.id === uid ||
      data.grants.some(
        (g) =>
          g.user_id === p.id && allowed.some((c) => c.id === g.category_id),
      ) ||
      !demo,
  );
  return (
    <div className="app">
      <nav className="rail" aria-label={t("工作空間")}>
        <div className="brand" title={t("Harbor 私人工作空間")}>
          H
        </div>
        <span className="rail-line" />
        <span className="private-icon" title={t("私人工作空間")}>
          <ShieldCheck size={23} />
        </span>
        <div className="rail-bottom">
          <span className="status-dot" />
        </div>
      </nav>
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <div className="workspace">
          <div>
            <strong>{t("Harbor 工作空間")}</strong>
            <small>{t("跨越海域，讓合作更簡單")}</small>
          </div>
          <button
            className="icon mobile-only"
            onClick={() => setMobile(false)}
            aria-label={t("關閉頻道列表")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-label">
          <ShieldCheck size={13} />
          {t("私人工作空間")}
          <span>PRIVATE</span>
        </div>
        <LanguagePicker />
        <div className="channel-list">
          {allowed.map((c) => (
            <section key={c.id}>
              <div className="category">
                <button
                  onClick={() =>
                    setCollapsed((a) =>
                      a.includes(c.id)
                        ? a.filter((x) => x !== c.id)
                        : [...a, c.id],
                    )
                  }
                >
                  <ChevronDown
                    size={13}
                    className={collapsed.includes(c.id) ? "folded" : ""}
                  />
                  {c.name}
                </button>
                {admin && (
                  <button
                    className="icon"
                    aria-label={t("在 {name} 建立頻道", { name: c.name })}
                    onClick={() => {
                      setCategory(c.id);
                      setModal("channel");
                    }}
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
              {!collapsed.includes(c.id) &&
                channels
                  .filter((ch) => ch.category_id === c.id)
                  .map((ch) => (
                    <button
                      key={ch.id}
                      className={
                        "channel " + (ch.id === channel ? "selected" : "")
                      }
                      onClick={() => {
                        setChannel(ch.id);
                        setText("");
                        setMobile(false);
                      }}
                    >
                      <Hash size={21} />
                      <span>{ch.name}</span>
                      {unread[ch.id] > 0 && (
                        <b className="count">{unread[ch.id]}</b>
                      )}
                    </button>
                  ))}
            </section>
          ))}
          {admin && (
            <button
              className="add-category"
              onClick={() => setModal("category")}
            >
              <Plus size={15} />
              {t("建立類別")}
            </button>
          )}
          {!allowed.length && (
            <p className="muted empty">{t("尚未分配類別，請聯絡管理員。")}</p>
          )}
        </div>
        {demo && (
          <div className="demo-panel">
            <FlaskConical size={16} />
            <div>
              {t("本機示範模式")}
              <small>{t("資料儲存在這台瀏覽器")}</small>
            </div>
          </div>
        )}
        <div className="profile">
          <Avatar person={me} />
          <div>
            <strong>{me?.name}</strong>
            <small>{me && t(roleNames[me.role])}</small>
          </div>
          <button
            className="icon"
            title={t("設定")}
            aria-label={t("設定")}
            onClick={() => setModal("settings")}
          >
            <Settings size={19} />
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="sidebar-shade"
          aria-label={t("收合頻道列表")}
          onClick={() => setMobile(false)}
        />
      )}
      <main className="main">
        <header className="channel-header">
          <button
            className="icon mobile-only"
            aria-label={t("開啟頻道列表")}
            onClick={() => setMobile(true)}
          >
            <Menu />
          </button>
          <Hash className="header-hash" size={27} />
          <strong>{active?.name || t("工作空間")}</strong>
          <span className="header-description">
            {t("團隊的日常交流與工作同步")}
          </span>
          <div className="header-tools">
            <button
              className={"icon " + (!sound ? "muted" : "")}
              title={sound ? t("關閉提示音") : t("開啟提示音")}
              aria-label={sound ? t("關閉提示音") : t("開啟提示音")}
              onClick={() => setSound(!sound)}
            >
              {sound ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <button
              className={"icon " + (showMembers ? "active-icon" : "")}
              aria-label={t("切換成員列表")}
              onClick={() =>
                window.innerWidth <= 900
                  ? setMobileMembers(!mobileMembers)
                  : setShowMembers(!showMembers)
              }
            >
              <Users size={21} />
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button
              className="icon"
              aria-label={t("關閉錯誤")}
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div
          className="conversation"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          <div className="welcome">
            <div className="welcome-icon">
              <Hash size={38} />
            </div>
            <h1>
              {t("歡迎來到 #")}
              {active?.name || "Harbor"}
            </h1>
            <p>
              {t("這裡是團隊的日常交流與工作同步。")}
              <br />
              {t("無論你在台灣還是菲律賓，讓每一次合作保持連結。")}
            </p>
            <span className="channel-tag">
              <ShieldCheck size={13} />
              {t("僅限已授權的工作空間成員")}
            </span>
          </div>
          {more && (
            <button
              className="older"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                stick.current = false;
                try {
                  const old = await history(channel, messages[0]);
                  setMessages((ms) => [...old, ...ms]);
                  setMore(old.length === 40);
                } catch (e) {
                  fail(e);
                } finally {
                  setLoading(false);
                }
              }}
            >
              {t("載入更早的訊息")}
            </button>
          )}
          <div className="date-separator">
            <span>
              {demo
                ? t("示範對話")
                : messages[0]
                  ? new Date(messages[0].created_at).toLocaleDateString(
                      dateLocale,
                    )
                  : t("今天")}
            </span>
          </div>
          {loading ? (
            <Busy />
          ) : (
            messages.map((m) => {
              const p = data.profiles.find((p) => p.id === m.user_id);
              return (
                <article className="message" key={m.id}>
                  <Avatar person={p} />
                  <div className="message-content">
                    <div className="message-meta">
                      <strong>{p?.name || t("成員")}</strong>
                      {p && (
                        <span className={"role " + p.role}>
                          {t(roleNames[p.role])}
                        </span>
                      )}
                      <time
                        title={new Date(m.created_at).toLocaleString(
                          dateLocale,
                        )}
                      >
                        {new Date(m.created_at).toLocaleTimeString(dateLocale, {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </time>
                    </div>
                    {m.body && <p>{m.body}</p>}
                    {m.image_path && (
                      <ChatImage path={m.image_path} onOpen={setLightbox} />
                    )}
                  </div>
                </article>
              );
            })
          )}
          {!loading && !messages.length && (
            <div className="empty-chat">{t("還沒有訊息，來打聲招呼吧。")}</div>
          )}
          <div ref={bottom} />
        </div>
        <div className="composer-wrap">
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <button
              type="button"
              className="attach"
              disabled={!active || busy}
              aria-label={t("上傳圖片")}
              onClick={() => file.current?.click()}
            >
              <Plus size={22} />
            </button>
            <textarea
              aria-label={t("訊息")}
              placeholder={t("傳送訊息到 #") + (active?.name || t("頻道"))}
              value={text}
              maxLength={4000}
              disabled={!active || busy}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const image = Array.from(e.clipboardData.files).find((f) =>
                  f.type.startsWith("image/"),
                );
                if (image) {
                  e.preventDefault();
                  void prepare(image);
                }
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className="send"
              aria-label={t("傳送訊息")}
              disabled={busy || !text.trim() || !active}
            >
              <Send size={20} />
            </button>
          </form>
          <div className="composer-foot">
            <span>
              <ImagePlus size={12} />
              {t("支援文字、貼上或上傳圖片")}
            </span>
            <span>{t("Enter 傳送 · Shift + Enter 換行")}</span>
          </div>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              void prepare(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </main>
      {mobileMembers && (
        <button
          className="sidebar-shade"
          aria-label={t("收合成員列表")}
          onClick={() => setMobileMembers(false)}
        />
      )}
      {(showMembers || mobileMembers) && (
        <aside className={"members " + (mobileMembers ? "mobile-open" : "")}>
          <header>
            <Users size={17} />
            {t("成員")}
            <span>{visiblePeople.length}</span>
            {mobileMembers && (
              <button
                className="icon"
                aria-label={t("關閉成員列表")}
                onClick={() => setMobileMembers(false)}
              >
                <X size={18} />
              </button>
            )}
          </header>
          {(["admin", "player", "user"] as const).map((role) => (
            <section key={role}>
              <h3>
                {t(roleNames[role])} —{" "}
                {visiblePeople.filter((p) => p.role === role).length}
              </h3>
              {visiblePeople
                .filter((p) => p.role === role)
                .map((p) => (
                  <div className="member" key={p.id}>
                    <Avatar person={p} />
                    <div>
                      <strong>{p.name}</strong>
                      <small>
                        {p.id === uid ? t("你") : t(roleNames[p.role])}
                      </small>
                    </div>
                  </div>
                ))}
            </section>
          ))}
          <div className="connection">
            <Wifi size={16} />
            <span>
              {t(live)}
              <small>
                {demo
                  ? t("連接 Firebase 後啟用多人聊天")
                  : t("訊息與圖片依類別權限保護")}
              </small>
            </span>
          </div>
          {admin && (
            <button className="manage" onClick={() => setModal("admin")}>
              <Settings size={16} />
              {t("管理工作空間")}
            </button>
          )}
        </aside>
      )}
      {toast && (
        <div className="toast" role="status">
          {t(toast)}
        </div>
      )}
      {modal === "admin" && admin && (
        <Modal title={t("管理工作空間")} close={close}>
          <Admin data={data} update={update} onError={fail} />
        </Modal>
      )}
      {(modal === "category" || modal === "channel") && admin && (
        <Modal
          title={modal === "category" ? t("建立類別") : t("建立文字頻道")}
          close={close}
        >
          <form
            className="modal-body"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const f = new FormData(e.currentTarget),
                  name = String(f.get("name")).trim();
                if (!name) throw new Error(t("請輸入名稱"));
                const table = modal === "category" ? "categories" : "channels";
                let item: any = {
                  id: crypto.randomUUID(),
                  name,
                  ...(table === "channels" ? { category_id: category } : {}),
                };
                if (db)
                  item = await request(
                    table === "categories" ? "category" : "channel",
                    item,
                  );
                update({ ...data, [table]: [...data[table], item] });
                if (table === "channels") setChannel(item.id);
                close();
              } catch (e) {
                fail(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t("名稱")}
              <input
                name="name"
                autoFocus
                required
                maxLength={60}
                placeholder={
                  modal === "category" ? t("例如：新專案") : t("例如：進度回報")
                }
              />
            </label>
            <p className="muted">
              {modal === "category"
                ? t("建立後，可在成員管理分配此類別的存取權限。")
                : t("文字頻道會繼承所在類別的成員權限。")}
            </p>
            <footer>
              <button type="button" onClick={close}>
                {t("取消")}
              </button>
              <button className="primary" disabled={busy}>
                {t("建立")}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {modal === "settings" && (
        <Modal title={t("工作空間設定")} close={close}>
          <div className="modal-body">
            <LanguagePicker />
            <div className="setting-row">
              <div>
                <strong>{t("訊息提示音")}</strong>
                <small>{t("有人傳送新訊息時播放提示音")}</small>
              </div>
              <button
                className={"toggle " + (sound ? "on" : "")}
                role="switch"
                aria-checked={sound}
                aria-label={t("訊息提示音")}
                onClick={() => setSound(!sound)}
              >
                <span />
              </button>
            </div>
            {demo && (
              <label>
                {t("示範角色切換")}
                <select
                  value={uid}
                  onChange={(e) => {
                    setUid(e.target.value);
                    setText("");
                    close();
                  }}
                >
                  {data.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {t(roleNames[p.role])}
                    </option>
                  ))}
                </select>
                <small>{t("僅用於本機體驗；正式模式無此入口。")}</small>
              </label>
            )}
            {admin && (
              <button className="manage" onClick={() => setModal("admin")}>
                <ShieldCheck size={18} />
                {t("成員、權限與通知串接")}
              </button>
            )}
            {!demo && (
              <button
                className="manage"
                onClick={async () => {
                  await logout();
                  close();
                }}
              >
                <LogOut size={18} />
                {t("登出帳號")}
              </button>
            )}
            {demo && (
              <button className="manage" onClick={() => setModal("reset")}>
                {t("重設示範資料")}
              </button>
            )}
            <p className="muted">
              {t("Harbor · 單一私人工作空間")}
              <br />
              {t("不提供公開註冊，帳號由管理員建立。")}
            </p>
          </div>
        </Modal>
      )}
      {modal === "upload" && pending && (
        <Modal
          title={t("確認上傳圖片")}
          close={() => {
            if (!busy) close();
          }}
          wide
        >
          <div className="modal-body">
            <div className="image-preview">
              <img src={pending.url} alt={t("待上傳圖片預覽")} />
            </div>
            <div className="upload-info">
              <div>
                <strong>{pending.name}</strong>
                <small>
                  {t("圖片將傳送至 #")}
                  {data.channels.find((c) => c.id === pending.channel)?.name}
                </small>
              </div>
              <span>
                <ArrowDown size={14} /> {Math.round(pending.original / 1024)} KB
                → {Math.round(pending.blob.size / 1024)} KB
              </span>
            </div>
            <p className="muted">
              {t(
                "已轉為 WebP；預覽最大 1000 × 600，保持圖片比例。確認後才會上傳。",
              )}
            </p>
            <footer>
              <button disabled={busy} onClick={close}>
                {t("取消")}
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void send(pending)}
              >
                {busy ? t("上傳中…") : t("確認上傳")}
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {demo && modal === "reset" && (
        <Modal title={t("重設示範資料")} close={close}>
          <div className="modal-body">
            <p>
              {t(
                "清除這台瀏覽器內的示範訊息與設定，恢復初始示範對話。這不會影響 Firebase 資料。",
              )}
            </p>
            <footer>
              <button onClick={close}>{t("取消")}</button>
              <button
                className="primary"
                onClick={() => {
                  localStorage.removeItem("harbor-demo-v1");
                  setData(localData());
                  setUid("alex");
                  setChannel("general");
                  setMessages(
                    localData().messages.filter(
                      (m) => m.channel_id === "general",
                    ),
                  );
                  setUnread({});
                  setText("");
                  close();
                }}
              >
                {t("確認重設")}
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {lightbox && (
        <Modal title={t("圖片檢視")} close={close} wide>
          <img className="lightbox" src={lightbox} alt={t("放大聊天圖片")} />
        </Modal>
      )}
    </div>
  );
}
