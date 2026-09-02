import { describe, expect, it } from "vitest";
import {
  automaticCreationMethod,
  dailyReportAutomationId,
  dailyReportDocumentId,
  eligibleForAutomaticReport,
  previousJstDate,
  reportIsSubmitted
} from "./dailyAutomation.js";

describe("daily report automation helpers", () => {
  it("creates stable and distinct report and automation ids", () => {
    expect(dailyReportDocumentId("user-1", "2026-09-01")).toBe(dailyReportDocumentId("user-1", "2026-09-01"));
    expect(dailyReportDocumentId("user-1", "2026-09-01")).not.toBe(dailyReportAutomationId("user-1", "2026-09-01"));
    expect(dailyReportDocumentId("user-1", "2026-09-01")).not.toBe(dailyReportDocumentId("user-2", "2026-09-01"));
  });

  it("calculates the previous calendar day in Japan", () => {
    expect(previousJstDate(new Date("2026-09-01T15:15:00.000Z"))).toBe("2026-09-01");
  });

  it("treats legacy reports as submitted and keeps provisional reports separate", () => {
    expect(reportIsSubmitted(undefined)).toBe(true);
    expect(reportIsSubmitted("submitted")).toBe(true);
    expect(reportIsSubmitted("provisional")).toBe(false);
  });

  it("excludes demo, inactive, and viewer accounts", () => {
    expect(eligibleForAutomaticReport({ active: true, role: "employee" })).toBe(true);
    expect(eligibleForAutomaticReport({ active: true, role: "employee_manager" })).toBe(true);
    expect(eligibleForAutomaticReport({ active: false, role: "employee" })).toBe(false);
    expect(eligibleForAutomaticReport({ active: true, role: "employee", isDemo: true })).toBe(false);
    expect(eligibleForAutomaticReport({ active: true, role: "president_viewer" })).toBe(false);
    expect(automaticCreationMethod("day_rollover")).toBe("auto_day_rollover");
    expect(automaticCreationMethod("memo_updated")).toBe("auto_clock_out");
  });
});
