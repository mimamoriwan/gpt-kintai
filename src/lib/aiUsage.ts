import { todayJst } from "./format";
import type { AuditEvent, UserProfile } from "../types";

export const MONTHLY_AI_GENERATION_ALERT_THRESHOLD = 50;

export function monthlyAiUsageEvents(events: AuditEvent[], month: string, userId = ""): AuditEvent[] {
  return events
    .filter((event) => !event.isDemo && todayJst(event.createdAt.toDate()).startsWith(month) && (!userId || event.subjectUserId === userId))
    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
}

export function aiApiGenerationCount(events: AuditEvent[]): number {
  return events.filter((event) => event.action === "ai_generated").length;
}

export function aiCacheReuseCount(events: AuditEvent[]): number {
  return events.filter((event) => event.action === "ai_cache_reused").length;
}

export function aiUsageNumber(event: AuditEvent, key: string): number {
  const after = event.after && typeof event.after === "object" ? event.after as Record<string, unknown> : {};
  const value = Number(after[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

export function aiUsageReportDate(event: AuditEvent): string {
  const after = event.after && typeof event.after === "object" ? event.after as Record<string, unknown> : {};
  const storedDate = typeof after.reportDate === "string" ? after.reportDate : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(storedDate)) return storedDate;
  return event.entityId.match(/\d{4}-\d{2}-\d{2}$/)?.[0] || "";
}

export function summarizeAiUsage(events: AuditEvent[], users: UserProfile[]) {
  const names = new Map(users.map((user) => [user.uid, user.displayName]));
  const rows = new Map<string, { userId: string; userName: string; apiRuns: number; cacheReuses: number; inputTokens: number; outputTokens: number; lastUsedAt?: AuditEvent["createdAt"] }>();
  for (const event of events) {
    const row = rows.get(event.subjectUserId) || { userId: event.subjectUserId, userName: names.get(event.subjectUserId) || event.subjectUserId, apiRuns: 0, cacheReuses: 0, inputTokens: 0, outputTokens: 0 };
    if (event.action === "ai_generated") row.apiRuns += 1;
    if (event.action === "ai_cache_reused") row.cacheReuses += 1;
    row.inputTokens += aiUsageNumber(event, "inputTokens");
    row.outputTokens += aiUsageNumber(event, "outputTokens");
    if (!row.lastUsedAt || event.createdAt.toMillis() > row.lastUsedAt.toMillis()) row.lastUsedAt = event.createdAt;
    rows.set(event.subjectUserId, row);
  }
  return [...rows.values()].sort((a, b) => b.apiRuns - a.apiRuns || b.cacheReuses - a.cacheReuses || a.userName.localeCompare(b.userName, "ja"));
}
