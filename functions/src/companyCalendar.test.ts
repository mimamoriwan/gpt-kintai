import { describe, expect, it } from "vitest";
import { japaneseHolidayName, resolveCompanyDay } from "./companyCalendar.js";

describe("company calendar on the server", () => {
  it("classifies weekends and Japanese holidays without creating attendance", () => {
    expect(resolveCompanyDay("2026-07-18")).toMatchObject({ isHoliday: true, source: "weekend" });
    expect(japaneseHolidayName("2026-07-20")).toBe("海の日");
  });

  it("gives a stored manager exception priority over the automatic calendar", () => {
    expect(resolveCompanyDay("2026-07-18", { dayType: "workday", label: "振替出勤日" }))
      .toEqual({ isHoliday: false, source: "override", label: "振替出勤日" });
    expect(resolveCompanyDay("2026-07-17", { dayType: "company_holiday", label: "会社休業日" }))
      .toEqual({ isHoliday: true, source: "override", label: "会社休業日" });
  });
});
