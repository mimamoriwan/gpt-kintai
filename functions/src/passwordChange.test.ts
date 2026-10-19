import { readFileSync } from "node:fs";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { describe, expect, it, vi } from "vitest";
import { completePasswordSetup, passwordSetupHash, PASSWORD_CHANGE_LEASE_MS, requireWorkAuth, type PasswordAuthContext } from "./passwordChange.js";

const uid = "employee-test";
const profilePath = `users/${uid}`;
const setupPath = `passwordSetups/${uid}`;
const salt = "ab".repeat(32);
const temporary = "initial-test-value";
const chosen = " chosen-test-value ";
const temporaryPasswordHash = passwordSetupHash(temporary, salt);

function fixture() {
  let nowMillis = Date.parse("2026-09-17T03:00:00Z");
  const now = () => Timestamp.fromMillis(nowMillis);
  const state = new Map<string, Record<string, any>>([
    [profilePath, { uid, email: "employee@example.com", displayName: "Employee", role: "employee", active: true, passwordChangeRequired: true, passwordResetId: "reset-1" }],
    [setupPath, { resetId: "reset-1", status: "required", requestedAt: Timestamp.fromMillis(nowMillis - 1000), expiresAt: Timestamp.fromMillis(nowMillis + 86400000), salt, temporaryPasswordHash }]
  ]);
  let transactionNumber = 0;
  let failTransaction = 0;
  let queue = Promise.resolve();
  const db = {
    doc: (path: string) => ({ path }),
    runTransaction: (work: (transaction: unknown) => Promise<unknown>) => {
      const result = queue.then(async () => {
        transactionNumber++;
        const writes: { path: string; data: Record<string, unknown> }[] = [];
        const transaction = {
          get: async (reference: { path: string }) => ({ exists: state.has(reference.path), data: () => state.has(reference.path) ? { ...state.get(reference.path)! } : undefined }),
          update: (reference: { path: string }, data: Record<string, unknown>) => writes.push({ path: reference.path, data })
        };
        const result = await work(transaction);
        if (transactionNumber === failTransaction) throw new Error("simulated transaction transport failure");
        for (const write of writes) {
          const next = { ...state.get(write.path) };
          for (const [key, value] of Object.entries(write.data)) {
            if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) delete next[key];
            else next[key] = value;
          }
          state.set(write.path, next);
        }
        return result;
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    }
  } as unknown as Firestore;
  const updateUser = vi.fn().mockResolvedValue({ uid });
  let nextOperation = 0;
  const auth: PasswordAuthContext = { uid, token: { auth_time: Math.floor(nowMillis / 1000), role: "employee" } };
  const wait = vi.fn(async (milliseconds: number) => { nowMillis += milliseconds; });
  const dependencies = { db, auth: { updateUser } as Pick<Auth, "updateUser">, now, operationId: () => `operation-${++nextOperation}`, wait };
  return {
    state, auth, dependencies, updateUser, wait,
    call: (password: unknown = chosen) => completePasswordSetup(auth, { newPassword: password }, dependencies),
    advance: (milliseconds: number) => { nowMillis += milliseconds; },
    failTransaction: (number: number) => { failTransaction = number; }
  };
}

async function expectReason(promise: Promise<unknown>, reason: string) {
  await expect(promise).rejects.toMatchObject({ details: { reason } });
}

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("current work-account and password-change gate", () => {
  const registeredProfile = { uid, active: true, role: "employee" };

  it.each([
    ["unregistered", undefined],
    ["different UID", { ...registeredProfile, uid: "someone-else" }],
    ["missing UID", { active: true, role: "employee" }],
    ["inactive", { ...registeredProfile, active: false }],
    ["missing active flag", { uid, role: "employee" }],
    ["invalid active flag", { ...registeredProfile, active: "true" }],
    ["unknown role", { ...registeredProfile, role: "admin" }],
    ["missing role", { uid, active: true }]
  ])("rejects an %s account even with a privileged Google token", async (_state, profile) => {
    const auth = { uid, token: { role: "employee_manager", firebase: { sign_in_provider: "google.com" } } };
    await expect(requireWorkAuth(auth, async () => profile)).rejects.toMatchObject({
      code: "permission-denied", details: { reason: "work-account-unavailable" }
    });
  });

  it.each(["employee", "employee_manager", "president_viewer"])("allows registered %s accounts using the existing password sign-in", async (role) => {
    const auth = { uid, token: { role, firebase: { sign_in_provider: "password" } } };
    await expect(requireWorkAuth(auth, async () => ({ ...registeredProfile, role }))).resolves.toEqual(auth);
  });

  it("uses the current role and revokes an existing session when the account is disabled", async () => {
    const auth = { uid, token: { role: "employee_manager", auth_time: 100, isDemo: true, demoDatasetId: "demo-set" } };
    let profile = { ...registeredProfile, role: "employee_manager" };
    const read = vi.fn(async () => profile);
    expect((await requireWorkAuth(auth, read)).token.role).toBe("employee_manager");
    profile = { ...profile, role: "employee" };
    expect(await requireWorkAuth(auth, read)).toEqual({ ...auth, token: { ...auth.token, role: "employee" } });
    expect(auth.token.role).toBe("employee_manager");
    profile = { ...profile, active: false };
    await expectReason(requireWorkAuth(auth, read), "work-account-unavailable");
  });

  it("checks current profile state even when an old ID token has no reset claim", async () => {
    const auth = { uid, token: { role: "employee" } };
    let profile = { ...registeredProfile, passwordChangeRequired: false };
    const read = vi.fn(async () => profile);
    expect(await requireWorkAuth(auth, read)).toEqual(auth);
    profile = { ...profile, passwordChangeRequired: true };
    await expectReason(requireWorkAuth(auth, read), "password-change-required");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("rejects old temporary-password tokens after completion and allows only a newer login", async () => {
    const cutoff = 100;
    const read = async () => ({ ...registeredProfile, passwordChangeRequired: false, passwordAuthTimeAfter: cutoff });
    for (const authTime of [99, 100, undefined]) {
      await expectReason(requireWorkAuth({ uid, token: { auth_time: authTime } }, read), "recent-login-required");
    }
    await expect(requireWorkAuth({ uid, token: { auth_time: 101 } }, read)).resolves.toMatchObject({ uid });
    await expectReason(requireWorkAuth({ uid, token: { auth_time: 101 } }, async () => ({ ...registeredProfile, passwordAuthTimeAfter: "bad" })), "recent-login-required");
  });

  it("allows legacy profiles without a flag and fails closed when the read fails", async () => {
    const auth = { uid, token: {} };
    expect(await requireWorkAuth(auth, async () => registeredProfile)).toEqual({ uid, token: { role: "employee" } });
    await expect(requireWorkAuth(auth, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    const read = vi.fn();
    await expect(requireWorkAuth(undefined, read)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(read).not.toHaveBeenCalled();
  });

  it("gates every exported work callable and the shared business handler", () => {
    const index = readFileSync("src/index.ts", "utf8");
    const callables = index.split(/export const \w+ = onCall\(/).slice(1);
    expect(callables.length).toBeGreaterThan(40);
    for (const callable of callables) {
      expect(callable.includes("await requireAuth(request.auth)") || callable.includes("completePasswordSetup(request.auth")).toBe(true);
    }
    const business = readFileSync("src/business/index.ts", "utf8");
    expect(business.indexOf("await requireWorkAuth(request.auth")).toBeLessThan(business.indexOf("return await service()[method]"));
    expect(business).not.toMatch(/onCall\([^;]*async\s*\(/);
  });
});

describe("complete initial password change", () => {
  it("updates only the existing Auth password, clears the gate after success and removes secret hashes", async () => {
    const f = fixture();
    await expect(f.call()).resolves.toEqual({ success: true });
    expect(f.updateUser).toHaveBeenCalledOnce();
    expect(f.updateUser).toHaveBeenCalledWith(uid, { password: chosen });
    expect(f.state.get(profilePath)).toMatchObject({ uid, email: "employee@example.com", active: true, role: "employee", passwordChangeRequired: false, passwordResetId: "reset-1" });
    const completed = f.state.get(setupPath)!;
    expect(completed.status).toBe("completed");
    const cutoff = f.state.get(profilePath)!.passwordAuthTimeAfter;
    expect(cutoff).toBe(completed.completedAt.seconds);
    expect(f.dependencies.now().seconds).toBeGreaterThan(cutoff);
    expect(f.wait).toHaveBeenCalledOnce();
    expect(f.wait.mock.calls[0][0]).toBeLessThanOrEqual(1050);
    for (const field of ["salt", "temporaryPasswordHash", "chosenPasswordHash", "operationId", "leaseUntil"]) expect(completed[field]).toBeUndefined();
    expect(JSON.stringify([...f.state.values()])).not.toContain(chosen);
  });

  it("preserves whitespace and rejects short, oversized and temporary passwords before changing Auth", async () => {
    const f = fixture();
    await expectReason(f.call("12345"), "password-too-short");
    await expectReason(f.call("x".repeat(129)), "password-too-long");
    await expectReason(f.call(temporary), "password-matches-temporary");
    expect(f.updateUser).not.toHaveBeenCalled();
    await expect(f.call(" a b c ")).resolves.toEqual({ success: true });
    expect(f.updateUser).toHaveBeenCalledWith(uid, { password: " a b c " });
  });

  it.each(["before-issuance", "too-old", "future", "missing"])("requires a recent login after issuance: %s", async (kind) => {
    const f = fixture();
    if (kind === "before-issuance") f.auth.token.auth_time = (f.auth.token.auth_time as number) - 2;
    if (kind === "too-old") f.advance(301000);
    if (kind === "future") f.auth.token.auth_time = (f.auth.token.auth_time as number) + 31;
    if (kind === "missing") delete f.auth.token.auth_time;
    await expectReason(f.call(), "recent-login-required");
    expect(f.updateUser).not.toHaveBeenCalled();
  });

  it("rejects an expired setup and an issuance still in progress", async () => {
    const f = fixture();
    f.state.get(setupPath)!.status = "issuing";
    await expectReason(f.call(), "password-setup-not-ready");
    f.state.get(setupPath)!.status = "required";
    f.advance(86400001);
    await expectReason(f.call(), "password-setup-expired");
    expect(f.updateUser).not.toHaveBeenCalled();
  });

  it.each(["missing-profile", "inactive", "other-role", "wrong-uid", "other-reset", "missing-setup"])("rejects an invalid account/setup: %s", async (kind) => {
    const f = fixture();
    if (kind === "missing-profile") f.state.delete(profilePath);
    if (kind === "inactive") f.state.get(profilePath)!.active = false;
    if (kind === "other-role") f.state.get(profilePath)!.role = "employee_manager";
    if (kind === "wrong-uid") f.state.get(profilePath)!.uid = "someone-else";
    if (kind === "other-reset") f.state.get(profilePath)!.passwordResetId = "newer-reset";
    if (kind === "missing-setup") f.state.delete(setupPath);
    await expectReason(f.call(), "password-setup-unavailable");
    expect(f.updateUser).not.toHaveBeenCalled();
  });

  it("rejects concurrent attempts while one Auth change is running", async () => {
    const f = fixture();
    const pending = deferred();
    f.updateUser.mockReturnValueOnce(pending.promise);
    const first = f.call();
    await vi.waitFor(() => expect(f.updateUser).toHaveBeenCalledOnce());
    await expectReason(f.call(), "password-change-in-progress");
    await expectReason(f.call("different-password"), "password-change-conflict");
    expect(f.state.get(profilePath)!.passwordChangeRequired).toBe(true);
    pending.resolve({ uid });
    await expect(first).resolves.toEqual({ success: true });
    expect(f.updateUser).toHaveBeenCalledOnce();
  });

  it("retains the gate after ambiguous Auth failure and only retries the same chosen password after the lease", async () => {
    const f = fixture();
    f.updateUser.mockRejectedValueOnce(new Error(`transport error containing ${chosen}`));
    const result = f.call();
    await expectReason(result, "password-change-retry-same-password");
    await expect(result).rejects.not.toMatchObject({ message: expect.stringContaining(chosen) });
    expect(f.state.get(profilePath)!.passwordChangeRequired).toBe(true);
    expect(f.state.get(setupPath)!.status).toBe("changing");
    await expectReason(f.call(), "password-change-in-progress");
    f.advance(PASSWORD_CHANGE_LEASE_MS + 1);
    await expectReason(f.call("another-password"), "password-change-conflict");
    await expect(f.call()).resolves.toEqual({ success: true });
    expect(f.updateUser).toHaveBeenCalledTimes(2);
    expect(f.updateUser.mock.calls[1]).toEqual([uid, { password: chosen }]);
  });

  it("keeps the gate if Auth succeeds but Firestore completion fails, then repairs with the same password", async () => {
    const f = fixture();
    f.failTransaction(2);
    await expectReason(f.call(), "password-change-retry-same-password");
    expect(f.updateUser).toHaveBeenCalledOnce();
    expect(f.state.get(profilePath)!.passwordChangeRequired).toBe(true);
    f.advance(PASSWORD_CHANGE_LEASE_MS + 1);
    await expect(f.call()).resolves.toEqual({ success: true });
    expect(f.state.get(profilePath)!.passwordChangeRequired).toBe(false);
  });

  it("finishes an already-started same-password retry even if the setup expires during ambiguous completion", async () => {
    const f = fixture();
    f.state.get(setupPath)!.expiresAt = Timestamp.fromMillis(f.dependencies.now().toMillis() + 1000);
    f.failTransaction(2);
    await expectReason(f.call(), "password-change-retry-same-password");
    f.advance(PASSWORD_CHANGE_LEASE_MS + 1);
    await expect(f.call()).resolves.toEqual({ success: true });
    expect(f.state.get(profilePath)!.passwordChangeRequired).toBe(false);
  });

  it("releases a definitively rejected password attempt so another choice can be made", async () => {
    const f = fixture();
    f.updateUser.mockRejectedValueOnce({ code: "auth/invalid-password", message: chosen });
    await expectReason(f.call(), "password-policy");
    expect(f.state.get(setupPath)!.status).toBe("required");
    expect(f.state.get(setupPath)!.chosenPasswordHash).toBeUndefined();
    expect(f.state.get(profilePath)!.passwordChangeRequired).toBe(true);
    await expect(f.call("another-good-password")).resolves.toEqual({ success: true });
  });

  it("returns idempotent success after completion without changing Auth again", async () => {
    const f = fixture();
    await f.call();
    await expect(f.call("another-input-to-be-verified-by-client-sign-in")).resolves.toEqual({ success: true });
    expect(f.updateUser).toHaveBeenCalledOnce();
    expect(f.wait).toHaveBeenCalledOnce();
  });

  it("cannot clear a newer reset generation after an older Auth attempt completes", async () => {
    const f = fixture();
    const pending = deferred();
    f.updateUser.mockReturnValueOnce(pending.promise);
    const first = f.call();
    await vi.waitFor(() => expect(f.updateUser).toHaveBeenCalledOnce());
    f.state.get(profilePath)!.passwordResetId = "reset-2";
    f.state.get(setupPath)!.resetId = "reset-2";
    pending.resolve({ uid });
    await expectReason(first, "password-change-retry-same-password");
    expect(f.state.get(profilePath)!.passwordChangeRequired).toBe(true);
  });
});
