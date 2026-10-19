import { describe, expect, it } from "vitest";
import { buildTimeline, milestoneCount, monthIndex, todayMarker, validPlannedPeriod } from "./timeline";
import type { BusinessMilestone } from "./types";

describe("company initiative planned timeline", () => {
  it("places today's line using the Japan date and leap-month length", () => {
    expect(todayMarker(new Date("2028-02-28T15:00:00Z"))).toEqual({ month: "2028-02", day: 29, fraction: 28.5 / 29 });
    expect(todayMarker(new Date("2028-02-29T15:00:00Z"))).toEqual({ month: "2028-03", day: 1, fraction: 0.5 / 31 });
  });
  it("places December and January consecutively, independent of elapsed progress", () => {
    const rows = [{ plannedStartMonth: "2026-12", plannedEndMonth: "2027-02" }];
    const timeline = buildTimeline(rows, new Date("2026-12-31T15:00:00Z"));
    expect(timeline).toEqual({ months: ["2026-12", "2027-01", "2027-02"], todayMonth: "2027-01" });
    expect(monthIndex("2027-01") - monthIndex("2026-12")).toBe(1);
  });
  it("shows a single month once and leaves today's marker outside the plan range", () => {
    expect(buildTimeline([{ plannedStartMonth: "2025-01", plannedEndMonth: "2025-01" }], new Date("2026-09-01T00:00:00Z")))
      .toEqual({ months: ["2025-01"], todayMonth: "2026-09" });
  });
  it("builds an empty-plan window from Japan's current month instead of the mock date", () => {
    expect(buildTimeline([{ plannedStartMonth: "", plannedEndMonth: "" }], new Date("2029-03-31T16:00:00Z")).months)
      .toEqual(["2029-04", "2029-05", "2029-06", "2029-07", "2029-08", "2029-09"]);
  });
  it.each([["", ""], ["2026-09", "2026-09"], ["2026-12", "2027-01"]])("accepts complete optional or ordered periods %s %s", (a, b) => {
    expect(validPlannedPeriod(a, b)).toBe(true);
  });
  it.each([["", "2026-10"], ["2026-09", ""], ["2026-11", "2026-10"], ["2026-00", "2026-10"], ["2026-13", "2027-01"], ["0000-01", "2027-01"], ["2026-9", "2026-10"]])("rejects incomplete or invalid periods %s %s", (a, b) => {
    expect(validPlannedPeriod(a, b)).toBe(false);
  });
  it("counts only active milestones, independent of task status and dates", () => {
    const milestone = (id: string, completed: boolean, archived = false): BusinessMilestone => ({ id, name: id, completed, archived, order: 0, updatedAt: 0, updatedBy: "u" });
    expect(milestoneCount({ milestones: [milestone("one", true), milestone("two", false), milestone("old", true, true)] }))
      .toEqual({ completed: 1, total: 2 });
    expect(milestoneCount({ milestones: [milestone("old", true, true)] })).toEqual({ completed: 0, total: 0 });
  });
});
