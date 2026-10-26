import type { Locale, UserProfile } from "../../src/types";
import type { TodoHistory, TodoItem, TodoMutation, TodoSnapshot, TodoWeek, TodoWorkspace } from "../../src/features/weeklyTodo/types";
import { addDays, mondayOf } from "../../src/features/weeklyTodo/calendar";
export const profiles: UserProfile[] = [
  { uid: "a", displayName: "メンバーA（確認用）", email: "a@example.test", active: true, role: "employee_manager", locale: "ja" },
  { uid: "b", displayName: "成员B（示例）", email: "b@example.test", active: true, role: "employee", locale: "zh-CN" },
  { uid: "p", displayName: "社長（確認用）", email: "p@example.test", active: true, role: "president_viewer", locale: "ja" }
];
let uid = "a"; export function selectProfile(value: string) { uid = value; }
export const selectedProfile = () => profiles.find(profile => profile.uid === uid)!;
export const previewLogs = new Map<string, { userId: string; workDate: string; text: string; tagId: string; tagLabel: string }>();
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(Date.now());
const content = (item: TodoItem) => JSON.stringify([item.title.trim(), item.goal.trim(), item.progress, item.memo.trim()]);
const logKey = (week: string, item: TodoItem) => JSON.stringify([uid, today(), week, item.id, content(item)]);
previewLogs.set("manual", { userId: "a", workDate: today(), tagId: "internal_work", tagLabel: "社内業務", text: "先に入力した業務メモ（確認用・この内容も残ります）" });
const clone = <T,>(value: T): T => structuredClone(value);
const rows = new Map<string, { version: number; draft: TodoItem[]; row: TodoWeek; history: TodoHistory[]; reportableItems?: string[] }>();
const task = (id: string, title: string, goal: string, progress: number, memo: string, sourceLocale: Locale = "ja"): TodoItem => ({ id, title, goal, progress, memo, sourceLocale, memoLocale: sourceLocale, withdrawn: false });
function snap(items: TodoItem[], revision = 1): TodoSnapshot { return { items: clone(items), at: Date.now(), revision, contentVersion: JSON.stringify(items) }; }
function seed(user: string, week: string, items: TodoItem[]) {
  const shared = snap(items); rows.set(`${user}:${week}`, { version: 1, draft: clone(items), row: { userId: user, weekStart: week, shared, initial: shared, review: null, reviewRevision: null }, history: [{ kind: "share", snapshot: shared }] });
}
const week = mondayOf();
seed("a", week, [task("a1", "資料の比較表を作成", "比較項目を整理し、金曜日までに初稿をまとめる", 40, "比較項目を整理。残りは情報の確認と初稿作成。"), task("a2", "説明資料の構成を見直す", "内容を3つの章に整理し、見直し案を共有する", 0, "")]);
seed("p", week, [task("p1", "今週の共有事項を確認", "金曜日までに確認事項を一覧にまとめる", 25, "各資料の確認を進めています。"), task("p2", "次週の準備を進める", "次週の予定案を整理する", 0, "")]);
if (new URLSearchParams(location.search).has("many")) seed("a", week, Array.from({ length: 25 }, (_, index) => task(`many-${index}`, `確認用の業務 ${index + 1}`, "金曜日までに内容を整理する", 20, "確認中")));
seed("b", week, [task("b1", "整理候选资料", "周五前完成三份资料的整理并共享概要", 60, "已整理两份资料，剩余一份正在确认。", "zh-CN")]);
seed("a", addDays(week, -7), [task("prior-a", "参考情報を整理", "比較に使う参考情報を一覧にまとめる", 70, "残りの情報を確認する")]);
seed("p", addDays(week, -7), [task("prior-p", "共有資料の内容を確認", "資料を確認し、確認事項を整理する", 50, "確認事項を整理中")]);
// Static fixtures for inspecting the automatically populated private draft.
for (const user of ["a", "p"]) {
  const current = rows.get(`${user}:${week}`)!;
  const previous = addDays(week, -7);
  current.draft.push(...rows.get(`${user}:${previous}`)!.draft.map(item => ({ ...clone(item), id: `carry-${item.id}`, carriedFrom: { weekStart: previous, itemId: item.id } })));
  current.version++;
}
export async function getWeeklyTodoWorkspace(weekStart: string): Promise<TodoWorkspace> {
  const own = rows.get(`${uid}:${weekStart}`); const previous = addDays(weekStart, -7);
  return clone({ weekStart, weekEnd: addDays(weekStart, 6), targetDate: addDays(weekStart, 4), fetchedAt: Date.now(), members: profiles.map(({ uid, displayName, role }) => ({ uid, displayName, role })), weeks: [...rows.values()].filter(value => value.history.length > 0 && value.row.weekStart === weekStart).map(value => value.row), ownDraft: { items: own?.draft || [], version: own?.version || 0 }, reportLink: uid === "p" ? null : { reportDate: today(), items: weekStart === mondayOf() ? (own?.draft || []).filter(item => !item.withdrawn && (item.progress > 0 || item.memo.trim() || own?.reportableItems?.includes(item.id))).map(item => ({ itemId: item.id, added: previewLogs.has(logKey(weekStart, item)) })) : [] }, carryover: (rows.get(`${uid}:${previous}`)?.row.shared.items || []).filter(item => !item.withdrawn && item.progress < 100).map(item => ({ ...item, carriedFrom: { weekStart: previous, itemId: item.id } })) });
}
async function save(input: TodoMutation, kind: "draft" | "share" | "review") {
  const key = `${uid}:${input.weekStart}`; let value = rows.get(key);
  if ((value?.version || 0) !== input.expectedVersion) throw Object.assign(new Error("conflict"), { code: "aborted" });
  if (!value) { const first = snap(input.items); value = { version: 0, draft: [], row: { userId: uid, weekStart: input.weekStart, shared: first, initial: first, review: null, reviewRevision: null }, history: [] }; }
  value.reportableItems = input.items.filter(item => value!.reportableItems?.includes(item.id) || value!.draft.some(old => old.id === item.id && content(old) !== content(item))).map(item => item.id);
  value.version++; value.draft = clone(input.items);
  if (kind !== "draft" && (kind === "review" || !value.history.length || value.row.shared.contentVersion !== JSON.stringify(input.items))) { const shared = snap(input.items, (value.history.length || 0) + 1); value.row.shared = shared; if (!value.history.length) value.row.initial = shared; if (kind === "review") { value.row.review = shared; value.row.reviewRevision = shared.revision; } value.history.unshift({ kind, snapshot: shared }); }
  rows.set(key, value); return { version: value.version };
}
export const saveWeeklyTodoDraft = (input: TodoMutation) => save(input, "draft");
export const shareWeeklyTodo = (input: TodoMutation) => save(input, "share");
export const shareWeeklyTodoReview = (input: TodoMutation) => save(input, "review");
export async function getWeeklyTodoHistory(input: { weekStart: string; userId: string }) { return clone({ history: rows.get(`${input.userId}:${input.weekStart}`)?.history || [], cursor: null }); }
const toJa: Record<string, string> = { "整理候选资料": "候補資料を整理する", "周五前完成三份资料的整理并共享概要": "金曜日までに資料3件を整理し、概要を共有する", "已整理两份资料，剩余一份正在确认。": "資料2件を整理済み。残り1件を確認中。" };
const toZh: Record<string, string> = { "資料の比較表を作成": "制作资料比较表", "比較項目を整理し、金曜日までに初稿をまとめる": "整理比较项目，周五前完成初稿", "比較項目を整理。残りは情報の確認と初稿作成。": "已整理比较项目，接下来确认信息并制作初稿。", "説明資料の構成を見直す": "调整说明资料的结构", "内容を3つの章に整理し、見直し案を共有する": "将内容整理为三章，共享调整方案" };
export async function translateWeeklyTodoContent(input: { weekStart: string; userId: string; contentVersion: string; revision: number; targetLocale: Locale }) {
  if (new URLSearchParams(location.search).has("translationError")) throw Error("translation offline");
  const value = rows.get(`${input.userId}:${input.weekStart}`)!; const content = value.history.find(row => row.snapshot.revision === input.revision)?.snapshot || value.row.initial;
  const dictionary = input.targetLocale === "ja" ? toJa : toZh; const fields: Record<string, string> = {};
  for (const item of content.items) for (const field of ["title", "goal", "memo"] as const) fields[`${item.id}:${field}`] = dictionary[item[field]] || item[field];
  return { fields, contentVersion: input.contentVersion, targetLocale: input.targetLocale };
}
export function todoError() { return "通信を完了できませんでした。入力を保持して再試行してください。"; }

export async function addWeeklyTodoToDailyReport(input: { weekStart: string; itemId: string; expectedVersion: number; reportDate: string }) {
  if (uid === "p") throw Error("日報の権限がありません");
  const value = rows.get(`${uid}:${input.weekStart}`)!; const item = value.draft.find(row => row.id === input.itemId)!;
  if (value.version !== input.expectedVersion) throw Object.assign(new Error("conflict"), { code: "aborted" });
  const key = logKey(input.weekStart, item); const alreadyAdded = previewLogs.has(key);
  if (!alreadyAdded) previewLogs.set(key, { userId: uid, workDate: today(), tagId: "weekly_todo", tagLabel: "今週のTo Do", text: `【今週のTo Do】${item.title}\n金曜日までの目標：${item.goal}\n今週の進捗：${item.progress}％\n実績・残ったこと：${item.memo || "未入力"}` });
  return { reportDate: today(), addedCount: alreadyAdded ? 0 : 1, alreadyAdded };
}
