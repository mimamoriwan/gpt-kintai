import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAssigned, assertEditable, contentVersion, isManager, publicRow, scopeOf, type Milestone, type Row } from "../business/domain.js";
import type { BusinessLink, TodoItem } from "./domain.js";

export async function canReadLinkedWeeklyTodo(db: Firestore, uid: string, profile: Row, enabled: boolean) {
  if (!enabled) return false;
  const settings = (await db.doc(`businessSettings/${scopeOf(profile)}`).get()).data();
  return settings?.enabled === true && Array.isArray(settings.memberIds) && settings.memberIds.includes(uid);
}

export async function readLinkedInitiative(db: Firestore, tx: Transaction, uid: string, profile: Row, initiativeId: string, enabled: boolean) {
  if (!enabled) throw new HttpsError("failed-precondition", "会社の取り組みは現在停止中です。");
  const scopeId = scopeOf(profile);
  const settings = (await tx.get(db.doc(`businessSettings/${scopeId}`))).data();
  if (!settings?.enabled || !Array.isArray(settings.memberIds) || !settings.memberIds.includes(uid)) {
    throw new HttpsError("permission-denied", "会社の取り組みの共有設定を確認してください。");
  }
  const ref = db.doc(`businessInitiatives/${initiativeId}`);
  const initiative = (await tx.get(ref)).data();
  if (!initiative || initiative.scopeId !== scopeId) throw new HttpsError("not-found", "元の取り組みを確認してください。");
  assertEditable(initiative);
  assertAssigned(initiative, uid, isManager(profile.role));
  const theme = (await tx.get(db.doc(`businessThemes/${initiative.themeId}`))).data();
  if (!theme || theme.scopeId !== scopeId) throw new HttpsError("not-found", "元のテーマを確認してください。");
  assertEditable(theme);
  return { initiative, ref, scopeId };
}

export function activeMilestone(initiative: Row, milestoneId: string): Milestone {
  const milestone = (initiative.milestones as Milestone[]).find(item => item.id === milestoneId);
  if (!milestone || milestone.archived) throw new HttpsError("failed-precondition", "元の達成項目は現在更新できません。", { reason: "linked-milestone-unavailable" });
  return milestone;
}

export function writeLinkedCompletion(
  db: Firestore, tx: Transaction, context: Awaited<ReturnType<typeof readLinkedInitiative>>,
  input: { uid: string; name: string; item: TodoItem; link: BusinessLink; weekStart: string; reportId: string; at: number; completeMilestone: boolean; action: "complete" | "reopen"; reportLocale: TodoItem["memoLocale"] }
): TodoItem {
  const { initiative, ref, scopeId } = context;
  const { uid, name, item, link, weekStart, reportId, at, completeMilestone, action, reportLocale } = input;
  const reopening = action === "reopen";
  const previousReport = item.businessCompletion;
  // Reopening keeps the earlier report as evidence, and only undoes the check
  // this report set if nobody has changed that achievement since.
  const milestone = reopening
    ? (initiative.milestones as Milestone[]).find(row => row.id === link.milestoneId && !row.archived)
    : activeMilestone(initiative, link.milestoneId);
  if (completeMilestone && (item.title !== milestone?.name || item.goal !== milestone.name || link.milestoneName !== milestone.name)) {
    throw new HttpsError("failed-precondition", "元の達成項目と今週の目標が異なります。", { reason: "linked-milestone-changed" });
  }
  const milestoneChanged = reopening
    ? Boolean(previousReport?.milestoneChanged && milestone?.completed && milestone.updatedAt === previousReport.at && milestone.updatedBy === uid)
    : completeMilestone && !milestone?.completed;
  const body = reopening
    ? (reportLocale === "ja" ? `「${item.title}」の完了報告を取り消しました。` : `已撤销“${item.title}”的完成报告。`)
    : item.memo || (reportLocale === "ja" ? `「${item.title}」が完了しました。` : `“${item.title}”已完成。`);
  const update: Row = {
    id: reportId, initiativeId: link.initiativeId, body, sourceLocale: !reopening && item.memo ? item.memoLocale : reportLocale,
    authorId: uid, authorName: name, scopeId, createdAt: at,
    weeklyTodo: { weekStart, itemId: item.id, milestoneId: link.milestoneId, action, milestoneChanged, ...(reopening && previousReport ? { previousReportId: previousReport.id } : {}) }
  };
  update.contentVersion = contentVersion("update", update);
  const after: Row = {
    ...initiative, latestUpdate: publicRow(update), version: initiative.version + 1, updatedAt: at, updatedBy: uid,
    milestones: milestoneChanged ? (initiative.milestones as Milestone[]).map(row => row.id === link.milestoneId ? { ...row, completed: !reopening, updatedAt: at, updatedBy: uid } : row) : initiative.milestones
  };
  const historyRef = db.doc(`businessHistory/${reportId}`);
  tx.create(db.doc(`businessUpdates/${reportId}`), update);
  tx.create(historyRef, {
    id: historyRef.id, scopeId, entityType: "initiative", entityId: link.initiativeId,
    action: reopening ? "weekly_todo_reopen" : "weekly_todo_completion", actorId: uid, actorName: name,
    createdAt: at, before: publicRow(initiative), after: publicRow(after)
  });
  tx.set(ref, after);
  if (!reopening) return { ...item, progress: 100, businessCompletion: { id: reportId, at, milestoneChanged } };
  const { businessCompletion: _previous, ...remaining } = item;
  return { ...remaining, progress: 0, memo: "", memoLocale: reportLocale };
}
