import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

const mocks = vi.hoisted(() => ({ rows: new Map<string, Record<string, any>>(), ai: vi.fn(), writes: vi.fn() }));
vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-functions/params", () => ({ defineSecret: () => ({ value: () => "test-only" }) }));
vi.mock("openai", () => ({ default: class { responses = { create: mocks.ai }; } }));
vi.mock("firebase-admin/firestore", async (original) => {
  const actual = await original<typeof import("firebase-admin/firestore")>();
  const doc = (path: string) => ({ path, id: path.split("/").at(-1), get: async () => ({ exists: mocks.rows.has(path), data: () => mocks.rows.get(path) }), set: async (data: Record<string, any>) => { mocks.writes(path, data); mocks.rows.set(path, { ...mocks.rows.get(path), ...data }); } });
  const collection = (path: string, filters: Array<[string, unknown]> = []): any => ({
    doc: () => doc(`${path}/revision-${mocks.rows.size}`),
    where: (key: string, _op: string, value: unknown) => collection(path, [...filters, [key, value]]),
    get: async () => ({ docs: [...mocks.rows].filter(([key, value]) => key.startsWith(`${path}/`) && filters.every(([field, expected]) => value[field] === expected)).map(([key, value]) => ({ id: key.split("/").at(-1), data: () => value })) })
  });
  return { ...actual, getFirestore: () => ({
    doc, collection,
    batch: () => { const ops: Array<() => Promise<void>> = []; return { create: (ref: ReturnType<typeof doc>, data: any) => ops.push(() => ref.set(data)), update: (ref: ReturnType<typeof doc>, data: any) => ops.push(() => ref.set(data)), commit: async () => { for (const op of ops) await op(); } }; },
    runTransaction: async (task: any) => task({ get: (ref: ReturnType<typeof doc>) => ref.get(), set: (ref: ReturnType<typeof doc>, data: any) => ref.set(data) })
  }) };
});
import { generateWeeklyReport, saveWeeklyReport } from "./index.js";
import { weeklyReportSectionsSchema } from "./domain.js";
const request = (data: unknown, uid = "manager") => ({ auth: { uid, token: { role: "employee_manager" } }, data }) as CallableRequest;
const input = { userId: "employee", periodStart: "2026-08-25", periodEnd: "2026-09-25" };
const reportId = "employee_monthly_2026-08-25_2026-09-25";
const sections = () => weeklyReportSectionsSchema.parse({ themes: [{ title: "市場調査", activities: "期間内の調査" }, { title: "訪問", activities: "期間内の訪問" }] });

beforeEach(() => {
  mocks.rows.clear(); mocks.writes.mockClear(); mocks.ai.mockReset();
  for (const [uid, role] of [["manager", "employee_manager"], ["employee", "employee"], ["viewer", "president_viewer"]]) mocks.rows.set(`users/${uid}`, { uid, role, active: true, displayName: uid });
  mocks.ai.mockResolvedValue({ output_text: JSON.stringify(sections()) });
  for (const [id, date] of [["before", "2026-08-24"], ["start", "2026-08-25"], ["end", "2026-09-25"], ["after", "2026-09-26"]]) {
    mocks.rows.set(`dailyReports/${id}`, { userId: "employee", reportDate: date, status: "submitted", reviewStatus: "reviewed", category: "調査", activities: id });
    mocks.rows.set(`workLogs/${id}`, { userId: "employee", workDate: date, tagLabel: "調査", text: id });
    mocks.rows.set(`attendance/${id}`, { userId: "employee", workDate: date });
    mocks.rows.set(`productObservations/${id}`, { userId: "employee", discoveredDate: date, productId: "product" });
  }
  mocks.rows.set("dailyReports/draft", { userId: "employee", reportDate: "2026-09-01", status: "provisional" });
  mocks.rows.set("dailyReports/demo", { userId: "employee", reportDate: "2026-09-01", status: "submitted", isDemo: true, demoDatasetId: "sample" });
  mocks.rows.set("dailyReports/other-user", { userId: "other", reportDate: "2026-09-01", status: "submitted" });
  mocks.rows.set("weeklyPlans/overlap-start", { userId: "employee", weekStart: "2026-08-24", goals: "開始週の目標" });
  mocks.rows.set("weeklyPlans/middle", { userId: "employee", weekStart: "2026-09-07", goals: "中間週の目標" });
  mocks.rows.set("weeklyPlans/outside", { userId: "employee", weekStart: "2026-09-28", goals: "対象外の目標" });
});

