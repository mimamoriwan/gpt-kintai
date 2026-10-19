import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Auth } from "firebase-admin/auth";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_RECOVERY_TTL_MS, changeAccountEmail, completeAccountRecovery, getAccountManagement, setAccountRecovery, type AccountRecoveryDependencies } from "./accountRecovery.js";
import { requireWorkAuth, type PasswordAuthContext } from "./passwordChange.js";

const owner = "owner";
const employee = "employee";
const president = "president";
const password = "chosen-long-password";
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
function fixture() {
  let time = Date.parse("2026-09-27T03:00:00Z");
  let tokenNumber = 0;
  let operationNumber = 0;
  let transactionNumber = 0;
  let failTransactionNumber = 0;
  const state = new Map<string, Record<string, any>>([
    ["accountManagement/config", { ownerUid: owner, managedUids: [owner, employee, president] }],
    ...[[owner, "employee_manager"], [employee, "employee"], [president, "president_viewer"]].map(([uid, role]) =>
      [`users/${uid}`, { uid, email: `${uid}@example.com`, displayName: uid, active: true, role }] as [string, Record<string, any>]),
    [`cocoMembers/${owner}`, { uid: owner, email: "corporate@example.com", authEmail: "owner@example.com", role: "manager" }]
  ]);
  const records = new Map([owner, employee, president].map((uid) => [uid, { uid, email: `${uid}@example.com`, disabled: false, providerData: [{ providerId: "google.com", email: "corporate@example.com" }] }]));
  const snapshot = (path: string) => ({ exists: state.has(path), data: () => state.has(path) ? { ...state.get(path)! } : undefined });
  let queue: Promise<unknown> = Promise.resolve();
  const db = {
    doc: (path: string) => ({ path, get: async () => snapshot(path) }),
    runTransaction: (work: (transaction: unknown) => Promise<unknown>) => {
      const result = queue.then(async () => {
        const number = ++transactionNumber;
        const writes: { method: string; path: string; data?: Record<string, unknown> }[] = [];
        let wrote = false;
        const transaction = {
          get: async (ref: { path: string }) => { if (wrote) throw new Error("read after write"); return snapshot(ref.path); },
          update: (ref: { path: string }, data: Record<string, unknown>) => { wrote = true; writes.push({ method: "update", path: ref.path, data }); },
          set: (ref: { path: string }, data: Record<string, unknown>) => { wrote = true; writes.push({ method: "set", path: ref.path, data }); },
          delete: (ref: { path: string }) => { wrote = true; writes.push({ method: "delete", path: ref.path }); }
        };
        const value = await work(transaction);
        if (number === failTransactionNumber) throw new Error("simulated commit failure");
        for (const write of writes) {
          if (write.method === "delete") { state.delete(write.path); continue; }
          if (write.method === "update" && !state.has(write.path)) throw new Error("updating absent doc");
          const next = write.method === "set" ? {} : { ...state.get(write.path) };
          for (const [key, value] of Object.entries(write.data!)) {
            if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) delete next[key];
            else next[key] = value;
          }
          state.set(write.path, next);
        }
        return value;
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    }
  } as unknown as Firestore;
  const getUser = vi.fn(async (uid: string) => { const record = records.get(uid); if (!record) throw { code: "auth/user-not-found" }; return { ...record }; });
  const updateUser = vi.fn(async (uid: string, update: Record<string, any>) => { records.set(uid, { ...records.get(uid)!, ...update }); return records.get(uid); });
  const revokeRefreshTokens = vi.fn(async (_uid: string) => undefined);
  const now = () => Timestamp.fromMillis(time);
  const wait = vi.fn(async (ms: number) => { time += ms; });
  const dependencies: AccountRecoveryDependencies = {
    db, auth: { getUser, updateUser, revokeRefreshTokens } as unknown as Pick<Auth, "getUser" | "updateUser" | "revokeRefreshTokens">,
    now, wait, token: () => (++tokenNumber).toString().padStart(43, "a"), operationId: () => `operation-${++operationNumber}`
  };
  const auth: PasswordAuthContext = { uid: owner, token: { auth_time: Math.floor(time / 1000), role: "employee_manager" } };
  return {
    state, records, dependencies, auth, getUser, updateUser, revokeRefreshTokens, wait,
    issue: (uid = employee) => setAccountRecovery(auth, { uid, enabled: true }, dependencies),
    off: (uid = employee) => setAccountRecovery(auth, { uid, enabled: false }, dependencies),
    list: () => getAccountManagement(auth, {}, dependencies),
    complete: (token: string, newPassword: unknown = password) => completeAccountRecovery(undefined, { token, newPassword }, dependencies),
    email: (uid = employee, email = "new@example.com") => changeAccountEmail(auth, { uid, email }, dependencies),
    advance: (ms: number) => { time += ms; },
    reauth: () => { auth.token.auth_time = Math.floor(time / 1000); },
    failAfter: (transactions: number) => { failTransactionNumber = transactionNumber + transactions; }
  };
}
async function reason(promise: Promise<unknown>, expected: string) { await expect(promise).rejects.toMatchObject({ details: { reason: expected } }); }
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>((done) => { resolve = done; }); return { promise, resolve }; }

