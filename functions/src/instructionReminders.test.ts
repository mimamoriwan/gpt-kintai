import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INSTRUCTION_REMINDER_COOLDOWN_MS, sendInstructionReminder } from "./instructionReminders.js";

type Row = Record<string, any>;
type Ref = { path: string };
const instructionPath = "presidentInstructions/notice-1";
const profilePath = "users/author";
const now = Timestamp.fromMillis(Date.UTC(2026, 8, 17, 1));

function clone<T>(value: T): T {
  if (value instanceof Timestamp || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone) as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
}

/** An optimistic transaction double: conflicting reads retry and writes commit together. */
function database(instruction: Row = {}, profile: Row | null = { active: true }) {
  let nextId = 0;
  const rows = new Map<string, { value: Row; version: number }>([
    [instructionPath, { version: 1, value: {
      authorId: "author", status: "active", isDemo: false,
      recipientIds: ["pending", "acknowledged", "completed"],
      recipientStates: {
        pending: { userId: "pending", displayName: "未確認者", status: "pending" },
        acknowledged: { userId: "acknowledged", status: "acknowledged", acknowledgedAt: now },
        completed: { userId: "completed", status: "completed", acknowledgedAt: now, completedAt: now, completionNote: "完了" }
      }, titleOriginal: "お知らせ", ...clone(instruction)
    } }]
  ]);
  if (profile) rows.set(profilePath, { value: clone(profile), version: 1 });
  const control = {
    beforeCommit: undefined as (() => void) | undefined,
    failAudit: false,
    attempts: 0,
    read: (path = instructionPath) => clone(rows.get(path)?.value),
    replace: (path: string, value: Row) => rows.set(path, { value: clone(value), version: (rows.get(path)?.version || 0) + 1 }),
    audits: () => [...rows.entries()].filter(([path]) => path.startsWith("auditEvents/")).map(([, row]) => clone(row.value))
  };
  const firestore = {
    doc: (path: string) => ({ path }),
    collection: (path: string) => ({ doc: () => ({ path: `${path}/${++nextId}` }) }),
    runTransaction: async (callback: (transaction: any) => Promise<unknown>) => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        control.attempts += 1;
        const reads = new Map<string, number>();
        const writes: { ref: Ref; value: Row; create: boolean }[] = [];
        const result = await callback({
          get: async (ref: Ref) => {
            const row = rows.get(ref.path);
            reads.set(ref.path, row?.version || 0);
            const value = clone(row?.value);
            return { exists: Boolean(row), data: () => value };
          },
          update: (ref: Ref, value: Row) => writes.push({ ref, value, create: false }),
          create: (ref: Ref, value: Row) => writes.push({ ref, value, create: true })
        });
        const hook = control.beforeCommit;
        control.beforeCommit = undefined;
        hook?.();
        if ([...reads].some(([path, version]) => (rows.get(path)?.version || 0) !== version)) continue;
        if (control.failAudit && writes.some(({ ref }) => ref.path.startsWith("auditEvents/"))) throw new Error("audit write failed");
        for (const { ref, create } of writes) {
          if (create && rows.has(ref.path)) throw new Error("already exists");
          if (!create && !rows.has(ref.path)) throw new Error("not found");
        }
        for (const { ref, value, create } of writes) control.replace(ref.path, create ? value : { ...rows.get(ref.path)!.value, ...value });
        return result;
      }
      throw new Error("transaction retries exhausted");
    }
  } as unknown as Firestore;
  return Object.assign(control, { firestore });
}

