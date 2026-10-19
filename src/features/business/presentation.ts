import type { Locale } from "../../types";
import type { BusinessMember, BusinessStatus } from "./types";
export const statuses: BusinessStatus[] = ["not_started", "in_progress", "on_hold", "completed"];
export const statusSymbols: Record<BusinessStatus, string> = { not_started: "○", in_progress: "▶", on_hold: "Ⅱ", completed: "✓" };
export function businessCopy(locale: Locale) { return (ja: string, zh: string) => locale === "ja" ? ja : zh; }
export function statusLabel(status: BusinessStatus, locale: Locale) {
  return { not_started: ["未着手", "未开始"], in_progress: ["取り組み中", "进行中"], on_hold: ["保留", "暂停"], completed: ["完了", "已完成"] }[status][locale === "ja" ? 0 : 1];
}
export function memberNames(ids: string[], members: BusinessMember[], locale: Locale) {
  return ids.map(id => members.find(m => m.uid === id)?.displayName ?? (locale === "ja" ? "共有外の担当者" : "共享范围外的负责人")).join("・") || (locale === "ja" ? "担当未定" : "负责人待定");
}
export function dateLabel(value: number, locale: Locale) {
  return value ? new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value) : "—";
}
export function safeBusinessLink(link: string) {
  try { const url = new URL(link); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; } catch { return null; }
}
export function newBusinessId() { return crypto.randomUUID(); }
