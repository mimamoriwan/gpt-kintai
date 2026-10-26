import type { Firestore } from "firebase-admin/firestore";
import { carryoverKey, digest, documentId, scopeOf, validateItems, type TodoItem } from "./domain.js";

type Dependencies = { db: Firestore; getAccount: (uid: string) => Promise<{ disabled: boolean }>; now?: () => number };
const roles = ["employee", "employee_manager", "president_viewer"];
export function currentTodoWeek(at: number): string {
  const date = new Date(at + 9 * 3600000);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
type Origin = NonNullable<TodoItem["carriedFrom"]>;
const normalizeOrigin = (origin: Origin): Origin => ({ weekStart: origin.weekStart, itemId: origin.itemId });
function unfinished(items: TodoItem[]) { return items.filter(item => !item.withdrawn && item.progress < 100); }

export function createWeeklyTodoCarryover({ db, getAccount, now = Date.now }: Dependencies) {
  async function ensure(uid: string, requestedWeek = currentTodoWeek(now())) {
    // Viewing another week must never prematurely roll a plan forward or rewrite history.
    if (requestedWeek !== currentTodoWeek(now())) return;
    if ((await getAccount(uid)).disabled) return;
    await db.runTransaction(async tx => {
      const profile = (await tx.get(db.doc(`users/${uid}`))).data();
      if (!profile?.active || !roles.includes(profile.role)) return;
      const scopeId = scopeOf(profile);
      const targetRef = db.doc(`weeklyTodoWeeks/${documentId(scopeId, uid, requestedWeek)}`);
      const before = (await tx.get(targetRef)).data();
      // A single-field query needs no new composite index. Read inside the transaction
      // so a concurrent progress save cannot race the carryover decision.
      const records = await tx.get(db.collection("weeklyTodoWeeks").where("userId", "==", uid));
      const past = records.docs.map(doc => doc.data()).filter(row => row.scopeId === scopeId && row.weekStart < requestedWeek)
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
      const previous = past[0]; const byWeek = new Map(past.map(row => [row.weekStart, row]));
      const existing: TodoItem[] = before?.draft?.items || before?.shared?.items || [];
      const used = new Set<string>(before?.carriedSources || []);
      for (const item of existing) if (item.carriedFrom) used.add(carryoverKey(item.carriedFrom));
      const candidates: Origin[] = [
        ...(before?.carryoverPending || []), ...(previous?.carryoverPending || []),
        ...unfinished(previous?.draft?.items || previous?.shared?.items || []).map(item => ({ weekStart: previous!.weekStart, itemId: item.id }))
      ];
      const items = [...existing]; const pending: Origin[] = []; const seen = new Set<string>();
      for (const candidate of candidates) {
        const origin = normalizeOrigin(candidate); const key = carryoverKey(origin);
        if (used.has(key) || seen.has(key)) continue;
        seen.add(key);
        const sourceWeek = byWeek.get(origin.weekStart);
        const source: TodoItem | undefined = (sourceWeek?.draft?.items || sourceWeek?.shared?.items || []).find((item: TodoItem) => item.id === origin.itemId);
        if (!source || source.withdrawn || source.progress === 100) continue;
        const next = { ...source, id: `carry_${digest([requestedWeek, key])}`, carriedFrom: origin };
        // Preserve the saved progress, goals, memo and their original languages.
        // Overflow remains queued; neither existing plans nor pending work is dropped.
        let fits = items.length < 30 && !items.some(item => item.id === next.id);
        if (fits) { try { validateItems([...items, next], "draft"); } catch { fits = false; } }
        if (fits) { items.push(next); used.add(key); } else pending.push(origin);
      }
      if (items.length === existing.length && digest(pending) === digest((before?.carryoverPending || []).map(normalizeOrigin))) return;
      const at = now();
      tx.set(targetRef, { ...(before || {}), scopeId, userId: uid, weekStart: requestedWeek,
        version: (before?.version || 0) + 1, draft: { items, at }, updatedAt: at,
        carriedSources: [...used], carryoverPending: pending });
    });
  }
  async function runAll() {
    const weekStart = currentTodoWeek(now());
    const profiles = await db.collection("users").where("active", "==", true).get();
    let failures = 0;
    for (const doc of profiles.docs) {
      if (!roles.includes(doc.data().role)) continue;
      try { await ensure(doc.id, weekStart); } catch { failures++; }
    }
    // Retry the job after processing the other accounts. Successful writes are idempotent.
    if (failures) throw new Error(`Weekly To Do carryover failed for ${failures} account(s)`);
  }
  return { ensure, runAll };
}