describe("announcement reminder transaction", () => {
  beforeEach(() => { vi.spyOn(Timestamp, "now").mockReturnValue(now); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("requires authentication before reading or writing", async () => {
    const db = database();
    await expect(sendInstructionReminder(db.firestore, undefined, { instructionId: "notice-1" })).rejects.toMatchObject({ code: "unauthenticated" });
    expect(db.audits()).toEqual([]);
  });

  it.each([null, { active: false }])("rejects unavailable author profiles: %j", async (profile) => {
    const db = database({}, profile);
    await expect(sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" })).rejects.toMatchObject({ code: "permission-denied" });
    expect(db.audits()).toEqual([]);
  });

  it("rejects users other than the author even if they are managers", async () => {
    const db = database({ authorId: "someone-else" }, { active: true, role: "employee_manager" });
    await expect(sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" })).rejects.toMatchObject({ code: "permission-denied" });
    expect(db.read()?.lastReminderAt).toBeUndefined();
  });

  it.each([
    [{ isDemo: true, demoDatasetId: "one" }, { active: true }],
    [{ isDemo: false }, { active: true, isDemo: true, demoDatasetId: "one", seedVersion: "v1" }],
    [{ isDemo: true, demoDatasetId: "two" }, { active: true, isDemo: true, demoDatasetId: "one", seedVersion: "v1" }]
  ])("rejects a mismatched real or demo scope", async (instruction, profile) => {
    const db = database(instruction, profile);
    await expect(sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it.each(["cancelled", "completed"])("rejects a %s announcement", async (status) => {
    const db = database({ status });
    await expect(sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(db.audits()).toEqual([]);
  });

  it("updates only pending intended recipients and atomically records their ids", async () => {
    const db = database();
    const before = db.read()!;
    db.replace(instructionPath, {
      ...before,
      recipientIds: [...before.recipientIds, "pending", "missing"],
      recipientStates: { ...before.recipientStates, stray: { status: "pending" } }
    });
    const result = await sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" });
    expect(result).toEqual({ ok: true, recipientCount: 1 });
    expect(db.read()).toMatchObject({
      titleOriginal: "お知らせ", status: "active", reminderCount: 1, lastReminderAt: now, updatedAt: now,
      recipientStates: {
        pending: { ...before.recipientStates.pending, lastRemindedAt: now, reminderCount: 1 },
        acknowledged: before.recipientStates.acknowledged,
        completed: before.recipientStates.completed,
        stray: { status: "pending" }
      }
    });
    expect(db.read()?.recipientStates.acknowledged).toEqual(before.recipientStates.acknowledged);
    expect(db.read()?.recipientStates.completed).toEqual(before.recipientStates.completed);
    expect(db.read()?.recipientStates.stray).toEqual({ status: "pending" });
    expect(db.audits()).toEqual([expect.objectContaining({
      actorId: "author", entityType: "president_instruction", entityId: "notice-1", action: "reminded",
      after: { recipientIds: ["pending"], recipientCount: 1, reminderCount: 1 }, createdAt: now, isDemo: false
    })]);
  });

  it("rejects when no intended recipients remain pending", async () => {
    const db = database({ recipientIds: ["acknowledged", "completed"] });
    await expect(sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(db.read()?.reminderCount).toBeUndefined();
    expect(db.audits()).toEqual([]);
  });

  it("persists a matching demo scope on the audit", async () => {
    const scope = { isDemo: true, demoDatasetId: "one", seedVersion: "v1" };
    const db = database(scope, { active: true, ...scope });
    await sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" });
    expect(db.audits()[0]).toMatchObject(scope);
  });

  it("rejects an incomplete demo profile", async () => {
    const db = database({ isDemo: true, demoDatasetId: "one" }, { active: true, isDemo: true, demoDatasetId: "one" });
    await expect(sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" })).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("enforces the cooldown and allows exactly five minutes with incremented counts", async () => {
    const db = database();
    await sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" });
    vi.mocked(Timestamp.now).mockReturnValue(Timestamp.fromMillis(now.toMillis() + INSTRUCTION_REMINDER_COOLDOWN_MS - 1));
    await expect(sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" })).rejects.toMatchObject({ code: "resource-exhausted" });
    expect(db.audits()).toHaveLength(1);
    const later = Timestamp.fromMillis(now.toMillis() + INSTRUCTION_REMINDER_COOLDOWN_MS);
    vi.mocked(Timestamp.now).mockReturnValue(later);
    await expect(sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" })).resolves.toEqual({ ok: true, recipientCount: 1 });
    expect(db.read()).toMatchObject({ reminderCount: 2, lastReminderAt: later, recipientStates: { pending: { reminderCount: 2, lastRemindedAt: later } } });
    expect(db.audits()).toHaveLength(2);
  });

  it("commits only one reminder when two calls read the same version concurrently", async () => {
    const db = database();
    const results = await Promise.allSettled([
      sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" }),
      sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "resource-exhausted" } });
    expect(db.read()?.reminderCount).toBe(1);
    expect(db.audits()).toHaveLength(1);
  });

  it("rechecks recipients after a concurrent acknowledgement without overwriting it", async () => {
    const db = database();
    db.beforeCommit = () => {
      const row = db.read()!;
      db.replace(instructionPath, { ...row, recipientStates: { ...row.recipientStates, pending: { ...row.recipientStates.pending, status: "acknowledged", acknowledgedAt: now } } });
    };
    await expect(sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(db.read()?.recipientStates.pending).toMatchObject({ status: "acknowledged", acknowledgedAt: now });
    expect(db.read()?.lastReminderAt).toBeUndefined();
    expect(db.audits()).toEqual([]);
  });

  it("rechecks a concurrently disabled author", async () => {
    const db = database();
    db.beforeCommit = () => { db.replace(profilePath, { active: false }); };
    await expect(sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" })).rejects.toMatchObject({ code: "permission-denied" });
    expect(db.audits()).toEqual([]);
  });

  it("does not save a reminder if the atomic audit write fails", async () => {
    const db = database();
    db.failAudit = true;
    await expect(sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1" })).rejects.toThrow("audit write failed");
    expect(db.read()?.lastReminderAt).toBeUndefined();
    expect(db.audits()).toEqual([]);
  });

  it("rejects document paths instead of a single instruction id", async () => {
    const db = database();
    await expect(sendInstructionReminder(db.firestore, "author", { instructionId: "notice-1/other/notice" })).rejects.toThrow("お知らせのIDが正しくありません。");
    expect(db.audits()).toEqual([]);
  });
});
