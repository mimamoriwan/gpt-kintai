import { describe, expect, it } from "vitest";
import { japaneseHolidayName, resolveCompanyDay } from "./companyCalendar";

describe("company calendar", () => {
  it("treats Saturday and Sunday as company holidays", () => {
    expect(resolveCompanyDay("2026-07-18")).toMatchObject({ isHoliday: true, source: "weekend", label: "土曜日" });
    expect(resolveCompanyDay("2026-07-19")).toMatchObject({ isHoliday: true, source: "weekend", label: "日曜日" });
  });

  it("recognizes Japanese national holidays and citizen holidays", () => {
    expect(japaneseHolidayName("2026-07-20")).toBe("海の日");
    expect(japaneseHolidayName("2026-09-22")).toBe("国民の休日");
  });

  it("allows a manager exception to turn a weekday into a company holiday", () => {
    expect(resolveCompanyDay("2026-07-17", {
      id: "2026-07-17",
      date: "2026-07-17",
      dayType: "company_holiday",
      label: "夏季休業",
      updatedBy: "manager"
    })).toMatchObject({ isHoliday: true, source: "override", label: "夏季休業" });
  });

  it("allows a manager exception to turn a weekend into a normal workday", () => {
    expect(resolveCompanyDay("2026-07-18", {
      id: "2026-07-18",
      date: "2026-07-18",
      dayType: "workday",
      label: "振替出勤日",
      updatedBy: "manager"
    })).toMatchObject({ isHoliday: false, source: "override", label: "振替出勤日" });
  });
});