describe("owner-only account management", () => {
  it("returns exactly configured accounts and never secret fields", async () => {
    const f = fixture();
    const issued = await f.issue();
    const result = await f.list();
    expect(result.canManage).toBe(true);
    expect(result.accounts!.map((item) => item.uid)).toEqual([owner, employee, president]);
    expect(result.accounts![1]).toMatchObject({ email: "employee@example.com", recovery: { status: "enabled", expiresAt: issued.expiresAt } });
    expect(JSON.stringify(result)).not.toContain(issued.token);
    expect(JSON.stringify(result)).not.toContain(digest(issued.token!));
  });

  it.each(["employee", "president", "other-manager", "profile-demo", "token-demo"])("rejects %s despite a manager token", async (kind) => {
    const f = fixture();
    if (kind === "employee" || kind === "president") f.auth.uid = kind;
    if (kind === "other-manager") { f.auth.uid = "outsider"; f.state.set("users/outsider", { uid: "outsider", active: true, role: "employee_manager" }); }
    if (kind === "profile-demo") f.state.get(`users/${owner}`)!.isDemo = true;
    if (kind === "token-demo") f.auth.token.isDemo = true;
    await expect(f.list()).resolves.toEqual({ canManage: false });
    await reason(f.issue(), "account-management-forbidden");
    await reason(f.email(), "account-management-forbidden");
    expect(f.updateUser).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { ownerUid: owner, managedUids: [owner, employee] }, { ownerUid: owner, managedUids: [employee, president, "outsider"] }, { ownerUid: owner, managedUids: [owner, employee, employee] }])("fails closed on invalid configuration %j", async (config) => {
    const f = fixture();
    if (config) f.state.set("accountManagement/config", config); else f.state.delete("accountManagement/config");
    await expect(f.list()).resolves.toEqual({ canManage: false });
    await reason(f.issue(), "account-management-forbidden");
  });

  it.each(["profile-disabled", "auth-disabled", "auth-missing", "required", "stale"])("rejects an unavailable owner: %s", async (kind) => {
    const f = fixture();
    if (kind === "profile-disabled") f.state.get(`users/${owner}`)!.active = false;
    if (kind === "auth-disabled") f.records.get(owner)!.disabled = true;
    if (kind === "auth-missing") f.records.delete(owner);
    if (kind === "required") f.state.get(`users/${owner}`)!.passwordChangeRequired = true;
    if (kind === "stale") f.state.get(`users/${owner}`)!.passwordAuthTimeAfter = f.auth.token.auth_time;
    await expect(f.issue()).rejects.toBeDefined();
    expect(f.updateUser).not.toHaveBeenCalled();
  });

  it("requires recent login for mutations, while listing permits an older valid session", async () => {
    const f = fixture(); f.advance(301000);
    await expect(f.list()).resolves.toMatchObject({ canManage: true });
    await reason(f.issue(), "recent-login-required");
    await reason(f.email(), "recent-login-required");
    f.reauth(); await expect(f.issue()).resolves.toHaveProperty("token");
  });

  it.each(["outsider", "profile-missing", "profile-wrong-uid", "profile-inactive", "profile-demo", "auth-disabled", "auth-missing"])("does not auto-enrol or alter invalid target: %s", async (kind) => {
    const f = fixture();
    if (kind === "profile-missing") f.state.delete(`users/${employee}`);
    if (kind === "profile-wrong-uid") f.state.get(`users/${employee}`)!.uid = "different";
    if (kind === "profile-inactive") f.state.get(`users/${employee}`)!.active = false;
    if (kind === "profile-demo") f.state.get(`users/${employee}`)!.isDemo = true;
    if (kind === "auth-disabled") f.records.get(employee)!.disabled = true;
    if (kind === "auth-missing") f.records.delete(employee);
    await reason(f.issue(kind === "outsider" ? "outsider" : employee), "managed-account-unavailable");
    expect(f.updateUser).not.toHaveBeenCalled();
  });
});

