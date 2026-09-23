import { useEffect, useSyncExternalStore } from "react";
import { filipino } from "./translations";
export type Locale = "zh-Hant" | "fil";
const key = "harbor-language";
function initial(): Locale {
  try {
    const saved = localStorage.getItem(key);
    if (saved === "fil" || saved === "zh-Hant") return saved;
  } catch {}
  return typeof navigator !== "undefined" &&
    navigator.languages.some((l) => /^(fil|tl)(-|$)/i.test(l))
    ? "fil"
    : "zh-Hant";
}
let locale: Locale = initial();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const reverse = new Map(Object.entries(filipino).map(([zh, fil]) => [fil, zh]));
export function t(source: string, values?: Record<string, string | number>) {
  const canonical = reverse.get(source) || source;
  const translated =
    locale === "fil" ? filipino[canonical] || canonical : canonical;
  return translated.replace(/\{(\w+)\}/g, (match, key) =>
    String(values?.[key] ?? match),
  );
}
export function setLocale(next: Locale) {
  locale = next;
  try {
    localStorage.setItem(key, next);
  } catch {}
  listeners.forEach((fn) => fn());
}
export function useLanguage() {
  const language = useSyncExternalStore(
    subscribe,
    () => locale,
    () => "zh-Hant" as Locale,
  );
  return {
    locale: language,
    t,
    setLocale,
    dateLocale: language === "fil" ? "fil-PH" : "zh-TW",
  };
}
export function LanguagePicker() {
  const { locale, t, setLocale } = useLanguage();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === "fil" ? "Harbor · Workspace ng team" : "Harbor · 團隊工作空間";
  }, [locale]);
  return (
    <label className="language-picker">
      <span>{t("語言")} / Language</span>
      <select
        aria-label="Language / 語言 / Wika"
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        <option value="zh-Hant">繁體中文</option>
        <option value="fil">Filipino (Tagalog)</option>
      </select>
    </label>
  );
}
