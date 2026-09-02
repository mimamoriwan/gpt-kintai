import { z } from "zod";

export const workModes = ["office", "business_trip", "home", "other"] as const;
export const clockInInputSchema = z.object({
  workMode: z.enum(workModes),
  startedAt: z.string().datetime({ offset: true }).optional(),
  reason: z.string().trim().min(3).max(500).optional()
}).superRefine((input, context) => {
  if (Boolean(input.startedAt) !== Boolean(input.reason)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "始業時刻と理由は両方入力してください。",
      path: ["startedAt"]
    });
  }
});
export const roles = ["employee", "employee_manager", "president_viewer"] as const;
export const productStatuses = ["new", "considering", "on_hold", "closed"] as const;
export const productSources = ["store", "business_trip", "internet", "flyer", "other"] as const;
export const productReviewStatuses = ["unreviewed", "reviewed", "needs_review"] as const;
export const productPhotoKinds = ["front", "jan", "ingredients"] as const;
export const weeklyPlanStatuses = ["draft", "confirmed", "completed"] as const;
export const weeklyReportStatuses = ["ai_draft", "manager_editing", "finalized"] as const;
export const nonWorkingReasonTypes = ["paid_leave", "absence", "illness", "special_leave", "company_closure", "other"] as const;
export const evidenceCategories = ["estimate", "product_research", "maker_material", "meeting_record", "contract", "client_email", "internal_message", "minutes", "other"] as const;
export const evidenceVisibilities = ["work", "employment_confidential"] as const;
export const calendarEventTypes = ["work", "business_trip", "leave"] as const;

const calendarTime = z.string().regex(/^$|^(?:[01]\d|2[0-3]):[0-5]\d$/, "時刻を確認してください。").optional().default("");
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付を確認してください。").refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "日付を確認してください。");
const optionalCalendarIdentifier = z.preprocess(
  (value) => value == null ? undefined : value,
  z.string().trim().regex(/^[A-Za-z0-9_-]+$/).max(180).optional()
);

export function calendarDateRange(startDate: string, endDate: string, maximumDays = 60): string[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
    throw new Error("終了日は開始日以降にしてください。");
  }
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (days > maximumDays) throw new Error(`予定期間は${maximumDays}日以内にしてください。`);
  return Array.from({ length: days }, (_, index) => {
    const value = new Date(start);
    value.setUTCDate(start.getUTCDate() + index);
    return value.toISOString().slice(0, 10);
  });
}

export const calendarEventInputSchema = z.object({
  id: optionalCalendarIdentifier,
  groupId: optionalCalendarIdentifier,
  // `date` remains accepted while users with the previous cached UI upgrade.
  date: calendarDate.optional(),
  startDate: calendarDate.optional(),
  endDate: calendarDate.optional(),
  eventType: z.enum(calendarEventTypes).optional().default("work"),
  title: z.string().trim().max(100, "件名は100文字以内で入力してください。").optional().default(""),
  startTime: calendarTime,
  endTime: calendarTime,
  memo: z.string().trim().max(1000, "メモは1000文字以内で入力してください。").optional().default(""),
  participantIds: z.array(z.string().trim().min(1).max(128)).min(1, "参加者を1人以上選択してください。").max(3, "参加者は3人までです。")
}).superRefine((input, context) => {
  const startDate = input.startDate || input.date;
  const endDate = input.endDate || startDate;
  if (!startDate || !endDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "日付を確認してください。", path: ["startDate"] });
  } else {
    try { calendarDateRange(startDate, endDate); }
    catch (error) { context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "予定期間を確認してください。", path: ["endDate"] }); }
  }
  if (input.eventType !== "leave" && !input.title) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "件名を入力してください。", path: ["title"] });
  }
  if (new Set(input.participantIds).size !== input.participantIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "参加者が重複しています。", path: ["participantIds"] });
  }
  if (input.endTime && !input.startTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "終了時刻を入れる場合は開始時刻も入力してください。", path: ["endTime"] });
  }
  if (input.startTime && input.endTime && input.endTime <= input.startTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "終了時刻は開始時刻より後にしてください。", path: ["endTime"] });
  }
}).transform((input) => {
  const startDate = input.startDate || input.date!;
  const eventType = input.eventType;
  return {
    ...input,
    startDate,
    endDate: input.endDate || startDate,
    title: eventType === "leave" ? "休み" : input.title,
    startTime: eventType === "leave" ? "" : input.startTime,
    endTime: eventType === "leave" ? "" : input.endTime,
    memo: eventType === "leave" ? "" : input.memo
  };
});