describe("one-use recovery grants", () => {
  it("stores only hashed 30-minute grants, regenerates and cancels without changing credentials", async () => {
    const f = fixture();
    const first = await f.issue();
    expect(first.token).toHaveLength(43);
    expect(Date.parse(first.expiresAt!) - f.dependencies.now!().toMillis()).toBe(ACCOUNT_RECOVERY_TTL_MS);
    expect(JSON.stringify([...f.state.values()])).not.toContain(first.token);
    const second = await f.issue();
    expect(second.token).not.toBe(first.token);
    await reason(f.complete(first.token!), "recovery-link-unavailable");
    await f.off();
    await reason(f.complete(second.token!), "recovery-link-unavailable");
    expect(f.updateUser).not.toHaveBeenCalled();
    expect(f.state.get(`users/${employee}`)!.passwordChangeRequired).toBeUndefined();
  });

  it("rejects expired and malformed links without returning an email", async () => {
    const f = fixture(); const { token } = await f.issue(); f.advance(ACCOUNT_RECOVERY_TTL_MS);
    await reason(f.complete(token!), "recovery-link-unavailable");
    await reason(f.complete("invalid"), "recovery-link-unavailable");
    const list = await f.list(); expect(list.accounts![1].recovery.status).toBe("expired");
    expect(f.updateUser).not.toHaveBeenCalled();
  });

  it.each([owner, employee, president])("resets %s and revokes old work sessions with a final post-write cutoff", async (uid) => {
    const f = fixture(); const { token } = await f.issue(uid);
    const before = f.dependencies.now!().seconds;
    f.updateUser.mockImplementationOnce(async (_uid, update) => {
      expect(f.state.get(`users/${uid}`)!.passwordChangeRequired).toBe(true);
      expect(f.state.get(`users/${uid}`)!.passwordAuthTimeAfter).toBe(before);
      f.advance(2500); return { ...f.records.get(uid)!, ...update };
    });
    await expect(f.complete(token!)).resolves.toEqual({ email: `${uid}@example.com` });
    expect(f.updateUser).toHaveBeenCalledWith(uid, { password });
    expect(f.revokeRefreshTokens).toHaveBeenCalledWith(uid);
    const profile = f.state.get(`users/${uid}`)!;
    expect(profile.passwordChangeRequired).toBe(false);
    expect(profile.passwordAuthTimeAfter).toBeGreaterThan(before);
    expect(f.dependencies.now!().seconds).toBeGreaterThan(profile.passwordAuthTimeAfter);
    await reason(requireWorkAuth({ uid, token: { auth_time: before } }, async () => profile), "recent-login-required");
    await expect(requireWorkAuth({ uid, token: { auth_time: f.dependencies.now!().seconds } }, async () => profile)).resolves.toMatchObject({ uid });
    await expect(f.complete(token!)).resolves.toEqual({ email: `${uid}@example.com` });
    expect(f.updateUser).toHaveBeenCalledOnce();
    await reason(f.complete(token!, "different-long-password"), "recovery-link-unavailable");
    expect(JSON.stringify([...f.state.values()])).not.toContain(password);
    expect(f.state.get(`accountOperations/${uid}`)).not.toHaveProperty("passwordHash");
    expect(f.state.get(`accountRecoveryTokens/${digest(token!)}`)!.status).toBe("completed");
  });

  it("checks target availability again when a grant is consumed or a success receipt replayed", async () => {
    const f = fixture(); const { token } = await f.issue();
    f.records.get(employee)!.disabled = true;
    await reason(f.complete(token!), "recovery-link-unavailable");
    expect(f.updateUser).not.toHaveBeenCalled();
    f.records.get(employee)!.disabled = false; await f.complete(token!);
    f.state.get(`users/${employee}`)!.active = false;
    await reason(f.complete(token!), "recovery-link-unavailable");
    expect(f.updateUser).toHaveBeenCalledOnce();
  });

  it("preserves spaces, enforces 12–128 characters and does not log secret Auth errors", async () => {
    const f = fixture(); const { token } = await f.issue();
    for (const value of ["12345678901", "x".repeat(129), null]) await reason(f.complete(token!, value), "password-policy");
    f.updateUser.mockRejectedValueOnce(new Error(`sensitive-${password}`));
    const result = f.complete(token!, ` ${password} `);
    await reason(result, "recovery-retry-same-password");
    await expect(result).rejects.not.toMatchObject({ message: expect.stringContaining(password) });
    expect(f.updateUser).toHaveBeenCalledWith(employee, { password: ` ${password} ` });
  });

  it("supersedes a pending initial setup and blocks a legacy setup already changing/issuing", async () => {
    const f = fixture(); const { token } = await f.issue();
    f.state.get(`users/${employee}`)!.passwordChangeRequired = true;
    f.state.get(`users/${employee}`)!.passwordResetId = "old-reset";
    f.state.set(`passwordSetups/${employee}`, { status: "required", resetId: "old-reset", salt: "secret", temporaryPasswordHash: "secret" });
    await f.complete(token!);
    expect(f.state.get(`passwordSetups/${employee}`)).toMatchObject({ status: "superseded" });
    expect(f.state.get(`passwordSetups/${employee}`)).not.toHaveProperty("salt");
    expect(f.state.get(`users/${employee}`)).not.toHaveProperty("passwordResetId");
    for (const status of ["changing", "issuing"]) {
      const other = fixture(); const link = await other.issue(); other.state.set(`passwordSetups/${employee}`, { status });
      await reason(other.complete(link.token!), "account-change-in-progress");
      await reason(other.issue(), "account-change-in-progress");
    }
  });

  it("never takes over a running worker, even after expiry, and blocks OFF, renewal and email", async () => {
    const f = fixture(); const { token } = await f.issue(); const pending = deferred();
    f.updateUser.mockReturnValueOnce(pending.promise);
    const first = f.complete(token!);
    await vi.waitFor(() => expect(f.updateUser).toHaveBeenCalledOnce());
    f.advance(ACCOUNT_RECOVERY_TTL_MS + 1000); f.reauth();
    await reason(f.complete(token!), "account-change-in-progress");
    await reason(f.complete(token!, "different-long-password"), "recovery-password-mismatch");
    await reason(f.off(), "account-change-in-progress");
    await reason(f.issue(), "account-change-in-progress");
    await reason(f.email(), "account-change-in-progress");
    pending.resolve(f.records.get(employee));
    await expect(first).resolves.toHaveProperty("email");
    expect(f.updateUser).toHaveBeenCalledOnce();
  });

  it.each(["auth", "revocation", "final-commit"])("recovers partial %s failure only using the same password, even after link expiry", async (stage) => {
    const f = fixture(); const { token } = await f.issue();
    if (stage === "auth") f.updateUser.mockRejectedValueOnce(new Error("transport"));
    if (stage === "revocation") f.revokeRefreshTokens.mockRejectedValueOnce(new Error("transport"));
    if (stage === "final-commit") f.failAfter(2);
    await reason(f.complete(token!), "recovery-retry-same-password");
    expect(f.state.get(`users/${employee}`)!.passwordChangeRequired).toBe(true);
    expect(f.state.get(`accountOperations/${employee}`)!.status).toBe("retryable");
    f.advance(ACCOUNT_RECOVERY_TTL_MS + 1000); f.reauth();
    await reason(f.off(), "account-change-in-progress");
    await reason(f.complete(token!, "different-long-password"), "recovery-password-mismatch");
    await expect(f.complete(token!)).resolves.toEqual({ email: "employee@example.com" });
    expect(f.updateUser.mock.calls.every((call) => call[1].password === password)).toBe(true);
  });

  it.each([owner, employee])("restores the prior gate for %s on a definitive first-attempt password-policy rejection", async (uid) => {
    const f = fixture(); const { token } = await f.issue(uid);
    f.updateUser.mockRejectedValueOnce({ code: "auth/password-does-not-meet-requirements" });
    await reason(f.complete(token!), "password-policy");
    expect(f.state.get(`users/${uid}`)!).not.toHaveProperty("passwordChangeRequired");
    expect(f.state.get(`users/${uid}`)!).not.toHaveProperty("passwordAuthTimeAfter");
    await expect(f.complete(token!, "another-valid-password")).resolves.toHaveProperty("email");
  });

  it("restores the exact pre-existing initial setup when Auth definitively rejects the password", async () => {
    const f = fixture();
    const setup = { status: "required", resetId: "initial", salt: "private-salt", temporaryPasswordHash: "private-hash" };
    f.state.set(`passwordSetups/${employee}`, setup);
    Object.assign(f.state.get(`users/${employee}`)!, { passwordChangeRequired: true, passwordResetId: "initial", passwordAuthTimeAfter: 99 });
    const { token } = await f.issue();
    f.updateUser.mockRejectedValueOnce({ code: "auth/invalid-password" });
    await reason(f.complete(token!), "password-policy");
    expect(f.state.get(`passwordSetups/${employee}`)).toEqual(setup);
    expect(f.state.get(`users/${employee}`)).toMatchObject({ passwordChangeRequired: true, passwordResetId: "initial", passwordAuthTimeAfter: 99 });
    await f.off();
    expect(f.state.get(`users/${employee}`)!.passwordChangeRequired).toBe(true);
  });

  it("never restores old access after an uncertain write followed by a policy rejection", async () => {
    const f = fixture(); const { token } = await f.issue();
    f.updateUser.mockRejectedValueOnce(new Error("ambiguous"));
    await reason(f.complete(token!), "recovery-retry-same-password");
    f.updateUser.mockRejectedValueOnce({ code: "auth/invalid-password" });
    await reason(f.complete(token!), "recovery-retry-same-password");
    expect(f.state.get(`users/${employee}`)!.passwordChangeRequired).toBe(true);
    expect(f.state.get(`accountOperations/${employee}`)!.status).toBe("retryable");
    await reason(f.complete(token!, "other-long-password"), "recovery-password-mismatch");
  });

  it("bounds success receipts by expiry and invalidates them on reissuance or OFF", async () => {
    const f = fixture(); const first = await f.issue(); await f.complete(first.token!);
    await expect(f.complete(first.token!)).resolves.toHaveProperty("email");
    await f.off(); await reason(f.complete(first.token!), "recovery-link-unavailable");
    const second = await f.issue(); await f.complete(second.token!);
    await f.issue(); await reason(f.complete(second.token!), "recovery-link-unavailable");
    const third = await f.issue(); await f.complete(third.token!);
    f.advance(ACCOUNT_RECOVERY_TTL_MS); await reason(f.complete(third.token!), "recovery-link-unavailable");
  });

  it("never writes Auth if the gate transaction fails", async () => {
    const f = fixture(); const { token } = await f.issue(); f.failAfter(1);
    await reason(f.complete(token!), "account-management-unavailable");
    expect(f.updateUser).not.toHaveBeenCalled();
    expect(f.state.get(`users/${employee}`)!.passwordChangeRequired).toBeUndefined();
  });
});

