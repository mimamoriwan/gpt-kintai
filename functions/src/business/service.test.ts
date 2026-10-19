import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { contentVersion, type Row } from "./domain.js";
import { createBusinessService } from "./service.js";

// Transaction fake applies writes only after the callback succeeds, checks the
// Firestore read-before-write constraint, and serializes concurrent mutations.
class MemoryDatabase {
  rows = new Map<string, Row>();
  writes: string[] = [];
  sequence = 0;
  queue: Promise<unknown> = Promise.resolve();
  doc(path: string): any {
    const db = this;
    return { path, id: path.split("/").at(-1), get: async () => db.snapshot(path) };
  }
  snapshot(path: string): any {
    const row = this.rows.get(path);
    return { exists: row !== undefined, id: path.split("/").at(-1), data: () => row ? structuredClone(row) : undefined };
  }
  collection(name: string): any {
    return new Query(this, name);
  }
  runTransaction(callback: (tx: any) => Promise<any>): Promise<any> {
    const operation = this.queue.then(async () => {
      const changes: [string, Row][] = [];
      const tx = {
        get: async (ref: any) => { if (changes.length) throw new Error("Read after write"); return this.snapshot(ref.path); },
        set: (ref: any, row: Row) => { changes.push([ref.path, row]); },
        create: (ref: any, row: Row) => { if (this.rows.has(ref.path)) throw new Error("Exists"); changes.push([ref.path, row]); },
        update: (ref: any, row: Row) => { changes.push([ref.path, { ...this.rows.get(ref.path), ...row }]); }
      };
      const result = await callback(tx);
      for (const [path, row] of changes) { this.rows.set(path, structuredClone(row)); this.writes.push(path); }
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
class Query {
  filters: [string, unknown][] = [];
  orders: [string, string][] = [];
  count = Infinity;
  after?: unknown[];
  constructor(private db: MemoryDatabase, private name: string) {}
  doc(id?: string) { return this.db.doc(`${this.name}/${id ?? `auto-${++this.db.sequence}`}`); }
  where(field: string, _operator: string, value: unknown) { this.filters.push([field, value]); return this; }
  orderBy(field: any, direction: string) { this.orders.push([typeof field === "string" ? field : "id", direction]); return this; }
  startAfter(...args: unknown[]) { this.after = args; return this; }
  limit(count: number) { this.count = count; return this; }
  async get() {
    let entries = [...this.db.rows].filter(([path, row]) => path.startsWith(`${this.name}/`) && this.filters.every(([field, value]) => row[field] === value));
    entries.sort(([pathA, a], [pathB, b]) => {
      for (const [field, direction] of this.orders) {
        const av = field === "id" ? pathA.split("/").at(-1)! : a[field];
        const bv = field === "id" ? pathB.split("/").at(-1)! : b[field];
        if (av !== bv) return (av < bv ? -1 : 1) * (direction === "desc" ? -1 : 1);
      }
      return 0;
    });
    if (this.after) entries = entries.filter(([path, row]) => row.createdAt < this.after![0]! || (row.createdAt === this.after![0] && path.split("/").at(-1)! < String(this.after![1])));
    const docs = entries.slice(0, this.count).map(([path]) => this.db.snapshot(path));
    return { docs, size: docs.length };
  }
}
const memberIds = ["yasushi", "president", "fang"];
const themeInput = { id: "theme", expectedVersion: 0, name: "販売基盤", description: "説明", sourceLocale: "ja", order: 0, referenceLinks: [] };
const initiativeInput = { id: "initiative", expectedVersion: 0, name: "倉庫を決める", description: "説明", sourceLocale: "ja", referenceLinks: [], themeId: "theme", assigneeIds: ["fang"], status: "not_started", plannedStartMonth: "2026-09", plannedEndMonth: "2026-10", targetMemo: "9月末", milestones: [{ id: "m1", name: "見積", order: 0, archived: false }] };
const auth = (uid = "yasushi") => ({ uid });
let db: MemoryDatabase;
let featureEnabled: boolean;
let disabled: Set<string>;
let translate: ReturnType<typeof vi.fn>;
let getAccount: ReturnType<typeof vi.fn>;
let service: ReturnType<typeof createBusinessService>;
async function seed() {
  await service.saveBusinessSettings(auth(), { expectedVersion: 0, enabled: true, memberIds });
  await service.saveBusinessTheme(auth(), themeInput);
  await service.saveBusinessInitiative(auth(), initiativeInput);
}
function initiative() { return db.rows.get("businessInitiatives/initiative")!; }
function histories() { return [...db.rows].filter(([path]) => path.startsWith("businessHistory/")); }
function translateInput() { return { kind: "initiative", id: "initiative", targetLocale: "zh-CN", expectedContentVersion: initiative().contentVersion }; }

beforeEach(() => {
  db = new MemoryDatabase(); featureEnabled = true; disabled = new Set();
  for (const [uid, role] of [["yasushi", "employee_manager"], ["president", "president_viewer"], ["fang", "employee"], ["newbie", "employee"]]) db.rows.set(`users/${uid}`, { active: true, role, displayName: uid });
  translate = vi.fn(async (fields: Record<string, string>) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ? `译:${value}` : ""])));
  getAccount = vi.fn(async (uid: string) => ({ disabled: disabled.has(uid) }));
  service = createBusinessService({ db: db as unknown as Firestore, getAccount, featureEnabled: () => featureEnabled, now: () => 1000 + db.writes.length, translate });
});

describe("business sharing and current account authorization", () => {
  it.each(["yasushi", "president"])("%s can bootstrap all three members and administer themes/initiatives", async (uid) => {
    const workspace = await service.getBusinessWorkspace(auth(uid), {});
    expect(workspace).toMatchObject({ settings: { enabled: false, memberIds: [], version: 0 }, canManage: true, themes: [], initiatives: [] });
    expect(workspace.memberCandidates).toHaveLength(4);
    await service.saveBusinessSettings(auth(uid), { expectedVersion: 0, enabled: true, memberIds });
    await service.saveBusinessTheme(auth(uid), themeInput);
    await service.saveBusinessInitiative(auth(uid), initiativeInput);
    await service.setBusinessStatus(auth(uid), { initiativeId: "initiative", expectedVersion: 1, status: "completed" });
    await service.setBusinessArchived(auth(uid), { kind: "initiative", id: "initiative", expectedVersion: 2, archived: true });
    await service.setBusinessArchived(auth(uid), { kind: "initiative", id: "initiative", expectedVersion: 3, archived: false });
    expect(initiative().version).toBe(4);
  });
  it("rejects non-admin bootstrap, missing roles, duplicate members and cross-demo members", async () => {
    await expect(service.getBusinessWorkspace(auth("fang"), {})).rejects.toMatchObject({ code: "permission-denied" });
    await expect(service.saveBusinessSettings(auth(), { expectedVersion: 0, enabled: true, memberIds: ["yasushi", "fang", "newbie"] })).rejects.toMatchObject({ code: "invalid-argument" });
    db.rows.get("users/fang")!.isDemo = true; db.rows.get("users/fang")!.demoDatasetId = "other";
    await expect(service.saveBusinessSettings(auth(), { expectedVersion: 0, enabled: true, memberIds })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(db.writes).toHaveLength(0);
  });
  it("does not auto-enrol new accounts or expose profile email fields", async () => {
    await seed(); db.rows.get("users/yasushi")!.email = "private@example.test";
    await expect(service.getBusinessWorkspace(auth("newbie"), {})).rejects.toMatchObject({ code: "permission-denied" });
    const workspace = await service.getBusinessWorkspace(auth("fang"), {});
    expect(workspace.memberCandidates).toEqual([]);
    expect(JSON.stringify(workspace.members)).not.toContain("email");
  });
  it("refuses disabled Auth accounts, inactive profiles, and demoted administrators", async () => {
    await seed();
    disabled.add("yasushi");
    await expect(service.getBusinessWorkspace(auth(), {})).rejects.toMatchObject({ code: "permission-denied" });
    disabled.clear(); db.rows.get("users/yasushi")!.active = false;
    await expect(service.getBusinessWorkspace(auth(), {})).rejects.toMatchObject({ code: "permission-denied" });
    db.rows.get("users/yasushi")!.active = true; db.rows.get("users/yasushi")!.role = "employee";
    await expect(service.saveBusinessTheme(auth(), { ...themeInput, expectedVersion: 1 })).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("enforces server and per-workspace stops, allowing only shared admins to restore settings", async () => {
    await seed();
    await service.saveBusinessSettings(auth("president"), { expectedVersion: 1, enabled: false, memberIds });
    expect(await service.getBusinessWorkspace(auth("fang"), {})).toMatchObject({ themes: [], initiatives: [], settings: { enabled: false } });
    await expect(service.setBusinessStatus(auth(), { initiativeId: "initiative", expectedVersion: 1, status: "completed" })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(service.saveBusinessSettings(auth("fang"), { expectedVersion: 2, enabled: true, memberIds })).rejects.toMatchObject({ code: "permission-denied" });
    await service.saveBusinessSettings(auth(), { expectedVersion: 2, enabled: true, memberIds });
    featureEnabled = false;
    await expect(service.getBusinessWorkspace(auth(), {})).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(service.saveBusinessSettings(auth(), { expectedVersion: 3, enabled: true, memberIds })).rejects.toMatchObject({ code: "failed-precondition" });
  });
  it("does not return admin-only candidate data if the role changes during loading", async () => {
    await seed();
    getAccount.mockImplementationOnce(async () => ({ disabled: false })).mockImplementationOnce(async () => {
      db.rows.get("users/yasushi")!.role = "employee";
      return { disabled: false };
    });
    await expect(service.getBusinessWorkspace(auth(), {})).rejects.toMatchObject({ code: "aborted" });
  });
  it("rejects assigning a disabled Auth member even if their stored profile is still active", async () => {
    await seed(); disabled.add("fang");
    await expect(service.saveBusinessInitiative(auth(), { ...initiativeInput, expectedVersion: 1 })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(initiative().version).toBe(1);
  });
});

describe("business transactions, conflict handling and history", () => {
  beforeEach(seed);
  it("restricts an employee to assigned state/completion, while allowing their own updates", async () => {
    await expect(service.saveBusinessTheme(auth("fang"), { ...themeInput, expectedVersion: 1 })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(service.setBusinessArchived(auth("fang"), { kind: "initiative", id: "initiative", expectedVersion: 1, archived: true })).rejects.toMatchObject({ code: "permission-denied" });
    await service.setBusinessStatus(auth("fang"), { initiativeId: "initiative", expectedVersion: 1, status: "in_progress" });
    await service.setBusinessMilestoneCompletion(auth("fang"), { initiativeId: "initiative", milestoneId: "m1", expectedVersion: 2, completed: true });
    expect(initiative().status).toBe("in_progress");
    await service.saveBusinessInitiative(auth(), { ...initiativeInput, expectedVersion: 3, assigneeIds: [], status: "in_progress" });
    await expect(service.setBusinessMilestoneCompletion(auth("fang"), { initiativeId: "initiative", milestoneId: "m1", expectedVersion: 4, completed: false })).rejects.toMatchObject({ code: "permission-denied" });
    await service.postBusinessUpdate(auth("fang"), { id: "report", initiativeId: "initiative", body: "近況", sourceLocale: "ja" });
    expect(db.rows.get("businessUpdates/report")!.authorId).toBe("fang");
  });
  it("concurrent edits cannot silently overwrite each other", async () => {
    const results = await Promise.allSettled([
      service.saveBusinessTheme(auth(), { ...themeInput, expectedVersion: 1, name: "ヤスシ変更" }),
      service.saveBusinessTheme(auth("president"), { ...themeInput, expectedVersion: 1, name: "社長変更" })
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.find((item) => item.status === "rejected")).toMatchObject({ reason: { code: "aborted" } });
    expect(db.rows.get("businessThemes/theme")!.name).toBe("ヤスシ変更");
  });
  it("saves three active milestones with archived history but rejects zero or four active milestones", async () => {
    const milestones = [
      ...initiativeInput.milestones,
      { id: "m2", name: "準備", order: 1, archived: false },
      { id: "m3", name: "確認", order: 2, archived: false },
      { id: "old", name: "過去の節目", order: 3, archived: true }
    ];
    await service.saveBusinessInitiative(auth(), { ...initiativeInput, expectedVersion: 1, milestones });
    expect(initiative().milestones).toMatchObject(milestones);
    expect(initiative().version).toBe(2);

    await expect(service.saveBusinessInitiative(auth(), { ...initiativeInput, expectedVersion: 2, milestones: milestones.map((item) => ({ ...item, archived: true })) })).rejects.toThrow(/有効な節目/);
    await expect(service.saveBusinessInitiative(auth(), { ...initiativeInput, expectedVersion: 2, milestones: milestones.map((item) => ({ ...item, archived: false })) })).rejects.toThrow(/有効な節目/);
    expect(initiative().milestones).toMatchObject(milestones);
    expect(initiative().version).toBe(2);
  });
  it("explicit milestone values are idempotent, preserve content version and do not complete the initiative", async () => {
    const initialHash = initiative().contentVersion;
    const request = { initiativeId: "initiative", milestoneId: "m1", expectedVersion: 1, completed: true };
    const first = await service.setBusinessMilestoneCompletion(auth("fang"), request);
    const count = histories().length;
    expect(await service.setBusinessMilestoneCompletion(auth("fang"), request)).toEqual(first);
    expect(histories()).toHaveLength(count);
    expect(initiative().status).toBe("not_started");
    expect(initiative().contentVersion).toBe(initialHash);
    await service.setBusinessMilestoneCompletion(auth("fang"), { ...request, expectedVersion: 2, completed: false });
    expect(initiative().milestones[0].completed).toBe(false);
  });
  it("retains latest posts when a pre-existing edit form saves and deduplicates uncertain post retries", async () => {
    const post = { id: "post", initiativeId: "initiative", body: "見積待ち", sourceLocale: "ja" };
    await service.postBusinessUpdate(auth("fang"), post);
    await service.postBusinessUpdate(auth("fang"), post);
    await service.saveBusinessInitiative(auth(), { ...initiativeInput, expectedVersion: 1, description: "変更" });
    expect(initiative().latestUpdate.body).toBe("見積待ち");
    expect([...db.rows.keys()].filter((key) => key.startsWith("businessUpdates/"))).toHaveLength(1);
    await expect(service.postBusinessUpdate(auth("president"), post)).rejects.toMatchObject({ code: "already-exists" });
    expect(db.writes.some((path) => /workLogs|dailyReports|presidentInstructions/.test(path))).toBe(false);
  });
  it("archived initiatives and milestones are read-only until restored", async () => {
    await service.saveBusinessInitiative(auth(), { ...initiativeInput, expectedVersion: 1, milestones: [{ ...initiativeInput.milestones[0], archived: true }, { id: "m2", name: "次の節目", order: 1, archived: false }] });
    await expect(service.setBusinessMilestoneCompletion(auth(), { initiativeId: "initiative", milestoneId: "m1", expectedVersion: 2, completed: true })).rejects.toMatchObject({ code: "failed-precondition" });
    await service.setBusinessArchived(auth(), { kind: "initiative", id: "initiative", expectedVersion: 2, archived: true });
    await expect(service.postBusinessUpdate(auth(), { id: "no", initiativeId: "initiative", body: "no", sourceLocale: "ja" })).rejects.toMatchObject({ code: "failed-precondition" });
    expect((await service.getBusinessInitiativeDetail(auth("fang"), { initiativeId: "initiative" })).history.length).toBeGreaterThan(0);
  });
  it("returns all historical pages without duplicating or losing tied timestamps", async () => {
    for (let i = 0; i < 103; i++) {
      const id = `post-${String(i).padStart(3, "0")}`;
      db.rows.set(`businessUpdates/${id}`, { id, scopeId: "company", initiativeId: "initiative", body: id, createdAt: 10 });
    }
    const first = await service.getBusinessInitiativeDetail(auth(), { initiativeId: "initiative" });
    const second = await service.getBusinessInitiativeDetail(auth(), { initiativeId: "initiative", updatesCursor: first.nextUpdatesCursor });
    const third = await service.getBusinessInitiativeDetail(auth(), { initiativeId: "initiative", updatesCursor: second.nextUpdatesCursor });
    expect(first.updates).toHaveLength(50); expect(second.updates).toHaveLength(50); expect(third.updates).toHaveLength(3);
    expect(new Set([...first.updates, ...second.updates, ...third.updates].map((row) => row.id)).size).toBe(103);
    expect(third.nextUpdatesCursor).toBeNull();
  });
  it("separates theme and initiative history even when they use the same identifier", async () => {
    await service.saveBusinessTheme(auth(), { ...themeInput, id: "initiative" });
    const detail = await service.getBusinessInitiativeDetail(auth("fang"), { initiativeId: "initiative" });
    expect(detail.history.every((entry) => entry.entityType === "initiative")).toBe(true);
    const themeHistory = await service.getBusinessHistory(auth("fang"), { kind: "theme", id: "initiative" });
    expect(themeHistory.history).toHaveLength(1);
    expect(themeHistory.history[0].entityType).toBe("theme");
  });
  it("protects settings history and never exposes an internal settings scope identifier", async () => {
    await expect(service.getBusinessHistory(auth("fang"), { kind: "settings", id: "current" })).rejects.toMatchObject({ code: "permission-denied" });
    const result = await service.getBusinessHistory(auth("president"), { kind: "settings", id: "current" });
    expect(result.history).toHaveLength(1);
    expect(result.history[0].entityId).toBe("current");
    expect(result.history[0]).not.toHaveProperty("scopeId");
    expect(result.history[0].after).not.toHaveProperty("scopeId");
    getAccount.mockImplementationOnce(async () => ({ disabled: false })).mockImplementationOnce(async () => {
      db.rows.get("users/president")!.role = "employee";
      return { disabled: false };
    });
    await expect(service.getBusinessHistory(auth("president"), { kind: "settings", id: "current" })).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("business translation authorization and source revisions", () => {
  beforeEach(seed);
  it("reuses unchanged source after dates/status/completion change and never mutates original text", async () => {
    const first = await service.translateBusinessContent(auth("fang"), translateInput());
    expect(first.cached).toBe(false);
    await service.setBusinessStatus(auth(), { initiativeId: "initiative", expectedVersion: 1, status: "completed" });
    const second = await service.translateBusinessContent(auth("president"), translateInput());
    expect(second.cached).toBe(true); expect(translate).toHaveBeenCalledTimes(1);
    expect(initiative().name).toBe("倉庫を決める");
  });
  it("translation failure leaves saved original and history intact and can be retried", async () => {
    const before = structuredClone(initiative()); const count = histories().length;
    translate.mockRejectedValueOnce(new Error("secret provider detail"));
    await expect(service.translateBusinessContent(auth(), translateInput())).rejects.toMatchObject({ code: "unavailable" });
    expect(initiative()).toEqual(before); expect(histories()).toHaveLength(count);
    await expect(service.translateBusinessContent(auth(), translateInput())).resolves.toMatchObject({ cached: false });
  });
  it.each(["source", "membership", "disabled", "stop"])("rejects late translation after %s changes", async (change) => {
    let finish!: (fields: Record<string, string>) => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { started = resolve; });
    translate.mockImplementationOnce(async (fields) => { started(); return new Promise((resolve) => { finish = () => resolve(fields); }); });
    const promise = service.translateBusinessContent(auth("fang"), translateInput());
    await waiting;
    if (change === "source") {
      const row = initiative(); row.name = "変更後"; row.contentVersion = contentVersion("initiative", row);
    }
    if (change === "membership") db.rows.get("businessSettings/company")!.memberIds = ["yasushi", "president", "newbie"];
    if (change === "disabled") disabled.add("fang");
    if (change === "stop") featureEnabled = false;
    finish({});
    await expect(promise).rejects.toMatchObject({ code: change === "source" ? "aborted" : change === "stop" ? "failed-precondition" : "permission-denied" });
    expect([...db.rows.keys()].filter((key) => key.startsWith("businessTranslations/"))).toHaveLength(0);
  });
  it("cached translations still reject revoked membership and cross-scope access", async () => {
    await service.translateBusinessContent(auth(), translateInput());
    db.rows.get("businessSettings/company")!.memberIds = ["yasushi", "president", "newbie"];
    await expect(service.translateBusinessContent(auth("fang"), translateInput())).rejects.toMatchObject({ code: "permission-denied" });
    const profile = db.rows.get("users/fang")!; profile.isDemo = true; profile.demoDatasetId = "other";
    await expect(service.translateBusinessContent(auth("fang"), translateInput())).rejects.toMatchObject({ code: "permission-denied" });
    expect(translate).toHaveBeenCalledTimes(1);
  });
});