const shortText = z.string().trim().max(4000).optional().default("");

export const weeklyPlanInputSchema = z.object({
  userId: z.string().min(1).max(128),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(weeklyPlanStatuses).optional().default("draft"),
  goals: shortText,
  productFields: shortText,
  visitPlans: shortText,
  deliverables: shortText,
  consultations: shortText,
  sourceLanguage: z.enum(["ja", "zh-CN"])
});

const weeklyText = (maximum: number) => z.string().trim().max(maximum).optional().default("");

export const weeklyReportThemeSchema = z.object({
  title: weeklyText(500),
  objective: weeklyText(4000),
  activities: weeklyText(12000),
  outcomes: weeklyText(8000),
  evidence: weeklyText(8000),
  chinaMarketInsight: weeklyText(8000),
  issues: weeklyText(8000),
  nextAction: weeklyText(8000),
  sourceReferences: z.array(z.string().trim().max(500)).max(50).optional().default([])
});

export const weeklyReportPrioritySchema = z.object({
  title: weeklyText(1000),
  basis: z.enum(["confirmed", "proposal"]).optional().default("proposal"),
  owner: weeklyText(240),
  dueDate: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/).optional().default(""),
  definitionOfDone: weeklyText(4000)
});

// Every field is optional so reports created before the enhanced meeting format
// remain editable. New generations always provide the complete structure.
export const weeklyReportSectionsSchema = z.object({
  executiveSummary: weeklyText(12000),
  keyOutcomes: weeklyText(12000),
  blockers: weeklyText(8000),
  decisionsNeeded: weeklyText(8000),
  themes: z.array(weeklyReportThemeSchema).max(30).optional().default([]),
  nextPriorities: z.array(weeklyReportPrioritySchema).max(30).optional().default([]),
  previousGoals: weeklyText(8000),
  completedWork: weeklyText(12000),
  productResults: weeklyText(8000),
  chinaMarketInsights: weeklyText(8000),
  planActualGap: weeklyText(8000),
  continuingIssues: weeklyText(8000),
  nextWeekPlan: weeklyText(8000),
  pendingItems: weeklyText(8000)
});

export function weekRange(date: string): { weekStart: string; weekEnd: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime())) throw new Error("Invalid date");
  const mondayOffset = (day.getUTCDay() + 6) % 7;
  const monday = new Date(day);
  monday.setUTCDate(day.getUTCDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { weekStart: monday.toISOString().slice(0, 10), weekEnd: sunday.toISOString().slice(0, 10) };
}

const optionalProductText = (maximum: number) => z.preprocess(
  (value) => value == null ? "" : value,
  z.string().trim().max(maximum)
);
const optionalProductIdentifier = z.preprocess(
  (value) => value == null ? "" : value,
  z.string().trim().max(180)
);

export const productFactsSchema = z.object({
  name: z.string().trim().min(1).max(240),
  jan: optionalProductText(13),
  makerBrand: optionalProductText(240),
  ingredients: optionalProductText(5000)
});

export const productObservationInputSchema = z.object({
  draftId: z.string().trim().min(8).max(120),
  existingProductId: optionalProductIdentifier,
  createNewWithoutJan: z.boolean().optional().default(false),
  discoveredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(productSources),
  sourceDetail: optionalProductText(2000),
  reasonOriginal: optionalProductText(5000),
  reasonLanguage: z.enum(["ja", "zh-CN"]),
  estimateRequested: z.boolean().optional().default(false),
  addToWorkMemo: z.boolean().optional().default(false),
  facts: productFactsSchema
});

