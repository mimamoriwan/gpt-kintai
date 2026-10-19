import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";

const mocks = vi.hoisted(() => ({
  profileGet: vi.fn(),
  activeGet: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  holidayGet: vi.fn(),
  create: vi.fn(),
  commit: vi.fn(),
  update: vi.fn(),
  transactionGet: vi.fn(),
  transactionSet: vi.fn(),
  runTransaction: vi.fn()
}));

vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase-admin/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase-admin/firestore")>();
  const query = { where: mocks.where, limit: mocks.limit, get: mocks.activeGet };
  return {
    ...actual,
    getFirestore: () => ({
      doc: (path: string) => {
        if (path.startsWith("users/")) return { get: mocks.profileGet };
        if (path.startsWith("companyHolidayOverrides/")) return { get: mocks.holidayGet };
        if (path.startsWith("monthlyEvidencePackages/")) return { path };
        throw new Error(`Unexpected document: ${path}`);
      },
      collection: (path: string) => {
        if (path === "attendance") return { ...query, doc: () => ({ id: "attendance-1" }) };
        if (path === "auditEvents") return { doc: () => ({ id: "audit-1" }) };
        throw new Error(`Unexpected collection: ${path}`);
      },
      batch: () => ({ create: mocks.create, commit: mocks.commit }),
      runTransaction: mocks.runTransaction
    })
  };
});

import { clockIn, clockOut } from "./index.js";

