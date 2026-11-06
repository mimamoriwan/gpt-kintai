import type { DocumentReference, Firestore, Query, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { documentId, type TodoItem } from "../weeklyTodo/domain.js";
import { identifier, type Milestone, type Row } from "./domain.js";

const DAY = 86_400_000;
const JST = 9 * 3_600_000;
const LIST_LIMIT = 500;
const HISTORY_LIMIT = 1500;
const inputSchema = z.object({ from: z.iso.date(), to: z.iso.date(), assigneeId: identifier.optional() }).strict();

export function retrospectivePeriod(data: unknown, now: number) {
  const input = inputSchema.parse(data);
  const start = Date.parse(input.from + "T00:00:00+09:00");
  const end = Date.parse(input.to + "T00:00:00+09:00") + DAY;
  if (!(end > start && end - start <= 366 * DAY) || input.to > new Date(now + JST).toISOString().slice(0, 10)) {
    throw new HttpsError("invalid-argument", "本日までの366日以内の期間を指定してください。");
  }
  return { ...input, start, end };
}

type Period = ReturnType<typeof retrospectivePeriod>;
const activeMilestones = (row: Row | null | undefined): Milestone[] =>
  (row?.milestones ?? []).filter((item: Milestone) => !item.archived);

function atBoundary(current: Row, events: Row[], boundary: number): Row | null | undefined {
  if (current.createdAt >= boundary) return null;
  const next = events.find(event => event.createdAt >= boundary);
  if (next) return next.before;
  const latest = current.latestUpdate;
  if (current.updatedAt < boundary || (latest?.createdAt === current.updatedAt && latest && !latest.weeklyTodo)) return current;
  return events.at(-1)?.after;
}

function snapshot(row: Row | null | undefined, theme: Row | null | undefined) {
  if (row === null) return { state: "not-created" as const };
  if (row?.archived || theme?.archived) return { state: "archived" as const };
  if (!row || !theme) return { state: "unknown" as const };
  const milestones = activeMilestones(row);
  return { state: "active" as const, completed: milestones.filter(item => item.completed).length, total: milestones.length, status: row.status };
}

export function summarizeInitiatives(initiatives: Row[], themes: Row[], history: Row[], updates: Row[], period: Period) {
  const byEntity = new Map<string, Row[]>();
  const updatesByInitiative = new Set(updates.map(row => row.initiativeId));
  for (const event of history) {
    const key = event.entityType + ":" + event.entityId;
    const events = byEntity.get(key) ?? [];
    events.push(event);
    byEntity.set(key, events);
  }
  for (const events of byEntity.values()) events.sort((a, b) => a.after.version - b.after.version);
  const themeMap = new Map(themes.map(row => [row.id, row]));
  const themeAt = (row: Row | null | undefined, boundary: number) => {
    const theme = row && themeMap.get(row.themeId);
    return theme ? atBoundary(theme, byEntity.get("theme:" + theme.id) ?? [], boundary) : undefined;
  };
  const rows = initiatives.flatMap(initiative => {
    if (initiative.createdAt >= period.end) return [];
    const events = byEntity.get("initiative:" + initiative.id) ?? [];
    const inside = events.filter(event => event.createdAt < period.end);
    const start = atBoundary(initiative, events, period.start);
    const end = atBoundary(initiative, events, period.end);
    const before = snapshot(start, themeAt(start, period.start));
    const after = snapshot(end, themeAt(end, period.end));
    const reference = end ?? inside.at(-1)?.after ?? start ?? events[0]?.before ?? initiative;
    const assignees = new Set([start, end, ...inside.flatMap(event => [event.before, event.after])]
      .flatMap(row => (row?.assigneeIds ?? []) as string[]));
    if (before.state === "unknown" || after.state === "unknown") {
      for (const uid of reference.assigneeIds ?? []) assignees.add(uid);
    }
    if (period.assigneeId && !assignees.has(period.assigneeId)) return [];
    if (before.state === "archived" && after.state === "archived" && !inside.length && !updatesByInitiative.has(initiative.id)) return [];

    const checked = new Set<string>();
    for (const event of inside) {
      const prior = new Set((event.before?.milestones ?? []).filter((item: Milestone) => item.completed).map((item: Milestone) => item.id));
      for (const item of activeMilestones(event.after)) {
        if (item.completed && !prior.has(item.id)) checked.add(item.id);
      }
    }
    const milestones = after.state === "active" ? activeMilestones(end) : [];
    return [{
      id: initiative.id, name: String(reference.name), sourceLocale: reference.sourceLocale, assigneeIds: [...assignees],
      before, after, hasActivity: inside.length > 0 || updatesByInitiative.has(initiative.id) ||
        before.state !== after.state || before.status !== after.status,
      completed: milestones.filter(item => item.completed && checked.has(item.id)).map(item => ({ id: item.id, name: item.name })),
      remaining: milestones.filter(item => !item.completed).map(item => ({ id: item.id, name: item.name }))
    }];
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

const completedItems = (snapshot?: Row): Set<string> =>
  new Set((snapshot?.items ?? []).filter((item: TodoItem) => !item.withdrawn && item.progress === 100).map((item: TodoItem) => item.id));

export function countCompletedWeekly(groups: { revisions: Row[]; previous?: Row }[]): number {
  let total = 0;
  for (const { revisions, previous } of groups) {
    let completed = completedItems(previous);
    const completedDuring = new Set<string>();
    for (const row of revisions) {
      const next = completedItems(row.snapshot);
      for (const id of next) if (!completed.has(id)) completedDuring.add(id);
      completed = next;
    }
    total += [...completedDuring].filter(id => completed.has(id)).length;
  }
  return total;
}

export async function collectRetrospective(
  tx: Transaction, db: Firestore, scopes: { business: string; weekly: string }, memberIds: string[], period: Period
) {
  const scoped = (collection: string, scope: string) => db.collection(collection).where("scopeId", "==", scope);
  async function rows(query: Query, limit: number, range?: { field: string; upper?: number }) {
    if (range) {
      query = query.where(range.field, ">=", period.start);
      if (range.upper !== undefined) query = query.where(range.field, "<", range.upper);
    }
    const result = await tx.get(query.limit(limit + 1));
    if (result.size > limit) throw new HttpsError("resource-exhausted", "記録が多いため、対象期間の開始日を新しくしてください。");
    return result.docs.map(doc => doc.data());
  }
  const weeklyMembers = period.assigneeId ? [period.assigneeId] : memberIds;
  const [initiatives, themes, history, updates, weekly] = await Promise.all([
    rows(scoped("businessInitiatives", scopes.business), LIST_LIMIT), rows(scoped("businessThemes", scopes.business), LIST_LIMIT),
    // Later events supply the before snapshot when viewing a historical period.
    rows(scoped("businessHistory", scopes.business), HISTORY_LIMIT, { field: "createdAt" }),
    rows(scoped("businessUpdates", scopes.business), HISTORY_LIMIT, { field: "createdAt", upper: period.end }),
    rows(scoped("weeklyTodoHistory", scopes.weekly).where("userId", "in", weeklyMembers), HISTORY_LIMIT, { field: "snapshot.at", upper: period.end })
  ]);
  const summary = summarizeInitiatives(initiatives, themes, history, updates, period);
  const selected = new Set(summary.map(row => row.id));
  const revoked = new Set(updates.filter(row => row.weeklyTodo?.action === "reopen").map(row => row.weeklyTodo.previousReportId));
  const reports = updates.filter(row => row.weeklyTodo?.action === "complete" && selected.has(row.initiativeId) && !revoked.has(row.id))
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .map(({ id, initiativeId, authorId, authorName, body, sourceLocale, createdAt }) =>
      ({ id, initiativeId, authorId, authorName, body, sourceLocale, createdAt }));

  const byWeek = new Map<string, Row[]>();
  for (const row of weekly) {
    if (!["share", "review"].includes(row.kind)) continue;
    const key = documentId(scopes.weekly, row.userId, row.weekStart);
    const revisions = byWeek.get(key) ?? [];
    revisions.push(row);
    byWeek.set(key, revisions);
  }
  const previousRefs: DocumentReference[] = [];
  const groups = [...byWeek].map(([key, revisions]) => {
    revisions.sort((a, b) => a.snapshot.revision - b.snapshot.revision);
    const first = revisions[0].snapshot.revision;
    const index = first > 1 ? previousRefs.push(db.doc(`weeklyTodoHistory/${key}_${String(first - 1).padStart(8, "0")}`)) - 1 : -1;
    return { revisions, index };
  });
  const previous = previousRefs.length ? await tx.getAll(...previousRefs) : [];
  const baselines = groups.flatMap(({ revisions, index }) => {
    const row = previous[index]?.data();
    if (index >= 0 && (row?.scopeId !== scopes.weekly || row?.userId !== revisions[0].userId || row?.weekStart !== revisions[0].weekStart || !row?.snapshot)) {
      return [];
    }
    return [{ revisions, previous: row?.snapshot }];
  });
  return {
    initiatives: summary,
    reports,
    completedMilestones: summary.reduce((sum, row) => sum + row.completed.length, 0),
    completedWeekly: countCompletedWeekly(baselines),
    weeklyHistoryIncomplete: baselines.length !== groups.length,
    remainingMilestones: summary.reduce((sum, row) => sum + row.remaining.length, 0)
  };
}
