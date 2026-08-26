import { describe, expect, it } from "vitest";
import { MONTHLY_AI_GENERATION_ALERT_THRESHOLD, aiApiGenerationCount, aiUsageReportDate, monthlyAiUsageEvents } from "./aiUsage";
import type { AuditEvent } from "../types";

function event(id: string, action: string, iso: string, entityId = `employee_${id}_2026-08-20`): AuditEvent {
  const date = new Date(iso);
  return {
    id,
    actorId: "employee",
    subjectUserId: "employee",
    entityType: "daily_report_draft",
    entityId,
    action,
    createdAt: { toDate: () => date, toMillis: () => date.getTime() } as AuditEvent["createdAt"]
  };
}

describe("AI usage summaries", () => {
  it("counts only actual API generations in the selected month", () => {
    const rows = monthlyAiUsageEvents([
      event("generated", "ai_generated", "2026-08-10T01:00:00Z"),
      event("cached", "ai_cache_reused", "2026-08-11T01:00:00Z"),
      event("old", "ai_generated", "2026-07-11T01:00:00Z")
    ], "2026-08");
    expect(aiApiGenerationCount(rows)).toBe(1);
    expect(MONTHLY_AI_GENERATION_ALERT_THRESHOLD).toBe(50);
  });

  it("reads the report date from new and legacy audit records", () => {
    expect(aiUsageReportDate({ ...event("new", "ai_generated", "2026-08-10T01:00:00Z"), after: { reportDate: "2026-08-09" } })).toBe("2026-08-09");
    expect(aiUsageReportDate(event("legacy", "ai_generated", "2026-08-10T01:00:00Z", "employee_uid_2026-08-08"))).toBe("2026-08-08");
  });
});
