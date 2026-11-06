import type { Firestore, Query } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { Evidence, Input } from "./domain.js";
import { scopeOf as businessScope } from "../business/domain.js";
import { canReadLinkedWeeklyTodo } from "../weeklyTodo/businessLink.js";

type Row = Record<string, any>;
const day = (at: number) => new Date(at + 9 * 3600000).toISOString().slice(0, 10);
const time = (value: any): number => typeof value === "number" ? value : value?.toMillis?.() || 0;
const value = (v: unknown) => typeof v === "string" ? v : "";
async function rows(query: Query, limit = 5000): Promise<Row[]> {
  const result = await query.limit(limit + 1).get();
  if (result.size > limit) throw new HttpsError("resource-exhausted", "対象記録が多すぎます。期間を分けて作成してください。記録は省略していません。");
  return result.docs.map(doc => ({ ...doc.data(), id: doc.id }));
}
export async function collectEvidence(db: Firestore, input: Input, ownerUid: string, businessEnabled: boolean): Promise<{ sources: Evidence[]; notices: string[] }> {
  const start = Date.parse(input.periodStart + "T00:00:00+09:00"), end = Date.parse(input.periodEnd + "T23:59:59.999+09:00");
  const inRange = (at: number) => Number.isFinite(at) && at >= start && at <= end;
  const sources: Evidence[] = [], notices: string[] = [];
  if (!Object.values(input.sources).some(Boolean)) throw new HttpsError("invalid-argument", "対象にする記録を一つ以上選んでください。");
  if (input.userId) {
    const user = (await db.doc(`users/${input.userId}`).get()).data();
    if (!user || user.isDemo === true || !["employee", "employee_manager", "president_viewer"].includes(user.role)) throw new HttpsError("permission-denied", "対象者を確認してください。");
  }
  if (input.sources.daily) {
    const reports = await rows(db.collection("dailyReports").where("reportDate", ">=", input.periodStart).where("reportDate", "<=", input.periodEnd), 2000);
    for (const r of reports) if (r.status === "submitted" && r.isDemo !== true && (!input.userId || r.userId === input.userId)) {
      const field = (key: string) => value(input.locale === "ja" ? r.translatedFields?.[key] || r[key] : r[key]);
      sources.push({ id: `D:${r.id}`, kind: "daily", date: r.reportDate, name: value(r.userName), category: field("category"), activities: field("activities"), findings: field("findings"), nextPlan: field("nextPlan") });
    }
  }
  if (input.sources.business) {
    const scopeId = businessScope({ isDemo: false });
    const settings = (await db.doc(`businessSettings/${scopeId}`).get()).data();
    if (!businessEnabled || !settings?.enabled || !settings.memberIds?.includes(ownerUid)) {
      throw new HttpsError("failed-precondition", "会社の取り組みを取得できません。共有設定を確認するか、対象のチェックを外してください。");
    }
    const [history, updates] = await Promise.all([
      rows(db.collection("businessHistory").where("createdAt", ">=", start).where("createdAt", "<=", end)),
      rows(db.collection("businessUpdates").where("createdAt", ">=", start).where("createdAt", "<=", end))
    ]);
    const events = history.filter(r => r.scopeId === scopeId && ["theme", "initiative"].includes(r.entityType) && inRange(time(r.createdAt)));
    const names = new Map<string, string>();
    for (const r of events.sort((a, b) => time(a.createdAt) - time(b.createdAt))) {
      const after = r.after || {}, before = r.before || {};
      if (after.name && r.entityType === "initiative") names.set(r.entityId, after.name);
      if (input.userId && r.actorId !== input.userId && !after.assigneeIds?.includes(input.userId)) continue;
      const steps = (after.milestones || []).filter((m: Row) => !m.archived).map((m: Row) => ({ name: m.name, completed: m.completed === true }));
      sources.push({ id: `B:H:${r.id}`, kind: "business", date: day(time(r.createdAt)), name: value(r.actorName), category: value(after.name) || "会社の取り組み",
        activities: JSON.stringify({ entityType: r.entityType, entityId: r.entityId, action: r.action, name: after.name, description: after.description, target: after.targetMemo, plannedStartMonth: after.plannedStartMonth, plannedEndMonth: after.plannedEndMonth }),
        findings: r.entityType === "initiative" ? JSON.stringify({ previousStatus: before.status ?? null, statusAtEvent: after.status, milestonesAtEvent: steps }) : "", nextPlan: "" });
    }
    for (const r of updates) if (r.scopeId === scopeId && inRange(time(r.createdAt)) && (!input.userId || r.authorId === input.userId)) {
      if (!names.has(r.initiativeId) && typeof r.initiativeId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(r.initiativeId)) {
        const project = (await db.doc(`businessInitiatives/${r.initiativeId}`).get()).data();
        // A name from a later revision must not leak a future change into this period.
        if (project?.scopeId === scopeId && time(project.updatedAt) <= end && time(project.createdAt) <= end && project.name) names.set(r.initiativeId, project.name);
      }
      sources.push({ id: `B:U:${r.id}`, kind: "business", date: day(time(r.createdAt)), name: value(r.authorName), category: names.get(r.initiativeId) || `取り組み ${r.initiativeId}`, activities: `取り組みID: ${r.initiativeId}\n${value(r.body)}`, findings: "", nextPlan: "" });
    }
    notices.push(input.locale === "ja" ? "会社の取り組みは期間内の投稿・変更履歴を参照。状態は各変更時点で、現在の状態ではありません。" : "公司举措仅引用期间内的帖子和变更历史，状态为变更当时的记录。");
  }
  if (input.sources.todo) {
    // Read immutable shared history only. Never read weeklyTodoWeeks.draft, including the owner's.
    const history = await rows(db.collection("weeklyTodoHistory").where("snapshot.at", ">=", start).where("snapshot.at", "<=", end));
    const linked = history.some(row => row.snapshot?.items?.some((item: Row) => item.businessLink));
    const canReadLinked = linked && await canReadLinkedWeeklyTodo(db, ownerUid, { isDemo: false }, businessEnabled);
    const groups = new Map<string, Row[]>();
    for (const r of history.filter(r => r.scopeId === "production" && ["share", "review"].includes(r.kind) && inRange(time(r.snapshot?.at)) && (!input.userId || r.userId === input.userId))) {
      for (const item of r.snapshot.items || []) {
        if (item.businessLink && !canReadLinked) continue;
        const key = `${r.userId}:${r.weekStart}:${item.id}`;
        groups.set(key, [...(groups.get(key) || []), { ...item, at: time(r.snapshot.at), revision: r.snapshot.revision, kind: r.kind, userId: r.userId, weekStart: r.weekStart }]);
      }
    }
    const names = new Map<string, string>();
    for (const [key, versions] of groups) {
      versions.sort((a, b) => a.at - b.at || a.revision - b.revision); const last = versions.at(-1)!;
      if (!names.has(last.userId)) names.set(last.userId, value((await db.doc(`users/${last.userId}`).get()).data()?.displayName));
      sources.push({ id: `T:${key}`, kind: "todo", date: day(last.at), name: names.get(last.userId)!, category: value(last.title),
        activities: versions.map(v => JSON.stringify({ date: day(v.at), event: v.kind, weekStart: v.weekStart, title: v.title, goal: v.goal, progress: v.progress, actualOrRemaining: v.memo, withdrawn: v.withdrawn === true })).join("\n"),
        findings: last.withdrawn ? "取り下げ済み / 已撤回" : "", nextPlan: "", ...(last.withdrawn ? {} : { progress: last.progress }) });
    }
    notices.push(input.locale === "ja" ? "To Doは期間内に共有・振り返りを保存した履歴のみ。週の予定日と実際の実施日は同一とは限りません。進捗率は本人の入力値です。" : "待办仅使用期间内已共享和已保存复盘的历史。计划周不等于实际执行日期，进度为本人录入值。");
  }
  sources.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (!sources.length) throw new HttpsError("not-found", "対象期間・対象者の記録がありません。日報以外の記録も選択できます。");
  if (sources.length > 2000 || Buffer.byteLength(JSON.stringify(sources)) > 1_000_000) throw new HttpsError("resource-exhausted", "対象記録が作成上限を超えています。期間または対象者を分けてください。自動省略はしていません。");
  return { sources: sources.map((source, i) => ({ ...source, recordId: source.id, id: `S${String(i + 1).padStart(3, "0")}` })), notices };
}
