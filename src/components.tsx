import { t, LanguagePicker } from "./i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  X,
  ShieldCheck,
  ImagePlus,
  ArrowUpRight,
  LoaderCircle,
} from "lucide-react";
import { login, loadImage } from "./api";
import type { Profile } from "./types";
export function Avatar({ person }: { person?: Profile }) {
  return (
    <span className={"avatar " + (person?.role || "user")}>
      {(person?.name || "?").slice(0, 2).toUpperCase()}
    </span>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [close]);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label={t("關閉視窗")} onClick={close}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function Login({ onLogin }: { onLogin: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="login">
      <LanguagePicker />
      <div className="login-brand">H</div>
      <h1>{t("歡迎回到 Harbor")}</h1>
      <p>{t("跨越海域，讓合作更簡單。")}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            await login(String(f.get("username")), String(f.get("password")));
            onLogin();
          } catch {
            setError(t("登入失敗，請確認帳號密碼或網路連線。"));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {t("帳號")}
          <input
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={32}
            required
          />
        </label>
        <label>
          {t("密碼")}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="error">{t(error)}</p>}
        <button className="primary" disabled={busy}>
          {busy ? t("登入中…") : t("登入工作空間")}
          <ArrowUpRight size={18} />
        </button>
      </form>
      <small>
        <ShieldCheck size={14} />
        {t("帳號由管理員建立，請聯絡管理員取得存取權限。")}
      </small>
    </div>
  );
}
export function ChatImage({
  path,
  onOpen,
}: {
  path: string;
  onOpen: (src: string) => void;
}) {
  const [src, setSrc] = useState(""),
    [error, setError] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    let objectUrl = "";
    setSrc("");
    setError(false);
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      if (path.startsWith("data:")) {
        setSrc(path);
        return;
      }
      loadImage(path)
        .then((url) => {
          if (live) {
            objectUrl = url;
            setSrc(url);
          } else URL.revokeObjectURL(url);
        })
        .catch(() => {
          if (live) setError(true);
        });
    });
    if (ref.current) io.observe(ref.current);
    return () => {
      live = false;
      io.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return (
    <button
      ref={ref}
      className="chat-image"
      disabled={!src}
      aria-label={t("放大圖片")}
      onClick={() => onOpen(src)}
    >
      {src ? (
        <img
          src={src}
          alt={t("聊天上傳圖片")}
          loading="lazy"
          onError={() => setError(true)}
        />
      ) : (
        <ImagePlus />
      )}
      {error && <span>{t("圖片無法載入，請重新整理")}</span>}
    </button>
  );
}
export function Busy() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" />
      {t("正在載入工作空間…")}
    </div>
  );
}