const request = {
  auth: { uid: "employee-1", token: { role: "employee" } },
  data: { workMode: "office" }
} as unknown as CallableRequest;
const today = "2026-09-10";
const now = new Date(`${today}T01:30:00.000Z`);
const profileSnapshot = (overrides: Record<string, unknown> = {}) => ({
  exists: true,
  data: () => ({ uid: "employee-1", role: "employee", active: true, displayName: "Employee", ...overrides })
});
const activeSnapshot = (row?: Record<string, unknown>) => ({
  empty: !row,
  size: row ? 1 : 0,
  docs: row ? [{ id: "attendance-1", data: () => row, ref: { update: mocks.update } }] : []
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function expectNoAttendanceWrite() {
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.runTransaction).not.toHaveBeenCalled();
}

describe("attendance callable reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const query = { where: mocks.where, limit: mocks.limit, get: mocks.activeGet };
    mocks.where.mockReturnValue(query);
    mocks.limit.mockReturnValue(query);
    mocks.profileGet.mockResolvedValue(profileSnapshot());
    mocks.activeGet.mockResolvedValue(activeSnapshot());
    mocks.holidayGet.mockResolvedValue({ exists: false });
    mocks.commit.mockResolvedValue(undefined);
    mocks.update.mockResolvedValue(undefined);
    mocks.transactionGet.mockResolvedValue({ exists: false, data: () => undefined });
    mocks.runTransaction.mockImplementation(async (callback) => callback({ get: mocks.transactionGet, set: mocks.transactionSet }));
  });

  afterEach(() => vi.useRealTimers());

  it.each([
    ["clockIn", clockIn, 1, undefined],
    ["clockOut", clockOut, 2, { workDate: today }]
  ] as const)("%s starts both attendance-context reads after the password gate and waits for both", async (_name, callable, limit, row) => {
    const profile = deferred<ReturnType<typeof profileSnapshot>>();
    const active = deferred<ReturnType<typeof activeSnapshot>>();
    mocks.profileGet.mockResolvedValueOnce(profileSnapshot()).mockReturnValue(profile.promise);
    mocks.activeGet.mockReturnValue(active.promise);

    const result = callable.run(request);

    await vi.waitFor(() => expect(mocks.profileGet).toHaveBeenCalledTimes(2));
    expect(mocks.activeGet).toHaveBeenCalledTimes(1);
    expect(mocks.where.mock.calls).toEqual([["userId", "==", "employee-1"], ["status", "==", "active"]]);
    expect(mocks.limit).toHaveBeenCalledWith(limit);
    active.resolve(activeSnapshot(row));
    await Promise.resolve();
    expectNoAttendanceWrite();
    profile.resolve(profileSnapshot());

    await expect(result).resolves.toEqual({ id: "attendance-1" });
  });

  it.each([["clockIn", clockIn], ["clockOut", clockOut]] as const)("%s keeps account rejection first when the attendance query fails earlier", async (_name, callable) => {
    const profile = deferred<ReturnType<typeof profileSnapshot>>();
    mocks.profileGet.mockResolvedValueOnce(profileSnapshot()).mockReturnValue(profile.promise);
    mocks.activeGet.mockRejectedValue(new Error("Attendance query failed"));
    const result = callable.run(request);
    const rejected = expect(result).rejects.toMatchObject({ code: "permission-denied", message: "利用できないアカウントです。" });
    await Promise.resolve();
    profile.resolve(profileSnapshot({ active: false, displayName: "Disabled" }));

    await rejected;
    expectNoAttendanceWrite();
  });

  it.each([["clockIn", clockIn], ["clockOut", clockOut]] as const)("%s does not write for a missing user even when the attendance read succeeds", async (_name, callable) => {
    // The account passed the initial work gate, then disappeared before the
    // parallel attendance-context reads. Preserve that second-read rejection.
    mocks.profileGet.mockResolvedValueOnce(profileSnapshot()).mockResolvedValue({ exists: false, data: () => undefined });

    await expect(callable.run(request)).rejects.toMatchObject({ code: "permission-denied", message: "利用できないアカウントです。" });

    expect(mocks.activeGet).toHaveBeenCalledOnce();
    expectNoAttendanceWrite();
  });

  it.each([["clockIn", clockIn], ["clockOut", clockOut]] as const)("%s rejects an unregistered account before reading attendance", async (_name, callable) => {
    mocks.profileGet.mockResolvedValue({ exists: false, data: () => undefined });
    await expect(callable.run(request)).rejects.toMatchObject({ code: "permission-denied", details: { reason: "work-account-unavailable" } });
    expect(mocks.activeGet).not.toHaveBeenCalled();
    expectNoAttendanceWrite();
  });

  it.each([["clockIn", clockIn], ["clockOut", clockOut]] as const)("%s blocks an old token before attendance work when password change is required", async (_name, callable) => {
    mocks.profileGet.mockResolvedValue(profileSnapshot({ passwordChangeRequired: true }));
    await expect(callable.run(request)).rejects.toMatchObject({ code: "failed-precondition", details: { reason: "password-change-required" } });
    expect(mocks.activeGet).not.toHaveBeenCalled();
    expectNoAttendanceWrite();
  });

  it("does not clock out when there is no active record", async () => {
    await expect(clockOut.run(request)).rejects.toMatchObject({ code: "not-found" });
    expectNoAttendanceWrite();
  });

  it("does not clock in when an active record already exists", async () => {
    mocks.activeGet.mockResolvedValue(activeSnapshot({ workDate: today }));

    await expect(clockIn.run(request)).rejects.toMatchObject({ code: "already-exists" });

    expectNoAttendanceWrite();
  });

  it("retains demo scope checks before clocking out", async () => {
    mocks.activeGet.mockResolvedValue(activeSnapshot({ workDate: today, isDemo: true, demoDatasetId: "other-scope" }));

    await expect(clockOut.run(request)).rejects.toMatchObject({ code: "permission-denied", message: "デモデータの範囲が一致しません。" });

    expectNoAttendanceWrite();
  });

  it.each([["clockIn", clockIn], ["clockOut", clockOut]] as const)("%s retains server timestamps and waits for monthly invalidation", async (name, callable) => {
    if (name === "clockOut") mocks.activeGet.mockResolvedValue(activeSnapshot({ workDate: today }));
    const monthly = deferred<{ exists: boolean; data: () => undefined }>();
    const invalidationStarted = deferred<void>();
    mocks.transactionGet.mockImplementation(() => {
      invalidationStarted.resolve();
      return monthly.promise;
    });
    let finished = false;
    const result = callable.run(request).then((value) => {
      finished = true;
      return value;
    });
    await invalidationStarted.promise;
    expect(mocks.transactionGet).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    if (name === "clockIn") {
      expect(mocks.create).toHaveBeenCalledWith({ id: "attendance-1" }, expect.objectContaining({
        userId: "employee-1", status: "active", workMode: "office", workDate: today,
        startedAt: Timestamp.fromDate(now), clockInRecordedAt: Timestamp.fromDate(now),
        createdAt: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now)
      }));
    } else {
      expect(mocks.update).toHaveBeenCalledWith({
        status: "completed", endedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
      });
    }
    monthly.resolve({ exists: false, data: () => undefined });

    await expect(result).resolves.toEqual({ id: "attendance-1" });
  });
});
