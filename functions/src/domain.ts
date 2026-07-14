import { z } from "zod";

export const workModes = ["office", "business_trip", "home", "other"] as const;
export const roles = ["employee", "employee_manager", "president_viewer"] as const;

export const attachmentSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(180),
  contentType: z.string().min(1).max(120),
  size: z.number().int().min(0).max(10 * 1024 * 1024),
  storagePath: z.string().max(500).optional(),
  downloadUrl: z.string().url().max(2000).optional(),
  linkUrl: z.string().url().max(2000).refine((url) => /^https?:\/\//i.test(url), "Only HTTP(S) links are allowed").optional()
}).refine((item) => Boolean(item.storagePath || item.linkUrl), "Attachment must have a file or link");

export const reportFieldsSchema = z.object({
  category: z.string().min(1).max(80),
  area: z.string().min(1).max(160),
  destinations: z.string().min(1).max(2000),
  activities: z.string().min(1).max(8000),
  findings: z.string().min(1).max(8000),
  nextPlan: z.string().max(4000)
});

export const reportInputSchema = z.object({
  reportId: z.string().max(180).nullish().transform((value) => value ?? undefined),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceLanguage: z.enum(["ja", "zh-CN"]),
  fields: reportFieldsSchema,
  attachments: z.array(attachmentSchema).max(5),
  correctionReason: z.string().min(3).max(500).nullish().transform((value) => value ?? undefined)
}).refine((input) => input.attachments.reduce((sum, item) => sum + item.size, 0) <= 20 * 1024 * 1024, "Attachments exceed 20MB");

export function jstDate(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function parseIsoDateTime(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid date/time");
  return parsed;
}

export function assertTimeRange(start: Date, end?: Date): void {
  if (end && end.getTime() < start.getTime()) throw new Error("End time must be after start time");
  const now = Date.now();
  if (start.getTime() > now + 5 * 60_000 || end && end.getTime() > now + 5 * 60_000) throw new Error("Future time is not allowed");
}

export function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
