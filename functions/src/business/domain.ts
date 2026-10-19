import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

export const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const version = z.number().int().min(0);
export const locale = z.enum(["ja", "zh-CN"]);
export const status = z.enum(["not_started", "in_progress", "on_hold", "completed"]);
const name = z.string().trim().min(1).max(200);
const referenceLinks = z.array(z.string().url().max(2000).refine((value) => /^https?:\/\//i.test(value))).max(10);
const order = z.number().int().min(0).max(10000);
const commonInput = { id: identifier, expectedVersion: version, name, description: z.string().max(10000), sourceLocale: locale, referenceLinks };
export const themeInput = z.object({ ...commonInput, order }).strict();
const month = z.string().refine((value) => value === "" || /^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value));
export const milestoneInput = z.object({ id: identifier, name, order, archived: z.boolean() }).strict();
export const initiativeInput = z.object({
  ...commonInput, themeId: identifier, assigneeIds: z.array(identifier).max(3), status,
  plannedStartMonth: month, plannedEndMonth: month, targetMemo: z.string().max(1000),
  milestones: z.array(milestoneInput).max(100)
}).strict().superRefine((value, ctx) => {
  const activeMilestones = value.milestones.filter((item) => !item.archived).length;
  if (activeMilestones < 1 || activeMilestones > 3) {
    ctx.addIssue({ code: "custom", message: "有効な節目は1〜3件にしてください。", path: ["milestones"] });
  }
  if (Boolean(value.plannedStartMonth) !== Boolean(value.plannedEndMonth) || value.plannedStartMonth > value.plannedEndMonth) {
    ctx.addIssue({ code: "custom", message: "予定開始・終了月を確認してください。", path: ["plannedEndMonth"] });
  }
  if (new Set(value.milestones.map((item) => item.id)).size !== value.milestones.length) {
    ctx.addIssue({ code: "custom", message: "節目の識別子が重複しています。", path: ["milestones"] });
  }
  if (new Set(value.assigneeIds).size !== value.assigneeIds.length) {
    ctx.addIssue({ code: "custom", message: "担当者が重複しています。", path: ["assigneeIds"] });
  }
});
export const archiveInput = z.object({ kind: z.enum(["theme", "initiative"]), id: identifier, expectedVersion: version, archived: z.boolean() }).strict();
export const updateInput = z.object({ id: identifier, initiativeId: identifier, body: z.string().trim().min(1).max(5000), sourceLocale: locale }).strict();
export const statusInput = z.object({ initiativeId: identifier, expectedVersion: version, status }).strict();
export const completionInput = z.object({ initiativeId: identifier, milestoneId: identifier, expectedVersion: version, completed: z.boolean() }).strict();
export const settingsInput = z.object({ expectedVersion: version, enabled: z.boolean(), memberIds: z.array(identifier).length(3) }).strict().refine((value) => new Set(value.memberIds).size === 3, "共有メンバーを3人指定してください。");
export const translationInput = z.object({ kind: z.enum(["theme", "initiative", "update"]), id: identifier, targetLocale: locale, expectedContentVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const detailInput = z.object({ initiativeId: identifier, updatesCursor: z.string().max(500).optional(), historyCursor: z.string().max(500).optional() }).strict();
export const historyInput = z.object({ kind: z.enum(["theme", "settings"]), id: identifier, cursor: z.string().max(500).optional() }).strict().refine((value) => value.kind !== "settings" || value.id === "current", "現在の共有設定を指定してください。");

export type Row = Record<string, any>;
export type Milestone = { id: string; name: string; order: number; archived: boolean; completed: boolean; updatedAt: number; updatedBy: string };
export type Kind = "theme" | "initiative" | "update";
export const collections = { theme: "businessThemes", initiative: "businessInitiatives", update: "businessUpdates" } as const;
export function isManager(role: unknown): boolean { return role === "employee_manager" || role === "president_viewer"; }
export function scopeOf(profile: Row): string {
  if (profile.isDemo !== true) return "company";
  if (!profile.demoDatasetId || typeof profile.demoDatasetId !== "string") throw new HttpsError("permission-denied", "デモ設定を確認してください。");
  return `demo_${createHash("sha256").update(profile.demoDatasetId).digest("hex")}`;
}
export function assertVersion(row: Row | undefined, expectedVersion: number): void {
  if ((row?.version ?? 0) !== expectedVersion) throw new HttpsError("aborted", "他の人が更新しました。入力を保持したまま最新の内容を確認してください。");
}
export function assertEditable(row: Row): void {
  if (row.archived) throw new HttpsError("failed-precondition", "アーカイブ済みです。復元してから変更してください。");
}
export function assertAssigned(row: Row, uid: string, manage: boolean): void {
  if (!manage && !row.assigneeIds?.includes(uid)) throw new HttpsError("permission-denied", "担当する取り組みだけ変更できます。");
}
export function translationFields(kind: Kind, row: Row): Record<string, string> {
  if (kind === "update") return { body: row.body };
  const fields: Record<string, string> = { name: row.name, description: row.description };
  if (kind === "initiative") {
    fields.targetMemo = row.targetMemo;
    for (const milestone of [...row.milestones].sort((a: Milestone, b: Milestone) => a.id.localeCompare(b.id))) fields[`milestone:${milestone.id}`] = milestone.name;
  }
  return fields;
}
export function contentVersion(kind: Kind, row: Row): string {
  return createHash("sha256").update(JSON.stringify({ sourceLocale: row.sourceLocale, fields: translationFields(kind, row) })).digest("hex");
}
export function mergeMilestones(input: z.infer<typeof milestoneInput>[], previous: Milestone[], uid: string, now: number): Milestone[] {
  const byId = new Map(previous.map((item) => [item.id, item]));
  if (previous.some((item) => !input.some((next) => next.id === item.id))) throw new HttpsError("invalid-argument", "節目は削除せずアーカイブしてください。");
  return input.map((item) => {
    const before = byId.get(item.id);
    const changed = !before || item.name !== before.name || item.order !== before.order || item.archived !== before.archived;
    if (before?.archived && item.archived && (item.name !== before.name || item.order !== before.order)) throw new HttpsError("failed-precondition", "節目を復元してから編集してください。");
    return { ...item, completed: before?.completed ?? false, updatedBy: changed ? uid : before.updatedBy, updatedAt: changed ? now : before.updatedAt };
  });
}
export function publicRow(row: Row): Row {
  const { scopeId: _scopeId, ...result } = row;
  return result;
}
export function asHttpsError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof z.ZodError) throw new HttpsError("invalid-argument", "入力内容を確認してください。", error.issues.map((issue) => ({ path: issue.path, message: issue.message })));
  // Never expose provider responses, source text, or secret values in public errors.
  throw new HttpsError("internal", "処理に失敗しました。入力を保持して再試行してください。");
}
