import { describe, expect, it } from "vitest";
import {
  createDemoFixture,
  DEMO_DATASET_ID,
  DEMO_SEED_VERSION,
  DEMO_USER_ID,
  fixtureSummary
} from "./demo-data-fixture.mjs";

const fixture = createDemoFixture();
const documents = fixture.documents;
const byRoot = (root) => documents.filter(({ path }) => path.split("/")[0] === root);
const dataAt = (path) => documents.find((item) => item.path === path)?.data;

function validJan(value) {
  if (!/^\d{8}$|^\d{13}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const checkDigit = digits.pop();
  const sum = digits.reduce((total, digit, index) => {
    const fromRight = digits.length - index;
    return total + digit * (fromRight % 2 === 1 ? 3 : 1);
  }, 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}

describe("方さんデモデータ fixture", () => {
  it("creates the planned one-month dataset with fixed, unique paths", () => {
    expect(fixture.expected).toEqual({
      weekdays: 23,
      normalAttendance: 22,
      holidayAttendance: 1,
      attendance: 23,
      nonWorkingReasons: 1,
      workLogs: 60,
      dailyReports: 23,
      products: 12,
      productObservations: 15,
      weeklyPlans: 5,
      weeklyReports: 4,
      weeklyMeetings: 4,
      unreviewedDailyReports: 1
    });
    expect(new Set(documents.map(({ path }) => path)).size).toBe(documents.length);
    expect(byRoot("attendance")).toHaveLength(23);
    expect(byRoot("workLogs")).toHaveLength(60);
    expect(byRoot("dailyReports").filter(({ path }) => path.split("/").length === 2)).toHaveLength(23);
    expect(byRoot("products")).toHaveLength(12);
    expect(byRoot("productObservations")).toHaveLength(15);
    expect(byRoot("weeklyPlans")).toHaveLength(5);
    expect(byRoot("weeklyReports")).toHaveLength(4);
    expect(byRoot("weeklyMeetings")).toHaveLength(4);
  });

  it("marks every document and the Auth account as the same demo dataset", () => {
    for (const { data } of documents) {
      expect(data.isDemo).toBe(true);
      expect(data.demoDatasetId).toBe(DEMO_DATASET_ID);
      expect(data.seedVersion).toBe(DEMO_SEED_VERSION);
    }
    expect(fixture.authUser.uid).toBe(DEMO_USER_ID);
    expect(fixture.authUser.claims).toMatchObject({
      role: "employee",
      isDemo: true,
      demoDatasetId: DEMO_DATASET_ID,
      seedVersion: DEMO_SEED_VERSION
    });
  });

  it("keeps production-looking totals separate from nested revision and tag counts", () => {
    expect(fixtureSummary().documentCounts).toMatchObject({
      users: 1,
      workTags: 6,
      attendance: 23,
      workLogs: 60,
      dailyReports: 23,
      reportRevisions: 1,
      products: 12,
      productObservations: 15
    });
  });

  it("includes leave, holiday work, a correction, and all supported work modes", () => {
    const attendance = byRoot("attendance").map(({ data }) => data);
    expect(new Set(attendance.map(({ workMode }) => workMode))).toEqual(new Set(["office", "business_trip", "home", "other"]));
    expect(attendance.filter(({ holidayWork }) => holidayWork)).toHaveLength(1);
    expect(attendance.find(({ holidayWork }) => holidayWork)?.workDate).toBe("2026-07-04");
    expect(attendance.filter(({ corrected }) => corrected)).toHaveLength(1);
    expect(dataAt(`nonWorkingReasons/${DEMO_USER_ID}_2026-06-26`)).toMatchObject({ reasonType: "paid_leave", workDate: "2026-06-26" });
  });

  it("leaves exactly the July 15 report unreviewed for the live demonstration", () => {
    const reports = byRoot("dailyReports")
      .filter(({ path }) => path.split("/").length === 2)
      .map(({ data }) => data);
    const unreviewed = reports.filter(({ reviewStatus }) => reviewStatus === "unreviewed");
    expect(unreviewed).toHaveLength(1);
    expect(unreviewed[0].reportDate).toBe("2026-07-15");
    expect(dataAt(`${"weeklyPlans"}/${DEMO_USER_ID}_2026-07-13`)?.status).toBe("confirmed");
    expect(dataAt(`${"weeklyReports"}/${DEMO_USER_ID}_2026-07-13`)).toBeUndefined();
    expect(dataAt(`${"weeklyMeetings"}/${DEMO_USER_ID}_2026-07-13`)).toBeUndefined();
  });

  it("uses fictional products with valid JAN values and bilingual observations", () => {
    const products = byRoot("products").map(({ data }) => data);
    expect(new Set(products.map(({ status }) => status))).toEqual(new Set(["new", "considering", "on_hold", "closed"]));
    products.forEach(({ name, makerBrand, jan }) => {
      expect(name).toMatch(/^DEMO /);
      expect(makerBrand).toContain("架空");
      expect(validJan(jan)).toBe(true);
    });
    byRoot("productObservations").forEach(({ data }) => {
      expect(data.reasonLanguage).toBe("zh-CN");
      expect(data.reasonOriginal).toMatch(/[\u4E00-\u9FFF]/);
      expect(data.reasonJapanese).toContain("DEMO");
    });
  });

  it("does not copy real Drive or immigration source documents into the demo dataset", () => {
    expect(documents.some(({ path }) => path.startsWith("sourceDocumentReferences/"))).toBe(false);
    expect(documents.some(({ path }) => path.startsWith("employmentBases/"))).toBe(false);
    expect(JSON.stringify(documents)).not.toContain("drive.google.com");
  });
});
