import { readFileSync } from "node:fs";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import { acknowledgeDailyReportReplies } from "./reportReplies.js";

function fixture() {
  const profile: Record<string, any> = { uid: "owner", active: true, role: "employee" };
  const report: Record<string, any> = { userId: "owner", status: "submitted", comments: [
    { id: "c1", authorId: "president", authorRole: "president_viewer" },
    { id: "c2", authorId: "manager", authorRole: "employee_manager" },
    { id: "self", authorId: "owner", authorRole: "employee_manager" }
  ] };
  let exists = true;
  let beforeTransaction = () => {};
  const update = vi.fn();
  const db = {
    doc: (path: string) => ({ path, get: async () => ({ data: () => profile }) }),
    runTransaction: async (work: (transaction: unknown) => Promise<unknown>) => {
      beforeTransaction();
      return work({
        get: async (ref: { path: string }) => ({ exists: ref.path.startsWith("users/") || exists, data: () => ref.path.startsWith("users/") ? profile : report }),
        update
      });
    }
  } as unknown as Firestore;
  const auth = { uid: "owner", token: { role: "employee", auth_time: 200 } };
  const call = (commentIds = ["c1"], data: unknown = { reportId: "r1", commentIds }, context: typeof auth | undefined = auth) => acknowledgeDailyReportReplies(context, data, db);
  return { profile, report, update, call, auth, db, missing: () => { exists = false; }, before: (work: () => void) => { beforeTransaction = work; } };
}

describe("daily report reply acknowledgement", () => {
  it("merges displayed IDs atomically without replacing report or comment contents", async () => {
    const f = fixture();
    f.report.commentsReadIds = ["c2"];
    await expect(f.call()).resolves.toEqual({ ok: true });
    expect(f.update).toHaveBeenCalledWith({ path: "dailyReports/r1", get: expect.any(Function) }, { commentsReadIds: FieldValue.arrayUnion("c1") });
    expect(f.report.comments).toHaveLength(3);
  });
  it("remains safe on retry and never includes a concurrently added comment", async () => {
    const f = fixture();
    f.before(() => f.report.comments.push({ id: "new", authorId: "president", authorRole: "president_viewer" }));
    await f.call(); await f.call();
    expect(f.update).toHaveBeenCalledTimes(2);
    for (const [, change] of f.update.mock.calls) expect(change).toEqual({ commentsReadIds: FieldValue.arrayUnion("c1") });
  });
  it("requires authentication", async () => {
    const f = fixture();
    await expect(acknowledgeDailyReportReplies(undefined, { reportId: "r1", commentIds: ["c1"] }, f.db)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(f.update).not.toHaveBeenCalled();
  });
  it.each([
    { active: false }, { uid: "other" }, { passwordChangeRequired: true },
    { passwordAuthTimeAfter: 201 }, { role: "unknown" }
  ])("preserves the current account gate for %j", async (change) => {
    const f = fixture(); Object.assign(f.profile, change);
    await expect(f.call()).rejects.toMatchObject({ code: expect.stringMatching(/permission-denied|failed-precondition/) });
    expect(f.update).not.toHaveBeenCalled();
  });
  it("rechecks revocation inside the transaction", async () => {
    const f = fixture(); f.before(() => { f.profile.active = false; });
    await expect(f.call()).rejects.toMatchObject({ code: "permission-denied" });
    expect(f.update).not.toHaveBeenCalled();
  });
  it.each(["employee", "employee_manager", "president_viewer"])("denies %s acknowledgement of another owner's report", async (role) => {
    const f = fixture(); f.profile.role = role; f.report.userId = "other";
    await expect(f.call()).rejects.toMatchObject({ code: "permission-denied" });
    expect(f.update).not.toHaveBeenCalled();
  });
  it.each([
    [{ isDemo: true, demoDatasetId: "a" }, {}],
    [{}, { isDemo: true }],
    [{ isDemo: true, demoDatasetId: "a" }, { isDemo: true, demoDatasetId: "b" }]
  ])("denies a mismatched demo scope", async (profileScope, reportScope) => {
    const f = fixture(); Object.assign(f.profile, profileScope); Object.assign(f.report, reportScope);
    await expect(f.call()).rejects.toMatchObject({ code: "permission-denied" });
    expect(f.update).not.toHaveBeenCalled();
  });
  it("accepts the owner's matching demo dataset", async () => {
    const f = fixture(); Object.assign(f.profile, { isDemo: true, demoDatasetId: "a" }); Object.assign(f.report, { isDemo: true, demoDatasetId: "a" });
    await expect(f.call()).resolves.toEqual({ ok: true });
  });
  it("rejects provisional and missing reports", async () => {
    const f = fixture(); f.report.status = "provisional";
    await expect(f.call()).rejects.toMatchObject({ code: "failed-precondition" });
    f.missing();
    await expect(f.call()).rejects.toMatchObject({ code: "not-found" });
    expect(f.update).not.toHaveBeenCalled();
  });
  it.each([["unknown"], ["self"], ["c1", "unknown"]])("rejects IDs that are not incoming replies: %j", async (...ids) => {
    const f = fixture(); await expect(f.call(ids)).rejects.toMatchObject({ code: "invalid-argument" });
    expect(f.update).not.toHaveBeenCalled();
  });
  it.each([{ reportId: "r1", commentIds: [] }, { reportId: "a/b", commentIds: ["c1"] }, { reportId: "r1", commentIds: Array(101).fill("c1") }])("rejects invalid input", async (data) => {
    const f = fixture(); await expect(f.call([], data)).rejects.toThrow(); expect(f.update).not.toHaveBeenCalled();
  });
  it("exports the callable with the shared App Check options and error handling", () => {
    const source = readFileSync("src/index.ts", "utf8");
    expect(source).toContain("markDailyReportCommentsRead = onCall(callableOptions");
    expect(source).toContain("acknowledgeDailyReportReplies(auth, request.data, firestore)");
  });
});