describe("login-email consistency", () => {
  it("synchronizes Auth, users and COCO authEmail, preserving company email and Google identity", async () => {
    const f = fixture(); const oldProviders = f.records.get(owner)!.providerData;
    await expect(f.email(owner, " NEW@example.com ")).resolves.toEqual({ success: true });
    expect(f.updateUser).toHaveBeenCalledWith(owner, { email: "new@example.com", emailVerified: false });
    expect(f.records.get(owner)!.email).toBe("new@example.com");
    expect(f.records.get(owner)!.providerData).toEqual(oldProviders);
    expect(f.state.get(`users/${owner}`)).toMatchObject({ email: "new@example.com", role: "employee_manager", active: true });
    expect(f.state.get(`cocoMembers/${owner}`)).toMatchObject({ email: "corporate@example.com", authEmail: "new@example.com" });
    expect(f.state.get(`users/${owner}`)!.passwordChangeRequired).toBeUndefined();
    await reason(f.list(), "recent-login-required");
    f.reauth(); await expect(f.list()).resolves.toMatchObject({ canManage: true });
  });

  it("invalidates an outstanding reset link when changing email", async () => {
    const f = fixture(); const { token } = await f.issue();
    await f.email(); await reason(f.complete(token!), "recovery-link-unavailable");
  });

  it("shares the per-account lock with recovery and other email changes", async () => {
    const f = fixture(); const pending = deferred(); f.updateUser.mockReturnValueOnce(pending.promise);
    const first = f.email(); await vi.waitFor(() => expect(f.updateUser).toHaveBeenCalledOnce());
    await reason(f.issue(), "account-change-in-progress");
    await reason(f.off(), "account-change-in-progress");
    await reason(f.email(employee, "another@example.com"), "account-change-in-progress");
    await reason(f.email(), "account-change-in-progress");
    expect((await f.list()).accounts![1].emailChangePending).toBe(true);
    expect((await f.list()).accounts![1].pendingEmail).toBe("new@example.com");
    pending.resolve({ ...f.records.get(employee), email: "new@example.com" });
    await first;
  });

  it.each(["auth", "revocation", "final-commit"])("lets owner resume own exact-email change after %s failure without losing access", async (stage) => {
    const f = fixture();
    if (stage === "auth") f.updateUser.mockRejectedValueOnce(new Error("transport"));
    if (stage === "revocation") f.revokeRefreshTokens.mockRejectedValueOnce(new Error("transport"));
    if (stage === "final-commit") f.failAfter(2);
    await reason(f.email(owner), "email-change-retry-same-address");
    await expect(f.list()).resolves.toMatchObject({ canManage: true });
    expect((await f.list()).accounts!.find(account => account.uid === owner)).toMatchObject({ emailChangePending: true, pendingEmail: "new@example.com" });
    expect(f.state.get(`users/${owner}`)).not.toHaveProperty("passwordAuthTimeAfter");
    expect(f.state.get(`users/${owner}`)).not.toHaveProperty("passwordChangeRequired");
    await reason(f.email(owner, "other@example.com"), "account-change-in-progress");
    await reason(f.issue(owner), "account-change-in-progress");
    await expect(f.email(owner)).resolves.toEqual({ success: true });
    expect(f.records.get(owner)!.email).toBe("new@example.com");
    expect(f.state.get(`cocoMembers/${owner}`)!.authEmail).toBe("new@example.com");
    expect(f.state.get(`cocoMembers/${owner}`)!.email).toBe("corporate@example.com");
  });

  it("fails closed on inconsistent existing identity mappings", async () => {
    const f = fixture(); f.state.get(`cocoMembers/${owner}`)!.authEmail = "unrelated@example.com";
    await reason(f.email(owner), "account-email-inconsistent"); expect(f.updateUser).not.toHaveBeenCalled();
  });

  it("releases a definitively rejected email and keeps sensitive error details private", async () => {
    const f = fixture(); f.updateUser.mockRejectedValueOnce({ code: "auth/email-already-exists", message: "private details" });
    const attempt = f.email(); await reason(attempt, "account-email-rejected");
    await expect(attempt).rejects.not.toMatchObject({ message: expect.stringContaining("private details") });
    await expect(f.email(employee, "different@example.com")).resolves.toEqual({ success: true });
  });
});

describe("callable deployment boundary", () => {
  it("requires App Check for all 4 public callables and resolves Admin dependencies lazily", () => {
    const source = readFileSync("src/accountRecoveryEndpoints.ts", "utf8");
    expect(source).toContain('enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true"');
    expect(source.match(/onCall\(options,/g)).toHaveLength(4);
    expect(source).toContain("function dependencies() { return { db: getFirestore(), auth: getAuth() }; }");
    expect(source).not.toMatch(/const\s+\w+\s*=\s*getFirestore\(/);
  });
});
