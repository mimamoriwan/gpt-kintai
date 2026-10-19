import type { Locale, UserProfile } from "../../src/types";
import type {
  BusinessDetail, BusinessHistory, BusinessHistoryPage, BusinessInitiative, BusinessInitiativeInput,
  BusinessMember, BusinessStatus, BusinessTheme, BusinessThemeInput, BusinessTranslation,
  BusinessTranslationInput, BusinessUpdate, BusinessWorkspace
} from "../../src/features/business/types";

// Browser-only fixture: this module deliberately imports no Firebase or network implementation.
export const businessFeatureAvailable = true;
export const previewManager: UserProfile = { uid: "preview-manager", displayName: "管理担当（確認用）", email: "manager@example.test", role: "employee_manager", locale: "ja", active: true };
const members: BusinessMember[] = [previewManager,
  { uid: "preview-president", displayName: "社長（確認用）", role: "president_viewer", active: true },
  { uid: "preview-member", displayName: "担当者（確認用）", role: "employee", active: true }
];
const createdAt = Date.now();
const common = { sourceLocale: "ja" as const, referenceLinks: [], archived: false, version: 1, contentVersion: "preview-1", createdAt, updatedAt: createdAt, updatedBy: previewManager.uid };
const workspace: BusinessWorkspace = {
  settings: { enabled: true, memberIds: members.map(member => member.uid), version: 1 }, canManage: true,
  members, memberCandidates: [...members, { uid: "preview-spare", displayName: "追加候補（確認用）", role: "employee", active: true }],
  themes: [
    { ...common, id: "preview-theme", name: "確認用テーマ", description: "保存操作を確認するための架空テーマです。", order: 0 },
    { ...common, id: "preview-theme-2", name: "確認用テーマ 2", description: "テーマの選択と編集を確認できます。", order: 1 }
  ],
  initiatives: [
    { ...common, id: "preview-work", themeId: "preview-theme", name: "確認用の取り組み", description: "編集・節目の追加・保存を確認できます。実際の業務内容ではありません。", assigneeIds: ["preview-member"], status: "in_progress", plannedStartMonth: "2026-09", plannedEndMonth: "2026-11", targetMemo: "確認用", milestones: Array.from({ length: 8 }, (_, index) => ({ id: `preview-step-${index + 1}`, name: `確認用の節目 ${index + 1}`, order: index, archived: false, completed: index < 2, updatedAt: createdAt, updatedBy: previewManager.uid })) },
    { ...common, id: "preview-work-2", themeId: "preview-theme-2", name: "別の確認用の取り組み", description: "一覧から別の取り組みを選べます。", assigneeIds: [], status: "not_started", plannedStartMonth: "", plannedEndMonth: "", targetMemo: "", milestones: [] }
  ], fetchedAt: createdAt
};
const updates: BusinessUpdate[] = [];
const history: BusinessHistory[] = [];
const clone = <T,>(value: T): T => structuredClone(value);
const currentTime = () => Date.now();

