import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { createWeeklyTodoService } from "./service.js";
import { digest, documentId, scopeOf, weekDates, type Row, type TodoItem } from "./domain.js";
import { createWeeklyTodoCarryover, currentTodoWeek } from "./carryover.js";

class Database {
  rows = new Map<string, Row>(); queue: Promise<unknown> = Promise.resolve();
  doc(path: string): any { return { id: path.split("/").at(-1), path, get: async () => this.snapshot(path), set: async (value: Row) => { this.rows.set(path, structuredClone(value)); } }; }
  snapshot(path: string) { const value = this.rows.get(path); return { id: path.split("/").at(-1), exists: Boolean(value), data: () => value ? structuredClone(value) : undefined }; }
  collection(name: string): any { return { where: (field: string, _op: string, expected: unknown) => ({ get: async () => ({ docs: [...this.rows].filter(([path, value]) => path.startsWith(name + "/") && value[field] === expected).map(([path]) => this.snapshot(path)) }) }) }; }
  runTransaction(callback: (tx: any) => Promise<any>) {
    const operation = this.queue.then(async () => {
      const changes: [string, Row][] = [];
      const result = await callback({ get: async (ref: any) => { if (changes.length) throw Error("Read after write"); return ref.path ? this.snapshot(ref.path) : ref.get(); }, set: (ref: any, row: Row) => changes.push([ref.path, row]), create: (ref: any, row: Row) => { if (this.rows.has(ref.path)) throw Error("Already exists"); changes.push([ref.path, row]); } });
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
  service = createWeeklyTodoService({ db: db as unknown as Firestore, getAccount: async uid => ({ disabled: disabled.has(uid) }), translate, now: () => reportTime + sequence });
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
  beforeEach(() => { reportTime = Date.parse("2026-10-12T01:00:00Z"); });
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
describe("automatic weekly carryover", () => {
  const rollover = () => createWeeklyTodoCarryover({ db: db as unknown as Firestore, getAccount: async uid => ({ disabled: disabled.has(uid) }), now: () => reportTime });
  const previous = "2026-10-12";
  it.each(["owner", "manager", "president"])("automatically carries %s's latest saved unfinished items without sharing or rewriting the previous week", async uid => {
    await service.shareWeeklyTodo(auth(uid), input([item(), item({ id: "finished", progress: 100 }), item({ id: "cancelled", withdrawn: true })], 0, previous));
    await service.saveWeeklyTodoDraft(auth(uid), input([item({ progress: 75, memo: "PRIVATE 実績", memoLocale: "zh-CN" }), item({ id: "finished", progress: 100 }), item({ id: "cancelled", withdrawn: true }), item({ id: "private", title: "PRIVATE draft-only" })], 1, previous));
    const original = structuredClone(record(uid, previous));
    const response = await service.getWeeklyTodoWorkspace(auth(uid), { weekStart });
    expect(response.ownDraft.items).toHaveLength(2); expect(response.ownDraft.version).toBe(1);
    expect(response.ownDraft.items[0]).toMatchObject({ progress: 75, memo: "PRIVATE 実績", memoLocale: "zh-CN", carriedFrom: { weekStart: previous, itemId: "task-a" } });
    expect(record(uid).shared).toBeUndefined(); expect(record(uid, previous)).toEqual(original);
    const other = await service.getWeeklyTodoWorkspace(auth(uid === "owner" ? "manager" : "owner"), { weekStart });
    expect(JSON.stringify(other)).not.toContain("PRIVATE");
    await service.shareWeeklyTodo(auth(uid), input(response.ownDraft.items, 1));
    expect(record(uid).shared.items).toEqual(response.ownDraft.items);
  });
  it("honors privately completed, withdrawn, or deleted tasks and an explicitly empty draft", async () => {
    await service.shareWeeklyTodo(auth(), input([item()], 0, previous));
    await service.saveWeeklyTodoDraft(auth(), input([item({ progress: 100 })], 1, previous));
    await rollover().ensure("owner"); expect(record()).toBeUndefined();
    await service.saveWeeklyTodoDraft(auth(), input([item({ withdrawn: true })], 2, previous));
    await rollover().ensure("owner"); expect(record()).toBeUndefined();
    await service.saveWeeklyTodoDraft(auth("manager"), input([item()], 0, previous));
    await service.saveWeeklyTodoDraft(auth("manager"), input([], 1, previous));
    await rollover().ensure("manager"); expect(record("manager")).toBeUndefined();
  });
  it("merges with existing current plans and preserves their shared goals, review and history", async () => {
    await service.saveWeeklyTodoDraft(auth(), input([item({ title: "previous private" })], 0, previous));
    await service.shareWeeklyTodoReview(auth(), input([item({ memo: "current review" })]));
    const before = structuredClone(record());
    await rollover().ensure("owner");
    expect(record().draft.items).toHaveLength(2); expect(record().draft.items[0]).toEqual(before.draft.items[0]);
    for (const key of ["shared", "initial", "review", "reviewRevision", "lastOperationId"]) expect(record()[key]).toEqual(before[key]);
    expect((await service.getWeeklyTodoHistory(auth("president"), { userId: "owner", weekStart })).history).toHaveLength(1);
  });
  it("is idempotent under concurrent loads and retries, and rejects a stale writer", async () => {
    await service.saveWeeklyTodoDraft(auth(), input([item()], 0, previous));
    await Promise.all([rollover().ensure("owner"), rollover().ensure("owner"), service.getWeeklyTodoWorkspace(auth(), { weekStart })]);
    const after = structuredClone(record()); expect(after.version).toBe(1); expect(after.draft.items).toHaveLength(1);
    await rollover().ensure("owner"); expect(record()).toEqual(after);
    await expect(service.saveWeeklyTodoDraft(auth(), input([item()]))).rejects.toMatchObject({ code: "aborted" });
    await service.saveWeeklyTodoDraft(auth(), input([], 1));
    await rollover().ensure("owner"); expect(record().draft.items).toEqual([]);
  });
  it("recognizes an earlier manual carryover without adding it twice", async () => {
    await service.shareWeeklyTodo(auth(), input([item()], 0, previous));
    await service.saveWeeklyTodoDraft(auth(), input([item({ id: "manual", carriedFrom: { weekStart: previous, itemId: "task-a" } })]));
    const before = structuredClone(record()); await rollover().ensure("owner"); expect(record()).toEqual(before);
  });
  it("can edit carried items after Firestore reorders map keys and keeps pending retries idempotent", async () => {
    await service.saveWeeklyTodoDraft(auth(), input([item()], 0, previous));
    await rollover().ensure("owner");
    const carried = record().draft.items[0]; carried.carriedFrom = { itemId: "task-a", weekStart: previous };
    await service.shareWeeklyTodo(auth(), input([{ ...carried, progress: 50 }], record().version));
    await rollover().ensure("owner"); expect(record().draft.items).toHaveLength(1);
    await service.saveWeeklyTodoDraft(auth("manager"), input([item()], 0, previous));
    await service.saveWeeklyTodoDraft(auth("manager"), input(Array.from({ length: 30 }, (_, i) => item({ id: `full-${i}` }))));
    await rollover().ensure("manager");
    record("manager").carryoverPending = [{ itemId: "task-a", weekStart: previous }];
    const before = structuredClone(record("manager")); await rollover().ensure("manager"); expect(record("manager")).toEqual(before);
  });
  it("does not change past or future weeks and catches up after multiple weeks away", async () => {
    await service.saveWeeklyTodoDraft(auth(), input([item({ progress: 60 })], 0, "2026-09-28"));
    const original = structuredClone([...db.rows]);
    await rollover().ensure("owner", previous); await rollover().ensure("owner", "2026-10-26");
    expect([...db.rows]).toEqual(original);
    await rollover().ensure("owner");
    expect(record().draft.items[0]).toMatchObject({ progress: 60, carriedFrom: { weekStart: "2026-09-28", itemId: "task-a" } });
    reportTime = Date.parse("2026-10-25T15:00:00Z"); await rollover().ensure("owner");
    expect(record("owner", "2026-10-26").draft.items[0].carriedFrom.weekStart).toBe(weekStart);
  });
  it("uses the JST Monday boundary including the end of the year", async () => {
    expect(currentTodoWeek(Date.parse("2026-10-18T14:59:59.999Z"))).toBe(previous);
    expect(currentTodoWeek(Date.parse("2026-10-18T15:00:00Z"))).toBe(weekStart);
    await service.saveWeeklyTodoDraft(auth(), input([item()], 0, "2025-12-22"));
    reportTime = Date.parse("2026-01-01T00:00:00Z"); await rollover().ensure("owner");
    expect(record("owner", "2025-12-29").draft.items[0].carriedFrom.weekStart).toBe("2025-12-22");
  });
  it("queues overflow without losing work and adds it automatically when space is saved", async () => {
    await service.saveWeeklyTodoDraft(auth(), input([item({ progress: 80 })], 0, previous));
    const full = Array.from({ length: 30 }, (_, index) => item({ id: `current-${index}` }));
    await service.saveWeeklyTodoDraft(auth(), input(full)); await rollover().ensure("owner");
    expect(record().draft.items).toEqual(full); expect(record().carryoverPending).toEqual([{ weekStart: previous, itemId: "task-a" }]);
    const version = record().version; await rollover().ensure("owner"); expect(record().version).toBe(version);
    await service.saveWeeklyTodoDraft(auth(), input(full.slice(1), version));
    const response = await service.getWeeklyTodoWorkspace(auth(), { weekStart });
    expect(response.carryoverPending).toEqual([]); expect(response.ownDraft.items).toHaveLength(30);
    expect(response.ownDraft.items.at(-1)).toMatchObject({ progress: 80 });
  });
  it("rechecks queued sources for completion and carries pending work across another week", async () => {
    await service.saveWeeklyTodoDraft(auth(), input([item(), item({ id: "second" })], 0, previous));
    const full = Array.from({ length: 30 }, (_, index) => item({ id: `full-${index}` }));
    await service.saveWeeklyTodoDraft(auth(), input(full)); await rollover().ensure("owner");
    await service.saveWeeklyTodoDraft(auth(), input([item({ progress: 100 }), item({ id: "second" })], 1, previous));
    await rollover().ensure("owner"); expect(record().carryoverPending).toEqual([{ weekStart: previous, itemId: "second" }]);
    await service.saveWeeklyTodoDraft(auth(), input(full.map(item => ({ ...item, progress: 100 })), record().version));
    reportTime = Date.parse("2026-10-26T00:00:00Z"); await rollover().ensure("owner");
    expect(record("owner", "2026-10-26").draft.items).toHaveLength(1);
    expect(record("owner", "2026-10-26").draft.items[0].carriedFrom).toEqual({ weekStart: previous, itemId: "second" });
  });
  it("respects the UTF-8 content limit and keeps oversized additions pending", async () => {
    const large = Array.from({ length: 10 }, (_, i) => item({ id: `large-${i}`, memo: "あ".repeat(3800) }));
    await service.saveWeeklyTodoDraft(auth(), input([item({ memo: "い".repeat(3800) })], 0, previous));
    await service.saveWeeklyTodoDraft(auth(), input(large)); await rollover().ensure("owner");
    expect(record().draft.items).toHaveLength(10); expect(record().carryoverPending).toHaveLength(1);
  });
  it("runs for all eligible roles while keeping disabled, inactive and demo accounts separate", async () => {
    for (const uid of ["owner", "manager", "president", "demo", "demo2"]) await service.saveWeeklyTodoDraft(auth(uid), input([item({ title: uid })], 0, previous));
    disabled.add("manager"); db.rows.get("users/demo2")!.active = false;
    await rollover().runAll();
    for (const uid of ["owner", "president"]) expect(record(uid).draft.items[0].title).toBe(uid);
    expect(record("manager")).toBeUndefined(); expect(record("demo2", weekStart, "demo:two")).toBeUndefined();
    expect(record("demo", weekStart, "demo:one").draft.items[0].title).toBe("demo"); expect(record("demo")).toBeUndefined();
  });
  it("finishes other accounts before reporting a retryable scheduled-job failure", async () => {
    for (const uid of ["owner", "president"]) await service.saveWeeklyTodoDraft(auth(uid), input([item()], 0, previous));
    const job = createWeeklyTodoCarryover({ db: db as unknown as Firestore, now: () => reportTime, getAccount: async uid => { if (uid === "owner") throw Error("temporary failure"); return { disabled: false }; } });
    await expect(job.runAll()).rejects.toThrow("1 account(s)"); expect(record("president").draft.items).toHaveLength(1);
    await rollover().runAll(); expect(record().draft.items).toHaveLength(1); expect(record("president").version).toBe(1);
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
