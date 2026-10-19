import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendInstructionMessage } from "./instructionMessages.js";
import { randomUUID } from "node:crypto";

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

const input = (body = "返信", recipientId = "completed") => ({ instructionId: "notice-1", recipientId, messageId: randomUUID(), body });
const messagePath = (request: ReturnType<typeof input>) => `${instructionPath}/conversations/${request.recipientId}/messages/${request.messageId}`;

describe("announcement message transaction", () => {
  beforeEach(() => { vi.spyOn(Timestamp, "now").mockReturnValue(now); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("allows an ongoing conversation from both sides without changing completion state", async () => {
    const db = database({ status: "completed" }, { active: true, displayName: "発信者" });
    db.replace("users/completed", { active: true, displayName: "受信者" });
    const before = db.read();
    for (let index = 0; index < 105; index += 1) {
      const actorId = index % 2 ? "completed" : "author";
      const request = input(`返信${index}`);
      await expect(sendInstructionMessage(db.firestore, actorId, request)).resolves.toEqual({ ok: true, id: request.messageId });
      expect(db.read(messagePath(request))).toMatchObject({ senderId: actorId, senderName: actorId === "author" ? "発信者" : "受信者", body: `返信${index}`, createdAt: now, isDemo: false });
    }
    expect(db.audits()).toHaveLength(105);
    expect(db.read()).toEqual(before);
  });

  it("does not mark a pending recipient confirmed when they ask a question", async () => {
    const db = database();
    db.replace("users/pending", { active: true });
    const request = input("確認前の質問", "pending");
    await sendInstructionMessage(db.firestore, "pending", request);
    expect(db.read()?.recipientStates.pending.status).toBe("pending");
  });

  it("deduplicates concurrent retries and records one audit event", async () => {
    const db = database();
    const request = input();
    await Promise.all([sendInstructionMessage(db.firestore, "author", request), sendInstructionMessage(db.firestore, "author", request)]);
    expect(db.audits()).toHaveLength(1);
    expect(db.read(messagePath(request))?.body).toBe("返信");
    expect(db.audits()[0]).toMatchObject({ action: "replied", after: { recipientId: "completed", messageId: request.messageId } });
  });

  it("keeps simultaneous messages from both participants", async () => {
    const db = database();
    db.replace("users/completed", { active: true });
    const first = input("質問");
    const second = input("回答");
    await Promise.all([sendInstructionMessage(db.firestore, "author", first), sendInstructionMessage(db.firestore, "completed", second)]);
    expect(db.read(messagePath(first))?.body).toBe("質問");
    expect(db.read(messagePath(second))?.body).toBe("回答");
    expect(db.audits()).toHaveLength(2);
  });

  it("never overwrites a previous message or accepts another sender's retry ID", async () => {
    const db = database();
    db.replace("users/completed", { active: true });
    const request = input();
    await sendInstructionMessage(db.firestore, "author", request);
    await expect(sendInstructionMessage(db.firestore, "author", { ...request, body: "改変" })).rejects.toMatchObject({ code: "already-exists" });
    await expect(sendInstructionMessage(db.firestore, "completed", request)).rejects.toMatchObject({ code: "already-exists" });
    expect(db.read(messagePath(request))?.body).toBe("返信");
    expect(db.audits()).toHaveLength(1);
  });

  it.each([undefined, "outsider", "pending"])("denies unrelated sender %s", async (actorId) => {
    const db = database();
    if (actorId) db.replace(`users/${actorId}`, { active: true, role: "employee_manager" });
    await expect(sendInstructionMessage(db.firestore, actorId, input())).rejects.toMatchObject({ code: actorId ? "permission-denied" : "unauthenticated" });
    expect(db.audits()).toHaveLength(0);
  });

  it("rejects nonexistent recipients, missing instructions and inactive profiles", async () => {
    const db = database();
    await expect(sendInstructionMessage(db.firestore, "author", input("返信", "stray"))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(sendInstructionMessage(db.firestore, "author", { ...input(), instructionId: "missing" })).rejects.toMatchObject({ code: "not-found" });
    db.replace(profilePath, { active: false });
    await expect(sendInstructionMessage(db.firestore, "author", input())).rejects.toMatchObject({ code: "permission-denied" });
    expect(db.audits()).toHaveLength(0);
  });

  it("blocks new replies after cancellation but acknowledges a previously committed retry", async () => {
    const db = database();
    const request = input();
    await sendInstructionMessage(db.firestore, "author", request);
    db.replace(instructionPath, { ...db.read(), status: "cancelled" });
    await expect(sendInstructionMessage(db.firestore, "author", input())).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(sendInstructionMessage(db.firestore, "author", request)).resolves.toEqual({ ok: true, id: request.messageId });
    expect(db.audits()).toHaveLength(1);
  });

  it.each(["cancel", "disable", "remove-recipient"])("rechecks authorization on concurrent %s", async (change) => {
    const db = database();
    const request = input();
    db.beforeCommit = () => {
      if (change === "disable") db.replace(profilePath, { active: false });
      else db.replace(instructionPath, { ...db.read(), ...(change === "cancel" ? { status: "cancelled" } : { recipientIds: [] }) });
    };
    await expect(sendInstructionMessage(db.firestore, "author", request)).rejects.toMatchObject({ code: change === "cancel" ? "failed-precondition" : "permission-denied" });
    expect(db.read(messagePath(request))).toBeUndefined();
    expect(db.audits()).toHaveLength(0);
  });

  it("commits the message and audit atomically", async () => {
    const db = database();
    const request = input();
    db.failAudit = true;
    await expect(sendInstructionMessage(db.firestore, "author", request)).rejects.toThrow("audit write failed");
    expect(db.read(messagePath(request))).toBeUndefined();
  });

  it.each([
    [{ isDemo: true, demoDatasetId: "one" }, { active: true }],
    [{}, { active: true, isDemo: true, demoDatasetId: "one" }],
    [{ isDemo: true, demoDatasetId: "two" }, { active: true, isDemo: true, demoDatasetId: "one" }]
  ])("rejects mismatched demo scopes", async (instruction, profile) => {
    const db = database(instruction, profile);
    await expect(sendInstructionMessage(db.firestore, "author", input())).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("preserves demo metadata and rejects incomplete demo accounts", async () => {
    const scope = { isDemo: true, demoDatasetId: "one", seedVersion: "v1" };
    const db = database(scope, { active: true, ...scope });
    const request = input();
    await sendInstructionMessage(db.firestore, "author", request);
    expect(db.read(messagePath(request))).toMatchObject(scope);
    expect(db.audits()[0]).toMatchObject(scope);
    db.replace(profilePath, { active: true, ...scope, seedVersion: "" });
    await expect(sendInstructionMessage(db.firestore, "author", input())).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it.each([{ body: "   " }, { body: "あ".repeat(2001) }, { instructionId: "bad/path" }, { recipientId: ".." }, { messageId: "bad/path" }])("rejects invalid message input %j", async (invalid) => {
    const db = database();
    await expect(sendInstructionMessage(db.firestore, "author", { ...input(), ...invalid })).rejects.toThrow();
    expect(db.audits()).toHaveLength(0);
  });
});