function record(kind: BusinessHistory["entityType"], id: string, before: unknown, after: unknown) {
  history.unshift({ id: crypto.randomUUID(), entityType: kind, entityId: id, action: "update", actorId: previewManager.uid, actorName: previewManager.displayName, createdAt: currentTime(), before: clone(before), after: clone(after) });
}
function existingInitiative(id: string) {
  const row = workspace.initiatives.find(item => item.id === id);
  if (!row) throw new Error("確認用の取り組みが見つかりません。");
  return row;
}
function assertVersion(expectedVersion: number, actualVersion: number) {
  if (expectedVersion !== actualVersion) throw Object.assign(new Error("確認用データが更新されました。"), { code: "aborted" });
}
function nextRecord(old?: BusinessTheme | BusinessInitiative) {
  const now = currentTime(); const version = (old?.version || 0) + 1;
  return { archived: old?.archived || false, version, contentVersion: `preview-${now}-${version}`, createdAt: old?.createdAt || now, updatedAt: now, updatedBy: previewManager.uid };
}
export async function getBusinessWorkspace(): Promise<BusinessWorkspace> { return clone({ ...workspace, fetchedAt: currentTime() }); }
export async function getBusinessInitiativeDetail(input: { initiativeId: string; updatesCursor?: string; historyCursor?: string }): Promise<BusinessDetail> {
  return clone({ updates: updates.filter(row => row.initiativeId === input.initiativeId), history: history.filter(row => row.entityType === "initiative" && row.entityId === input.initiativeId), fetchedAt: currentTime(), nextUpdatesCursor: null, nextHistoryCursor: null });
}
export async function getBusinessHistory(input: { kind: "theme" | "settings"; id: string; cursor?: string }): Promise<BusinessHistoryPage> {
  return clone({ history: history.filter(row => row.entityType === input.kind && row.entityId === input.id), nextCursor: null, fetchedAt: currentTime() });
}
export async function saveBusinessTheme(input: BusinessThemeInput) {
  const old = workspace.themes.find(row => row.id === input.id); assertVersion(input.expectedVersion, old?.version || 0);
  const { expectedVersion: _expectedVersion, ...fields } = clone(input);
  const next: BusinessTheme = { ...fields, ...nextRecord(old) };
  record("theme", input.id, old || {}, next);
  workspace.themes = [...workspace.themes.filter(row => row.id !== input.id), next];
  return { id: next.id, version: next.version };
}
export async function saveBusinessInitiative(input: BusinessInitiativeInput) {
  const old = workspace.initiatives.find(row => row.id === input.id); assertVersion(input.expectedVersion, old?.version || 0);
  const { expectedVersion: _expectedVersion, ...fields } = clone(input);
  const next: BusinessInitiative = { ...fields, ...nextRecord(old), milestones: input.milestones.map(item => ({ ...clone(item), completed: old?.milestones.find(prior => prior.id === item.id)?.completed || false, updatedAt: currentTime(), updatedBy: previewManager.uid })) };
  record("initiative", input.id, old || {}, next);
  workspace.initiatives = [...workspace.initiatives.filter(row => row.id !== input.id), next];
  return { id: next.id, version: next.version };
}
export async function saveBusinessSettings(input: { expectedVersion: number; enabled: boolean; memberIds: string[] }) {
  assertVersion(input.expectedVersion, workspace.settings.version);
  const next = { enabled: input.enabled, memberIds: [...input.memberIds], version: workspace.settings.version + 1 };
  record("settings", "current", workspace.settings, next); workspace.settings = next;
  workspace.members = workspace.memberCandidates.filter(member => input.memberIds.includes(member.uid));
  return { version: next.version };
}
export async function setBusinessArchived(input: { kind: "theme" | "initiative"; id: string; expectedVersion: number; archived: boolean }) {
  const row = input.kind === "theme" ? workspace.themes.find(item => item.id === input.id) : existingInitiative(input.id);
  if (!row) throw new Error("確認用テーマが見つかりません。"); assertVersion(input.expectedVersion, row.version);
  const before = clone(row); Object.assign(row, nextRecord(row), { archived: input.archived }); record(input.kind, row.id, before, row);
  return { id: row.id, version: row.version };
}
export async function postBusinessUpdate(input: { id: string; initiativeId: string; body: string; sourceLocale: Locale }) {
  const row = existingInitiative(input.initiativeId);
  const update: BusinessUpdate = { ...clone(input), authorId: previewManager.uid, authorName: previewManager.displayName, createdAt: currentTime(), contentVersion: `preview-update-${currentTime()}` };
  updates.unshift(update); row.latestUpdate = update; return { id: update.id };
}
export async function setBusinessStatus(input: { initiativeId: string; expectedVersion: number; status: BusinessStatus }) {
  const row = existingInitiative(input.initiativeId); assertVersion(input.expectedVersion, row.version);
  const before = clone(row); Object.assign(row, nextRecord(row), { status: input.status }); record("initiative", row.id, before, row); return { id: row.id, version: row.version };
}
export async function setBusinessMilestoneCompletion(input: { initiativeId: string; milestoneId: string; expectedVersion: number; completed: boolean }) {
  const row = existingInitiative(input.initiativeId); assertVersion(input.expectedVersion, row.version);
  const before = clone(row); const milestone = row.milestones.find(item => item.id === input.milestoneId);
  if (!milestone) throw new Error("確認用の節目が見つかりません。");
  milestone.completed = input.completed; Object.assign(row, nextRecord(row)); record("initiative", row.id, before, row); return { id: row.id, version: row.version };
}
export async function translateBusinessContent(input: BusinessTranslationInput): Promise<BusinessTranslation> {
  const row = input.kind === "theme" ? workspace.themes.find(item => item.id === input.id) : input.kind === "initiative" ? workspace.initiatives.find(item => item.id === input.id) : updates.find(item => item.id === input.id);
  const fields: Record<string, string> = {};
  if (row) { if ("name" in row) { fields.name = row.name; fields.description = row.description; } if ("body" in row) fields.body = row.body; }
  return { kind: input.kind, id: input.id, targetLocale: input.targetLocale, contentVersion: input.expectedContentVersion, fields, cached: false };
}
export function businessErrorCode(error: unknown) { return error && typeof error === "object" && "code" in error ? String(error.code) : "preview-error"; }
export function businessErrorMessage(error: unknown, locale: Locale) { return error instanceof Error ? error.message : locale === "ja" ? "確認用データの保存を完了できませんでした。" : "无法保存测试数据。"; }
