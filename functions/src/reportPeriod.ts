import { z } from "zod";
import { weekRange } from "./domain.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "有効な日付を指定してください。");
export const reportPeriodSchema = z.object({
  periodStart: date, periodEnd: date
}).refine((value) => value.periodStart <= value.periodEnd, "終了日は開始日以降にしてください。")
  .refine((value) => Date.parse(value.periodEnd) - Date.parse(value.periodStart) < 366 * 86400000, "期間は366日以内にしてください。");
export const generateReportInputSchema = z.union([
  z.object({ userId: z.string().min(1).max(128), weekStart: date }).strict(),
  reportPeriodSchema.and(z.object({ userId: z.string().min(1).max(128) }))
]);
export function reportRange(start: string, end?: string) {
  if (end === undefined) return weekRange(date.parse(start));
  const period = reportPeriodSchema.parse({ periodStart: start, periodEnd: end });
  return { weekStart: period.periodStart, weekEnd: period.periodEnd };
}
export function reportDocumentId(userId: string, start: string, end?: string) {
  const range = reportRange(start, end);
  return end === undefined ? `${userId}_${range.weekStart}` : `${userId}_monthly_${range.weekStart}_${range.weekEnd}`;
}
export function monthsInReportRange(start: string, end: string) {
  const months: string[] = [];
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  while (cursor.toISOString().slice(0, 7) <= end.slice(0, 7)) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
