import type { Timestamp } from "firebase/firestore";

const JST = "Asia/Tokyo";

export function todayJst(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: JST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function formatDate(value: string, locale = "ja-JP"): string {
  const date = new Date(`${value}T00:00:00+09:00`);
  return new Intl.DateTimeFormat(locale, {
    timeZone: JST,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

export function formatTime(value?: Timestamp | Date | null): string {
  if (!value) return "--:--";
  const date = value instanceof Date ? value : value.toDate();
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: JST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function elapsedMinutes(start?: Timestamp | Date, end?: Timestamp | Date): number {
  if (!start || !end) return 0;
  const startMs = start instanceof Date ? start.getTime() : start.toMillis();
  const endMs = end instanceof Date ? end.getTime() : end.toMillis();
  return Math.max(0, Math.floor((endMs - startMs) / 60000));
}

export function formatElapsed(minutes: number, locale: "ja" | "zh-CN" = "ja"): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (locale === "zh-CN") return `${hours}小时${rest}分钟`;
  return `${hours}時間${rest}分`;
}

export function monthRange(month: string): { from: string; to: string } {
  const [year, rawMonth] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, rawMonth, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function safeFilename(value: string): string {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 80);
}