export const productImageInputSchema = z.object({
  draftId: z.string().trim().min(8).max(120),
  images: z.array(z.object({
    kind: z.enum(productPhotoKinds),
    dataUrl: z.string().min(32).max(1_500_000)
  })).min(1).max(3)
});

export function normalizeJan(value: string): string {
  return value.replace(/[\s-]/g, "");
}

export function isValidJan(value: string): boolean {
  const jan = normalizeJan(value);
  if (!/^\d{8}$|^\d{13}$/.test(jan)) return false;
  const digits = [...jan].map(Number);
  const checkDigit = digits.pop()!;
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const weight = jan.length === 13
      ? (index % 2 === 0 ? 1 : 3)
      : (index % 2 === 0 ? 3 : 1);
    sum += digits[index] * weight;
  }
  return (10 - (sum % 10)) % 10 === checkDigit;
}

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
  area: z.string().max(160),
  destinations: z.string().max(2000),
  activities: z.string().min(1).max(8000),
  findings: z.string().max(8000),
  nextPlan: z.string().max(4000)
});

export const generatedReportDraftSchema = reportFieldsSchema;

export const reportDraftInputSchema = z.object({
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceLanguage: z.enum(["ja", "zh-CN"]),
  // Older cached PWA versions did not send this flag. Treat an omitted value
  // as "no travel" so editing an existing report never fails validation.
  hasTravel: z.boolean().optional().default(false)
});

export type WorkLogDraftEntry = { tag: string; text: string };
export type WorkLogDraftGroup = { tag: string; entries: string[] };
export type WorkLogDraftSummary = { tag: string; summary: string };

export function groupWorkLogEntries(entries: WorkLogDraftEntry[]): WorkLogDraftGroup[] {
  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    const tag = entry.tag.trim() || "未分類";
    const text = entry.text.trim();
    if (!text) continue;
    const current = groups.get(tag) || [];
    current.push(text);
    groups.set(tag, current);
  }
  return Array.from(groups, ([tag, groupedEntries]) => ({ tag, entries: groupedEntries }));
}

export function formatTaggedActivities(groups: WorkLogDraftGroup[], summaries: WorkLogDraftSummary[]): string {
  const summaryByTag = new Map(summaries.map((item) => [item.tag.trim(), item.summary.trim()]));
  return groups.map((group) => {
    const summary = summaryByTag.get(group.tag) || group.entries.join("\n");
    return `【${group.tag}】\n${summary}`;
  }).join("\n\n");
}

export const reportInputSchema = z.object({
  reportId: z.string().max(180).nullish().transform((value) => value ?? undefined),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceLanguage: z.enum(["ja", "zh-CN"]),
  fields: reportFieldsSchema,
  attachments: z.array(attachmentSchema).max(5),
  correctionReason: z.string().min(3).max(500).nullish().transform((value) => value ?? undefined)
}).refine((input) => input.attachments.reduce((sum, item) => sum + item.size, 0) <= 20 * 1024 * 1024, "Attachments exceed 20MB");

export const reportCommentInputSchema = z.object({
  reportId: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1, "コメントを入力してください。").max(2000, "コメントは2000文字以内で入力してください。")
});

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

export function assertTimeRange(start: Date, end?: Date, recordedAt = new Date()): void {
  if (!Number.isFinite(start.getTime()) || (end && !Number.isFinite(end.getTime()))) throw new Error("Invalid date/time");
  if (end && end.getTime() <= start.getTime()) throw new Error("End time must be after start time");
  const now = recordedAt.getTime();
  if (start.getTime() > now || (end && end.getTime() > now)) throw new Error("Future time is not allowed");
}

export function assertManualClockInTime(start: Date, recordedAt = new Date()): void {
  if (!Number.isFinite(start.getTime())) throw new Error("始業時刻が正しくありません。");
  if (start.getTime() > recordedAt.getTime() + 60_000) {
    throw new Error("未来の始業時刻は登録できません。");
  }
  if (jstDate(start) !== jstDate(recordedAt)) {
    throw new Error("始業時刻の修正は当日の時刻だけ登録できます。前日の記録は管理担当者へ連絡してください。");
  }
}

export function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
