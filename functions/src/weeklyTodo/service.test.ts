import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { createWeeklyTodoService } from "./service.js";
import { digest, documentId, scopeOf, weekDates, type Row, type TodoItem } from "./domain.js";

class Database {
  rows = new Map<string, Row>(); queue: Promise<unknown> = Promise.resolve();
  doc(path: string): any { return { id: path.split("/").at(-1), path, get: async () => this.snapshot(path), set: async (value: Row) => { this.rows.set(path, structuredClone(value)); } }; }
  snapshot(path: string) { const value = this.rows.get(path); return { id: path.split("/").at(-1), exists: Boolean(value), data: () => value ? structuredClone(value) : undefined }; }
  collection(name: string): any { return { where: (field: string, _op: string, expected: unknown) => ({ get: async () => ({ docs: [...this.rows].filter(([path, value]) => path.startsWith(name + "/") && value[field] === expected).map(([path]) => this.snapshot(path)) }) }) }; }
  runTransaction(callback: (tx: any) => Promise<any>) {
    const operation = this.queue.then(async () => {
      const changes: [string, Row][] = [];
      const result = await callback({ get: async (ref: any) => { if (changes.length) throw Error("Read after write"); return this.snapshot(ref.path); }, set: (ref: any, row: Row) => changes.push([ref.path, row]), create: (ref: any, row: Row) => { if (this.rows.has(ref.path)) throw Error("Already exists"); changes.push([ref.path, row]); } });
      for (const [path, row] of changes) this.rows.set(path, structuredClone(row)); return result;
    }); this.queue = operation.catch(() => undefined); return operation;
  }
}
const weekStart = "2026-10-19";
const item = (patch: Partial<TodoItem> = {}): TodoItem => ({ id: "task-a", title: "比較表を作成", goal: "金曜までに初稿を完成", progress: 0, memo: "", sourceLocale: "ja", memoLocale: "ja", withdrawn: false, ...patch });
const auth = (uid = "owner") => ({ uid, token: { role: "employee", auth_time: 1000 } });
let db: Database; let service: ReturnType<typeof createWeeklyTodoService>; let disabled: Set<string>; let translate: ReturnType<typeof vi.fn>; let sequence = 0; let reportTime: number;
const input = (items = [item()], version = 0, week = weekStart) => ({ weekStart: week, expectedVersion: version, operationId: `operation-${++sequence}`, items });
const record = (uid = "owner", week = weekStart, scope = "production") => db.rows.get(`weeklyTodoWeeks/${documentId(scope, uid, week)}`)!;
beforeEach(() => {
  db = new Database(); disabled = new Set(); sequence = 0; reportTime = Date.parse("2026-10-19T01:00:00Z");
  for (const [uid, role] of [["owner", "employee"], ["manager", "employee_manager"], ["president", "president_viewer"]]) db.rows.set(`users/${uid}`, { uid, displayName: uid, role, active: true });
  db.rows.set("users/demo", { uid: "demo", displayName: "demo", role: "employee", active: true, isDemo: true, demoDatasetId: "one" });
  db.rows.set("users/demo2", { uid: "demo2", displayName: "demo2", role: "employee", active: true, isDemo: true, demoDatasetId: "two" });
  translate = vi.fn(async (fields: Record<string, string>) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ? `译:${value}` : ""])));
  service = createWeeklyTodoService({ db: db as unknown as Firestore, getAccount: async uid => ({ disabled: disabled.has(uid) }), translate, now: () => reportTime + sequence, businessEnabled: () => true });
});
describe("company initiative to weekly To Do", () => {
  const initiativePath = "businessInitiatives/initiative-a";
  const addition = { weekStart, initiativeId: "initiative-a", expectedInitiativeVersion: 1, milestoneIds: ["step-a"] };
  const imported = (): TodoItem => record().draft.items.find((row: TodoItem) => row.businessLink)!;
  const complete = (items: TodoItem[], version: number, completeMilestone = true) => ({
    ...input(items, version), itemId: imported().id, action: "complete", completeMilestone, reportLocale: "ja"
  });
  const reports = () => [...db.rows].filter(([path]) => path.startsWith("businessUpdates/")).map(([, row]) => row);
  beforeEach(() => {
    db.rows.set("businessSettings/company", { enabled: true, memberIds: ["owner", "manager", "president"] });
    db.rows.set("businessThemes/theme-a", { scopeId: "company", archived: false });
    db.rows.set(initiativePath, {
      id: "initiative-a", scopeId: "company", themeId: "theme-a", name: "出店準備", sourceLocale: "ja", version: 1, assigneeIds: ["owner"], status: "in_progress", archived: false,
      milestones: [{ id: "step-a", name: "条件を確定", order: 0, archived: false, completed: false, updatedAt: 0, updatedBy: "owner" }]
    });
  });
  it("appends to the current owner's draft once and never publishes the plan on add", async () => {
    await service.saveWeeklyTodoDraft(auth(), input([item({ title: "PRIVATE DRAFT" })]));
    const first = await service.addBusinessMilestonesToWeeklyTodo(auth(), addition);
    const repeat = await service.addBusinessMilestonesToWeeklyTodo(auth(), addition);
    expect(first).toMatchObject({ addedCount: 1 });
    expect(repeat).toEqual({ addedCount: 0, itemIds: first.itemIds });
    expect(record().version).toBe(2);
    expect(record().draft.items[0].title).toBe("PRIVATE DRAFT");
    expect(imported()).toMatchObject({ id: first.itemIds[0], title: "条件を確定", goal: "条件を確定", businessLink: { initiativeId: "initiative-a", milestoneId: "step-a" } });
    expect((await service.getWeeklyTodoWorkspace(auth("president"), { weekStart })).weeks).toHaveLength(0);
    expect(db.rows.get(initiativePath)!.milestones[0].completed).toBe(false);
  });
  it("publishes one task and its initiative result together, safely retries, then records reopening", async () => {
    await service.shareWeeklyTodo(auth(), input([item({ title: "公開済みの計画" })]));
    await service.addBusinessMilestonesToWeeklyTodo(auth(), addition);
    const submission = complete([item({ title: "未共有の書き直し" }), { ...imported(), memo: "結果を確認した" }], 2);
    const result = await service.reportLinkedWeeklyTodoCompletion(auth(), submission);
    expect(await service.reportLinkedWeeklyTodoCompletion(auth(), submission)).toEqual(result);
    expect(record().shared.items.map((row: TodoItem) => row.title)).toEqual(["公開済みの計画", "条件を確定"]);
    expect(record().draft.items[0].title).toBe("未共有の書き直し");
    expect(imported()).toMatchObject({ progress: 100, businessCompletion: { milestoneChanged: true } });
    expect(db.rows.get(initiativePath)).toMatchObject({ status: "in_progress", milestones: [{ completed: true }], latestUpdate: { body: "結果を確認した" } });
    expect(reports()).toHaveLength(1);
    const priorId = reports()[0].id;
    await service.reportLinkedWeeklyTodoCompletion(auth(), { ...complete(record().draft.items, 3, false), action: "reopen" });
    expect(imported()).toMatchObject({ progress: 0 });
    expect(imported().businessCompletion).toBeUndefined();
    expect(db.rows.get(initiativePath)!.milestones[0].completed).toBe(false);
    expect(reports()).toHaveLength(2);
    expect(reports()[1].weeklyTodo).toMatchObject({ previousReportId: priorId, action: "reopen" });
    expect((await service.getWeeklyTodoHistory(auth("manager"), { weekStart, userId: "owner" })).history.map(row => row.snapshot.revision)).toEqual([3, 2, 1]);
  });
  it("reports a smaller weekly task without marking its parent goal complete", async () => {
    await service.addBusinessMilestonesToWeeklyTodo(auth(), addition);
    const narrower = { ...imported(), title: "条件案を送付", goal: "送付を済ませる", memo: "送付済み" };
    await expect(service.reportLinkedWeeklyTodoCompletion(auth(), complete([narrower], 1))).rejects.toMatchObject({ details: { reason: "linked-milestone-changed" } });
    expect(record().version).toBe(1);
    expect(reports()).toHaveLength(0);
    await service.reportLinkedWeeklyTodoCompletion(auth(), complete([narrower], 1, false));
    expect(imported().progress).toBe(100);
    expect(db.rows.get(initiativePath)!.milestones[0].completed).toBe(false);
    expect(reports()[0].body).toBe("送付済み");
  });
  it("does not undo a later manual change when the weekly completion is reopened", async () => {
    await service.addBusinessMilestonesToWeeklyTodo(auth(), addition);
    await service.reportLinkedWeeklyTodoCompletion(auth(), complete([imported()], 1));
    Object.assign(db.rows.get(initiativePath)!.milestones[0], { updatedBy: "manager", updatedAt: reportTime + 10 });
    await service.reportLinkedWeeklyTodoCompletion(auth(), { ...complete([imported()], 2, false), action: "reopen" });
    expect(db.rows.get(initiativePath)!.milestones[0].completed).toBe(true);
    expect(reports()[1].weeklyTodo.milestoneChanged).toBe(false);
  });
  it("retains the source link through selected carryover and avoids duplicate current-week imports", async () => {
    await service.addBusinessMilestonesToWeeklyTodo(auth(), addition);
    await service.shareWeeklyTodo(auth(), input([imported()], 1));
    reportTime += 7 * 86400000;
    const nextWeek = "2026-10-26";
    const { carryover } = await service.getWeeklyTodoWorkspace(auth(), { weekStart: nextWeek });
    const carried = { ...carryover[0], id: "carried-task" };
    await service.saveWeeklyTodoDraft(auth(), input([carried], 0, nextWeek));
    expect(await service.addBusinessMilestonesToWeeklyTodo(auth(), { ...addition, weekStart: nextWeek })).toEqual({ itemIds: [carried.id], addedCount: 0 });
    expect(record("owner", nextWeek).draft.items[0].businessLink).toEqual(imported().businessLink);
  });
  it("blocks forged links and writes after the initiative is archived or moved to another scope", async () => {
    await expect(service.addBusinessMilestonesToWeeklyTodo(auth("demo"), addition)).rejects.toMatchObject({ code: "permission-denied" });
    await service.addBusinessMilestonesToWeeklyTodo(auth(), addition);
    const linked = imported();
    await expect(service.saveWeeklyTodoDraft(auth("president"), input([linked]))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(service.saveWeeklyTodoDraft(auth(), input([{ ...linked, businessLink: undefined }], 1))).rejects.toMatchObject({ code: "invalid-argument" });
    db.rows.get(initiativePath)!.archived = true;
    await expect(service.reportLinkedWeeklyTodoCompletion(auth(), complete([linked], 1))).rejects.toMatchObject({ code: "failed-precondition" });
    db.rows.get(initiativePath)!.archived = false;
    db.rows.get(initiativePath)!.scopeId = "other-scope";
    await expect(service.reportLinkedWeeklyTodoCompletion(auth(), complete([linked], 1))).rejects.toMatchObject({ code: "not-found" });
    expect(reports()).toHaveLength(0);
    expect(record().version).toBe(1);
  });
  it("filters linked work and translations when a shared viewer loses initiative access", async () => {
    await service.addBusinessMilestonesToWeeklyTodo(auth(), addition);
    await service.shareWeeklyTodo(auth(), input([item(), imported()], 1));
    const translated = { weekStart, userId: "owner", revision: 1, contentVersion: record().shared.contentVersion, targetLocale: "zh-CN" };
    expect(JSON.stringify(await service.translateWeeklyTodoContent(auth("manager"), translated))).toContain("条件を確定");
    db.rows.get("businessSettings/company")!.memberIds = ["owner", "president"];
    for (const value of [
      await service.getWeeklyTodoWorkspace(auth("manager"), { weekStart }),
      await service.getWeeklyTodoHistory(auth("manager"), { weekStart, userId: "owner" }),
      await service.translateWeeklyTodoContent(auth("manager"), translated)
    ]) {
      expect(JSON.stringify(value)).toContain("比較表を作成");
      expect(JSON.stringify(value)).not.toMatch(/出店準備|条件を確定/);
    }
  });
});
describe("week boundaries", () => {
  it("handles a year boundary and leap year", () => { expect(weekDates("2025-12-29")).toEqual({ weekStart: "2025-12-29", targetDate: "2026-01-02", weekEnd: "2026-01-04" }); expect(weekDates("2024-02-26").targetDate).toBe("2024-03-01"); });
  it.each(["2026-10-20", "2026-02-30", "garbage", "2026-13-01"])("rejects invalid start %s", value => expect(() => weekDates(value)).toThrow());
});
describe("privacy and authorization", () => {
  it.each(["owner", "manager", "president"])("returns %s's draft only to its owner", async owner => {
    await service.saveWeeklyTodoDraft(auth(owner), input([item({ title: "private draft" })]));
    expect((await service.getWeeklyTodoWorkspace(auth(owner), { weekStart })).ownDraft?.items[0].title).toBe("private draft");
    for (const uid of ["owner", "manager", "president"].filter(uid => uid !== owner)) { const response = await service.getWeeklyTodoWorkspace(auth(uid), { weekStart }); expect(JSON.stringify(response)).not.toContain("private draft"); expect(response.weeks).toHaveLength(0); }
  });
  it("does not leak a newly edited draft after publication", async () => {
    await service.shareWeeklyTodo(auth(), input()); await service.saveWeeklyTodoDraft(auth(), input([item({ title: "PRIVATE newer" })], 1));
    const result = await service.getWeeklyTodoWorkspace(auth("manager"), { weekStart });
    expect(result.weeks[0].shared.items[0].title).toBe("比較表を作成"); expect(JSON.stringify(result)).not.toContain("PRIVATE newer");
  });
  it.each(["owner", "manager", "president"])("rejects foreign userId for every %s mutation", async uid => {
    for (const method of [service.saveWeeklyTodoDraft, service.shareWeeklyTodo, service.shareWeeklyTodoReview]) {
      await expect(method(auth(uid), { ...input([item({ memo: "実績" })]), userId: uid === "owner" ? "president" : "owner" })).rejects.toThrow();
    }
    expect(db.rows.size).toBe(5);
  });
  it.each(["owner", "president"])("rejects missing, disabled, inactive, stale-login and password-change accounts for %s", async uid => {
    await expect(service.getWeeklyTodoWorkspace(undefined, { weekStart })).rejects.toMatchObject({ code: "unauthenticated" });
    disabled.add(uid); await expect(service.shareWeeklyTodo(auth(uid), input())).rejects.toMatchObject({ code: "permission-denied" }); disabled.clear();
    const profile = db.rows.get(`users/${uid}`)!;
    profile.active = false; await expect(service.shareWeeklyTodo(auth(uid), input())).rejects.toMatchObject({ code: "permission-denied" }); profile.active = true;
    profile.passwordChangeRequired = true; await expect(service.shareWeeklyTodo(auth(uid), input())).rejects.toMatchObject({ code: "failed-precondition" }); profile.passwordChangeRequired = false;
    profile.passwordAuthTimeAfter = 1000; await expect(service.shareWeeklyTodo(auth(uid), input())).rejects.toMatchObject({ code: "failed-precondition" });
  });
  it("separates production and individual demo datasets across every read API", async () => {
    await service.shareWeeklyTodo(auth(), input()); await service.shareWeeklyTodo(auth("demo"), input([item({ title: "DEMO ONLY" })]));
    const real = await service.getWeeklyTodoWorkspace(auth("president"), { weekStart }); expect(real.members).toHaveLength(3); expect(JSON.stringify(real)).not.toContain("DEMO ONLY");
    const demo = await service.getWeeklyTodoWorkspace(auth("demo"), { weekStart }); expect(demo.members.map(m => m.uid)).toEqual(["demo"]); expect(demo.weeks).toHaveLength(1);
    await expect(service.getWeeklyTodoHistory(auth("demo2"), { userId: "demo", weekStart })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(service.translateWeeklyTodoContent(auth("demo2"), { userId: "demo", weekStart, revision: 1, contentVersion: record("demo", weekStart, "demo:one").shared.contentVersion, targetLocale: "zh-CN" })).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("keeps a demo president's writes in its own dataset", async () => {
    db.rows.get("users/demo")!.role = "president_viewer";
    await service.shareWeeklyTodo(auth("demo"), input([item({ title: "DEMO PRESIDENT" })]));
    expect(record("demo", weekStart, "demo:one").userId).toBe("demo");
    expect(record("demo")).toBeUndefined();
    for (const uid of ["owner", "president", "demo2"]) expect(JSON.stringify(await service.getWeeklyTodoWorkspace(auth(uid), { weekStart }))).not.toContain("DEMO PRESIDENT");
  });
});
describe("sharing, reflection and concurrency", () => {
  it("lets the president share only its own goals, progress and reflection while preserving private edits and history", async () => {
    await service.shareWeeklyTodo(auth(), input([item({ title: "employee plan" })]));
    const employeeBefore = structuredClone(record());
    await service.shareWeeklyTodo(auth("president"), input());
    await service.saveWeeklyTodoDraft(auth("president"), input([item({ goal: "PRIVATE changed goal", progress: 50 })], 1));
    for (const uid of ["owner", "manager"]) {
      const response = await service.getWeeklyTodoWorkspace(auth(uid), { weekStart });
      expect(response.weeks.find(row => row.userId === "president")?.shared.items[0].goal).toBe("金曜までに初稿を完成");
      expect(JSON.stringify(response)).not.toContain("PRIVATE changed goal");
    }
    await service.shareWeeklyTodoReview(auth("president"), input([item({ goal: "変更後の目標", progress: 50, memo: "初稿の半分" })], 2));
    await service.shareWeeklyTodo(auth("president"), input([item({ goal: "変更後の目標", progress: 100, memo: "完了" })], 3));
    const response = await service.getWeeklyTodoWorkspace(auth(), { weekStart });
    const row = response.weeks.find(row => row.userId === "president")!;
    expect(row.initial.items[0].goal).toBe("金曜までに初稿を完成");
    expect(row.review.items[0]).toMatchObject({ progress: 50, memo: "初稿の半分" });
    expect(row.shared.items[0].progress).toBe(100); expect(row.reviewRevision).not.toBe(row.shared.revision);
    const history = await service.getWeeklyTodoHistory(auth("manager"), { userId: "president", weekStart });
    expect(history.history.map(row => row.snapshot.revision)).toEqual([3, 2, 1]);
    expect(JSON.stringify(history)).not.toContain("PRIVATE changed goal"); expect(record()).toEqual(employeeBefore);
  });
  it("keeps initial goals and all shared revisions while allowing draft saves without history", async () => {
    await service.shareWeeklyTodo(auth(), input()); await service.saveWeeklyTodoDraft(auth(), input([item({ goal: "new goal" })], 1)); await service.shareWeeklyTodo(auth(), input([item({ goal: "new goal" })], 2));
    expect(record().initial.items[0].goal).toBe("金曜までに初稿を完成"); expect(record().shared.items[0].goal).toBe("new goal");
    const history = await service.getWeeklyTodoHistory(auth("president"), { userId: "owner", weekStart }); expect(history.history.map(row => row.snapshot.revision)).toEqual([2, 1]);
  });
  it("requires meaningful share fields, valid percentages, unique IDs and reflection memos", async () => {
    for (const rows of [[], [item({ title: "" })], [item({ goal: "" })], [item({ progress: 101 })], [item(), item()]]) await expect(service.shareWeeklyTodo(auth(), input(rows))).rejects.toThrow();
    await expect(service.shareWeeklyTodoReview(auth(), input())).rejects.toMatchObject({ code: "invalid-argument" });
    await service.shareWeeklyTodoReview(auth(), input([item({ progress: 0, memo: "未着手、翌週へ" })])); expect(record().reviewRevision).toBe(1);
  });
  it("preserves the reflection snapshot and flags subsequent shared updates", async () => {
    await service.shareWeeklyTodoReview(auth(), input([item({ progress: 50, memo: "初稿の半分" })]));
    await service.shareWeeklyTodo(auth(), input([item({ progress: 100, memo: "完了" })], 1));
    expect(record().review.items[0].progress).toBe(50); expect(record().shared.revision).not.toBe(record().reviewRevision);
    await service.shareWeeklyTodoReview(auth(), input([item({ progress: 100, memo: "完了" })], 2)); expect(record().shared.revision).toBe(record().reviewRevision);
  });
  it("does not invalidate a reflection or add history when unchanged content is shared", async () => {
    const content = [item({ progress: 100, memo: "完了" })];
    await service.shareWeeklyTodoReview(auth(), input(content));
    await service.shareWeeklyTodo(auth(), input(content, 1));
    expect(record().version).toBe(2); expect(record().shared.revision).toBe(record().reviewRevision);
    expect((await service.getWeeklyTodoHistory(auth("president"), { userId: "owner", weekStart })).history).toHaveLength(1);
  });
  it("requires withdrawal instead of deleting an already shared item", async () => {
    await service.shareWeeklyTodo(auth(), input()); await expect(service.saveWeeklyTodoDraft(auth(), input([], 1))).rejects.toMatchObject({ code: "invalid-argument" });
    await service.shareWeeklyTodo(auth(), input([item({ withdrawn: true, memo: "優先順位の変更" })], 1)); expect(record().initial.items[0].withdrawn).toBe(false); expect(record().shared.items[0].withdrawn).toBe(true);
  });
  it.each(["owner", "president"])("allows only one concurrent writer for %s and makes a repeated operation idempotent", async uid => {
    const first = input(); const results = await Promise.allSettled([service.shareWeeklyTodo(auth(uid), first), service.shareWeeklyTodo(auth(uid), input([item({ title: "other tab" })]))]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1); expect(record(uid).version).toBe(1);
    expect(await service.shareWeeklyTodo(auth(uid), first)).toEqual({ version: 1 }); expect(record(uid).shared.revision).toBe(1);
    await expect(service.shareWeeklyTodo(auth(uid), { ...first, items: [item({ title: "different payload" })] })).rejects.toMatchObject({ code: "aborted" });
  });
  it("paginates shared history without exposing private drafts", async () => {
    for (let version = 0; version < 12; version++) await service.shareWeeklyTodo(auth(), input([item({ progress: version })], version));
    const page = await service.getWeeklyTodoHistory(auth("president"), { userId: "owner", weekStart }); expect(page.history).toHaveLength(10); expect(page.cursor).toBe("2");
    expect((await service.getWeeklyTodoHistory(auth("president"), { userId: "owner", weekStart, cursor: page.cursor! })).history.map(row => row.snapshot.revision)).toEqual([2, 1]);
  });
});
describe("selected carryover", () => {
  it.each(["owner", "president"])("offers only %s's previous unfinished active shared items", async uid => {
    await service.shareWeeklyTodo(auth(uid), input([item(), item({ id: "done", progress: 100 }), item({ id: "withdrawn", withdrawn: true })], 0, "2026-10-12"));
    const result = await service.getWeeklyTodoWorkspace(auth(uid), { weekStart }); expect(result.carryover.map(row => row.id)).toEqual(["task-a"]);
    const copied = item({ id: "copied", carriedFrom: { weekStart: "2026-10-12", itemId: "task-a" } });
    await service.saveWeeklyTodoDraft(auth(uid), input([copied])); expect(record(uid).draft.items[0].carriedFrom.itemId).toBe("task-a");
    expect((await service.getWeeklyTodoWorkspace(auth(uid), { weekStart })).carryover).toEqual([]);
    await expect(service.saveWeeklyTodoDraft(auth(uid), input([copied, { ...copied, id: "duplicate" }], 1))).rejects.toMatchObject({ code: "invalid-argument" });
  });
  it("rejects fabricated or private carryover sources and altered origins", async () => {
    await service.saveWeeklyTodoDraft(auth(), input([item()], 0, "2026-10-12"));
    await expect(service.saveWeeklyTodoDraft(auth(), input([item({ id: "copy", carriedFrom: { weekStart: "2026-10-12", itemId: "task-a" } })]))).rejects.toMatchObject({ code: "invalid-argument" });
    await service.shareWeeklyTodo(auth(), input([item()], 1, "2026-10-12"));
    const copied = item({ id: "copy", carriedFrom: { weekStart: "2026-10-12", itemId: "task-a" } }); await service.saveWeeklyTodoDraft(auth(), input([copied]));
    await expect(service.saveWeeklyTodoDraft(auth(), input([{ ...copied, carriedFrom: undefined }], 1))).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
describe("automatic translation", () => {
  const request = () => ({ weekStart, userId: "owner", contentVersion: record().shared.contentVersion, revision: record().shared.revision, targetLocale: "zh-CN" });
  it("caches by content version, language and account while retaining original text", async () => {
    await service.shareWeeklyTodo(auth(), input()); const response = await service.translateWeeklyTodoContent(auth("manager"), request());
    expect(response.fields["task-a:title"]).toBe("译:比較表を作成"); await service.translateWeeklyTodoContent(auth("manager"), request()); expect(translate).toHaveBeenCalledTimes(1);
    expect(record().shared.items[0].title).toBe("比較表を作成");
  });
  it("keeps saves intact when translation fails or returns invalid fields", async () => {
    await service.shareWeeklyTodo(auth(), input()); translate.mockRejectedValueOnce(Error("provider response must stay private"));
    await expect(service.translateWeeklyTodoContent(auth("manager"), request())).rejects.toMatchObject({ code: "unavailable" }); expect(record().version).toBe(1);
    translate.mockResolvedValueOnce({ unrelated: "text" }); await expect(service.translateWeeklyTodoContent(auth("manager"), request())).rejects.toMatchObject({ code: "unavailable" });
  });
  it("rechecks account access after the translation finishes", async () => {
    await service.shareWeeklyTodo(auth(), input());
    translate.mockImplementationOnce(async (fields: Record<string, string>) => { db.rows.get("users/manager")!.active = false; return fields; });
    await expect(service.translateWeeklyTodoContent(auth("manager"), request())).rejects.toMatchObject({ code: "permission-denied" });
    expect([...db.rows.keys()].some(path => path.startsWith("weeklyTodoTranslations/"))).toBe(false);
  });
  it("rejects unknown content hashes and inactive subjects", async () => {
    await service.shareWeeklyTodo(auth(), input()); await expect(service.translateWeeklyTodoContent(auth("manager"), { ...request(), contentVersion: digest("missing") })).rejects.toMatchObject({ code: "aborted" });
    db.rows.get("users/owner")!.active = false; await expect(service.translateWeeklyTodoContent(auth("manager"), request())).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("translates an immutable older shared revision but never a private draft", async () => {
    await service.shareWeeklyTodo(auth(), input());
    await service.shareWeeklyTodo(auth(), input([item({ title: "second" })], 1)); const previous = request();
    await service.shareWeeklyTodo(auth(), input([item({ title: "third" })], 2));
    expect((await service.translateWeeklyTodoContent(auth("manager"), previous)).fields["task-a:title"]).toBe("译:second");
    await service.saveWeeklyTodoDraft(auth(), input([item({ title: "PRIVATE" })], 3));
    await expect(service.translateWeeklyTodoContent(auth("manager"), { ...request(), contentVersion: digest(record().draft.items) })).rejects.toMatchObject({ code: "aborted" });
  });
  it("does not serve cached translations after the requesting account is disabled", async () => {
    await service.shareWeeklyTodo(auth(), input()); await service.translateWeeklyTodoContent(auth("manager"), request()); disabled.add("manager");
    await expect(service.translateWeeklyTodoContent(auth("manager"), request())).rejects.toMatchObject({ code: "permission-denied" }); expect(translate).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid demo metadata", () => expect(() => scopeOf({ isDemo: true })).toThrow());
});

describe("add weekly progress to today's work memos", () => {
  const request = (expectedVersion = 1, itemId = "task-a", reportDate = weekStart) => ({ weekStart, itemId, expectedVersion, reportDate });
  const logs = () => [...db.rows].filter(([path]) => path.startsWith("workLogs/"));
  it("offers an action after a saved progress or content change, and keeps it private", async () => {
    await service.saveWeeklyTodoDraft(auth(), input());
    expect((await service.getWeeklyTodoWorkspace(auth(), { weekStart })).reportLink?.items).toEqual([]);
    await service.saveWeeklyTodoDraft(auth(), input([item({ goal: "目標に詳細を追記" })], 1));
    expect((await service.getWeeklyTodoWorkspace(auth(), { weekStart })).reportLink).toEqual({ reportDate: weekStart, items: [{ itemId: "task-a", added: false }] });
    expect((await service.getWeeklyTodoWorkspace(auth("manager"), { weekStart })).reportLink?.items).toEqual([]);
    expect((await service.getWeeklyTodoWorkspace(auth("president"), { weekStart })).reportLink).toBeNull();
  });
  it.each(["owner", "manager"])("adds %s's own memo without altering shared To Dos or a submitted report", async uid => {
    db.rows.set("workLogs/manual", { userId: uid, workDate: weekStart, text: "既存の手入力", attachments: ["keep"] });
    db.rows.set("dailyReports/submitted", { userId: uid, reportDate: weekStart, status: "submitted", activities: "既存の本文", revision: 3 });
    await service.saveWeeklyTodoDraft(auth(uid), input([item({ progress: 50, memo: "初稿の半分を確認" })]));
    const before = structuredClone(record(uid));
    expect(await service.addWeeklyTodoToDailyReport(auth(uid), request())).toMatchObject({ reportDate: weekStart, addedCount: 1, alreadyAdded: false });
    expect(record(uid)).toEqual(before);
    expect(db.rows.get("dailyReports/submitted")).toMatchObject({ activities: "既存の本文", revision: 3 });
    expect(db.rows.get("workLogs/manual")).toMatchObject({ text: "既存の手入力", attachments: ["keep"] });
    expect(logs().find(([path]) => path !== "workLogs/manual")?.[1]).toMatchObject({ userId: uid, workDate: weekStart, tagLabel: "今週のTo Do", text: expect.stringContaining("今週の進捗：50％") });
    expect((await service.getWeeklyTodoWorkspace(auth(uid), { weekStart })).reportLink?.items).toEqual([{ itemId: "task-a", added: true }]);
  });
  it("deduplicates concurrent clicks and retries without overwriting a manually edited memo", async () => {
    await service.saveWeeklyTodoDraft(auth(), input([item({ progress: 50 })]));
    const results = await Promise.all([service.addWeeklyTodoToDailyReport(auth(), request()), service.addWeeklyTodoToDailyReport(auth(), request())]);
    expect(results.map(row => row.addedCount).sort()).toEqual([0, 1]); expect(logs()).toHaveLength(1);
    const [path, log] = logs()[0]; db.rows.set(path, { ...log, text: "日報で修正した内容", attachments: ["manual attachment"] });
    expect(await service.addWeeklyTodoToDailyReport(auth(), request())).toMatchObject({ alreadyAdded: true, addedCount: 0 });
    expect(db.rows.get(path)).toMatchObject({ text: "日報で修正した内容", attachments: ["manual attachment"] });
  });
  it("allows another update or day, while a previously added identical update remains deduplicated", async () => {
    await service.saveWeeklyTodoDraft(auth(), input([item({ progress: 50 })]));
    await service.addWeeklyTodoToDailyReport(auth(), request());
    await service.saveWeeklyTodoDraft(auth(), input([item({ progress: 100, memo: "完了" })], 1));
    expect((await service.getWeeklyTodoWorkspace(auth(), { weekStart })).reportLink?.items[0].added).toBe(false);
    await service.addWeeklyTodoToDailyReport(auth(), request(2)); expect(logs()).toHaveLength(2);
    await service.saveWeeklyTodoDraft(auth(), input([item({ progress: 50 })], 2));
    expect(await service.addWeeklyTodoToDailyReport(auth(), request(3))).toMatchObject({ alreadyAdded: true }); expect(logs()).toHaveLength(2);
    reportTime = Date.parse("2026-10-19T15:00:00Z");
    await expect(service.addWeeklyTodoToDailyReport(auth(), request(3))).rejects.toMatchObject({ code: "failed-precondition", details: { reason: "report-date-changed" } });
    expect((await service.getWeeklyTodoWorkspace(auth(), { weekStart })).reportLink).toEqual({ reportDate: "2026-10-20", items: [{ itemId: "task-a", added: false }] });
    await service.addWeeklyTodoToDailyReport(auth(), request(3, "task-a", "2026-10-20")); expect(logs()).toHaveLength(3);
  });
  it("rejects stale versions, foreign owners, unknown items, withdrawals, planning only and other weeks", async () => {
    await service.saveWeeklyTodoDraft(auth(), input());
    await expect(service.addWeeklyTodoToDailyReport(auth(), request())).rejects.toMatchObject({ code: "invalid-argument" });
    await service.saveWeeklyTodoDraft(auth(), input([item({ progress: 50, withdrawn: true })], 1));
    await expect(service.addWeeklyTodoToDailyReport(auth(), request(2))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(service.addWeeklyTodoToDailyReport(auth(), request(2, "unknown"))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(service.addWeeklyTodoToDailyReport(auth(), request(1))).rejects.toMatchObject({ code: "aborted" });
    await expect(service.addWeeklyTodoToDailyReport(auth("manager"), request(2))).rejects.toMatchObject({ code: "aborted" });
    await expect(service.addWeeklyTodoToDailyReport(auth(), { ...request(2), userId: "manager" })).rejects.toThrow();
    await expect(service.addWeeklyTodoToDailyReport(auth(), { ...request(2), weekStart: "2026-10-12" })).rejects.toMatchObject({ code: "failed-precondition", details: { reason: "report-week-not-current" } });
    expect(logs()).toHaveLength(0);
  });
  it("retains daily report permissions and account gates", async () => {
    for (const uid of ["owner", "president"]) await service.saveWeeklyTodoDraft(auth(uid), input([item({ progress: 50 })]));
    await expect(service.addWeeklyTodoToDailyReport(auth("president"), request())).rejects.toMatchObject({ code: "permission-denied" });
    await expect(service.addWeeklyTodoToDailyReport(undefined, request())).rejects.toMatchObject({ code: "unauthenticated" });
    disabled.add("owner"); await expect(service.addWeeklyTodoToDailyReport(auth(), request())).rejects.toMatchObject({ code: "permission-denied" }); disabled.clear();
    const profile = db.rows.get("users/owner")!;
    profile.passwordAuthTimeAfter = 1000; await expect(service.addWeeklyTodoToDailyReport(auth(), request())).rejects.toMatchObject({ code: "failed-precondition" }); delete profile.passwordAuthTimeAfter;
    profile.active = false; await expect(service.addWeeklyTodoToDailyReport(auth(), request())).rejects.toMatchObject({ code: "permission-denied" }); expect(logs()).toHaveLength(0);
  });
  it("isolates demo additions and preserves all chunks of long notes", async () => {
    db.rows.get("users/demo")!.seedVersion = "fixture-v1";
    await service.saveWeeklyTodoDraft(auth("demo"), input([item({ memo: "長い実績🙂".repeat(650), goal: "目標".repeat(900) })]));
    const result = await service.addWeeklyTodoToDailyReport(auth("demo"), request());
    expect(result.addedCount).toBeGreaterThan(1);
    for (const [, log] of logs()) expect(log).toMatchObject({ userId: "demo", isDemo: true, demoDatasetId: "one", seedVersion: "fixture-v1", workDate: weekStart });
    expect((await service.getWeeklyTodoWorkspace(auth("demo"), { weekStart })).reportLink?.items[0].added).toBe(true);
    expect((await service.getWeeklyTodoWorkspace(auth(), { weekStart })).reportLink?.items).toEqual([]);
    expect(await service.addWeeklyTodoToDailyReport(auth("demo"), request())).toMatchObject({ alreadyAdded: true, addedCount: 0 });
  });
});
