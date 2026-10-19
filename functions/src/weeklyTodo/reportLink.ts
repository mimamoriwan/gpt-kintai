import { z } from "zod";
import { digest, weekInput, type Row, type TodoItem } from "./domain.js";

export const reportInput = weekInput.extend({
  itemId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  expectedVersion: z.number().int().min(0),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
}).strict();
export const reportDateJst = (at: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
export const reportItemHash = (item: TodoItem) => digest([item.title.trim(), item.goal.trim(), item.progress, item.memo.trim()]);
export function reportable(item: TodoItem, row: Row): boolean {
  return !item.withdrawn && Boolean(item.title.trim() && item.goal.trim()) && (row.reportableItems?.includes(item.id) || item.progress > 0 || Boolean(item.memo.trim()));
}
export function reportLogs(scope: string, uid: string, week: string, date: string, item: TodoItem) {
  const zh = item.sourceLocale === "zh-CN";
  const text = `${zh ? "【本周待办】" : "【今週のTo Do】"}${item.title.trim()}\n${zh ? "周五前目标" : "金曜日までの目標"}：${item.goal.trim()}\n${zh ? "本周进度" : "今週の進捗"}：${item.progress}％\n${zh ? "实绩与未完成事项" : "実績・残ったこと"}：${item.memo.trim() || (zh ? "未填写" : "未入力")}`;
  // Keep every character while respecting the existing 1,200-character memo limit.
  const parts: string[] = []; let part = "";
  for (const character of text) { if (part.length + character.length > 1100) { parts.push(part); part = ""; } part += character; }
  if (part) parts.push(part);
  const key = digest([scope, uid, week, date, item.id, reportItemHash(item)]);
  return parts.map((body, index) => ({ id: `weekly-todo-${key}_${index}`, text: parts.length > 1 ? `【${index + 1}/${parts.length}】\n${body}` : body, tagLabel: zh ? "本周待办" : "今週のTo Do" }));
}
