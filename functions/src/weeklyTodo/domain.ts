import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

export const locale = z.enum(["ja", "zh-CN"]);
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export function weekDates(start: string) {
  const date = new Date(`${start}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start || date.getUTCDay() !== 1) {
    throw new HttpsError("invalid-argument", "週の開始日は実在する月曜日を指定してください。");
  }
  const add = (days: number) => new Date(date.getTime() + days * 86400000).toISOString().slice(0, 10);
  return { weekStart: start, targetDate: add(4), weekEnd: add(6) };
}
export const weekInput = z.object({ weekStart: z.string().length(10) }).strict();
export const itemSchema = z.object({
  id: identifier, title: z.string().trim().max(200), goal: z.string().trim().max(2000),
  progress: z.number().int().min(0).max(100), memo: z.string().trim().max(4000),
  sourceLocale: locale, memoLocale: locale, withdrawn: z.boolean().default(false),
  carriedFrom: z.object({ weekStart: z.string().length(10), itemId: identifier }).strict().optional()
}).strict();
export const mutationInput = weekInput.extend({
  expectedVersion: z.number().int().min(0), operationId: identifier,
  items: z.array(itemSchema).max(30)
}).strict();
export const historyInput = weekInput.extend({ userId: z.string().min(1).max(128), cursor: z.string().max(100).optional() }).strict();
export const translationInput = weekInput.extend({ userId: z.string().min(1).max(128), contentVersion: z.string().length(64), revision: z.number().int().min(1), targetLocale: locale }).strict();
export type TodoItem = z.infer<typeof itemSchema>;
export type Snapshot = { items: TodoItem[]; at: number; revision: number; contentVersion: string };
export type Row = Record<string, any>;
export function scopeOf(profile: Row): string {
  if (profile.isDemo !== true) return "production";
  if (typeof profile.demoDatasetId !== "string" || !profile.demoDatasetId) throw new HttpsError("permission-denied", "デモ環境を確認できません。");
  return `demo:${profile.demoDatasetId}`;
}
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const carryoverKey = (origin: TodoItem["carriedFrom"]) => digest(origin ? { weekStart: origin.weekStart, itemId: origin.itemId } : null);
export const documentId = (scope: string, uid: string, week: string) => digest([scope, uid, week]);
export function snapshot(items: TodoItem[], revision: number, at: number): Snapshot {
  return { items, revision, at, contentVersion: digest(items) };
}
export function validateItems(items: TodoItem[], kind: "draft" | "share" | "review") {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new HttpsError("invalid-argument", "項目IDが重複しています。");
  if (Buffer.byteLength(JSON.stringify(items), "utf8") > 120000) throw new HttpsError("invalid-argument", "入力が長すぎます。項目を短くしてください。");
  if (kind !== "draft" && (!items.length || items.some(item => !item.title || !item.goal))) throw new HttpsError("invalid-argument", "業務と金曜日までの目標を入力してください。");
  if (kind === "review" && items.some(item => !item.memo)) throw new HttpsError("invalid-argument", "各項目の実績・残ったことを入力してください。");
  const sources = items.filter(item => item.carriedFrom).map(item => carryoverKey(item.carriedFrom));
  if (new Set(sources).size !== sources.length) throw new HttpsError("invalid-argument", "同じ項目を重複して引き継ぐことはできません。");
}
