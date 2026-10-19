import { describe, expect, it } from "vitest";
import { generateReportInputSchema, monthsInReportRange, reportDocumentId, reportRange } from "./reportPeriod.js";

describe("report periods", () => {
  it("retains both chosen dates without aligning to a Monday", () => {
    expect(reportRange("2026-08-25", "2026-09-25")).toEqual({ weekStart: "2026-08-25", weekEnd: "2026-09-25" });
    expect(reportRange("2026-09-25")).toEqual({ weekStart: "2026-09-21", weekEnd: "2026-09-27" });
  });
  it.each([["2026-02-30", "2026-03-02"], ["2026-09-25", "2026-08-25"], ["2025-01-01", "2026-01-02"], ["", "2026-09-25"]])("rejects invalid ranges %s to %s", (periodStart, periodEnd) => {
    expect(generateReportInputSchema.safeParse({ userId: "employee", periodStart, periodEnd }).success).toBe(false);
  });
  it("requires both custom dates and preserves single-day and leap-day periods", () => {
    expect(generateReportInputSchema.safeParse({ userId: "employee", periodStart: "2026-09-25" }).success).toBe(false);
    expect(reportRange("2024-02-29", "2024-02-29").weekEnd).toBe("2024-02-29");
  });
  it("separates weekly and monthly IDs and different end dates", () => {
    const ids = [reportDocumentId("employee", "2026-08-24"), reportDocumentId("employee", "2026-08-24", "2026-09-24"), reportDocumentId("employee", "2026-08-24", "2026-09-25")];
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("employee_2026-08-24");
  });
  it("invalidates every covered month including intermediate months and year boundaries", () => {
    expect(monthsInReportRange("2025-12-25", "2026-03-25")).toEqual(["2025-12", "2026-01", "2026-02", "2026-03"]);
  });
});