describe("monthly report callables", () => {
  it("gathers both boundary dates and overlapping plans, excludes outside/draft/demo/other records, and leaves weekly reports untouched", async () => {
    mocks.rows.set("weeklyReports/employee_2026-08-24", { status: "finalized" });
    await generateWeeklyReport.run(request(input));
    const payload = JSON.parse(mocks.ai.mock.calls[0][0].input[1].content);
    for (const key of ["submittedDailyReports", "workLogs", "productCandidateText"]) expect(payload[key].map((row: any) => row.id)).toEqual(["start", "end"]);
    expect(payload.attendanceAggregate.attendanceDays).toBe(2);
    expect(payload.weeklyPlan.goals).toContain("開始週の目標"); expect(payload.weeklyPlan.goals).toContain("中間週の目標"); expect(payload.weeklyPlan.goals).not.toContain("対象外");
    expect(mocks.rows.get(`weeklyReports/${reportId}`)).toMatchObject({ reportKind: "monthly", periodStart: input.periodStart, periodEnd: input.periodEnd });
    expect(mocks.rows.get("weeklyReports/employee_2026-08-24")).toEqual({ status: "finalized" });
  });
  it("saves theme selections with all draft content and reloads them", async () => {
    await generateWeeklyReport.run(request(input));
    const selected = sections(); selected.themes[1].includeInReport = false;
    await saveWeeklyReport.run(request({ reportId, status: "finalized", sections: selected }));
    expect(mocks.rows.get(`weeklyReports/${reportId}`)).toMatchObject({ status: "finalized", themes: selected.themes });
  });
  it("rechecks unreviewed daily reports at the far end of the saved range when finalizing", async () => {
    await generateWeeklyReport.run(request(input));
    mocks.rows.get("dailyReports/end")!.reviewStatus = "unreviewed";
    await expect(saveWeeklyReport.run(request({ reportId, status: "finalized", sections: sections() }))).rejects.toMatchObject({ code: "failed-precondition" });
    expect(mocks.rows.get(`weeklyReports/${reportId}`)!.status).toBe("ai_draft");
  });
  it("rejects finalizing with no selected themes", async () => {
    await generateWeeklyReport.run(request(input));
    const none = sections(); none.themes.forEach((theme) => { theme.includeInReport = false; });
    await expect(saveWeeklyReport.run(request({ reportId, status: "finalized", sections: none }))).rejects.toMatchObject({ code: "failed-precondition" });
  });
  it("retains legacy weekly requests and IDs", async () => {
    await generateWeeklyReport.run(request({ userId: "employee", weekStart: "2026-08-25" }));
    expect(mocks.rows.get("weeklyReports/employee_2026-08-24")).toMatchObject({ weekStart: "2026-08-24", weekEnd: "2026-08-30" });
  });
  it("falls back to grouped source records, including daily reports without work logs", async () => {
    for (const path of mocks.rows.keys()) if (path.startsWith("workLogs/")) mocks.rows.delete(path);
    mocks.ai.mockRejectedValue(new Error("AI unavailable"));
    await generateWeeklyReport.run(request(input));
    expect(mocks.rows.get(`weeklyReports/${reportId}`)!.themes[0].activities).toContain("2026-08-25 start");
    expect(mocks.rows.get(`weeklyReports/${reportId}`)!.aiError).toBeTruthy();
  });
  it.each(["employee", "viewer", "unregistered"])("rejects %s even with a stale manager token", async (uid) => {
    await expect(generateWeeklyReport.run(request(input, uid))).rejects.toMatchObject({ code: "permission-denied" });
    expect(mocks.ai).not.toHaveBeenCalled(); expect(mocks.writes).not.toHaveBeenCalled();
  });
  it("rejects invalid dates before calling AI or writing", async () => {
    await expect(generateWeeklyReport.run(request({ ...input, periodEnd: "2026-02-30" }))).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mocks.ai).not.toHaveBeenCalled(); expect(mocks.writes).not.toHaveBeenCalled();
  });
});
