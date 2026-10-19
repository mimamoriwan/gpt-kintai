import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeAccountEmail, completeAccountRecovery, getAccountManagement, reauthenticateAccountManager, setAccountRecovery } from "./accountManagement";

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as null | { email: string; getIdToken: (force: boolean) => Promise<string> } },
  prepare: vi.fn(), preparePublic: vi.fn(), invoke: vi.fn(), signOut: vi.fn(), credential: vi.fn(), reauthenticate: vi.fn(), token: vi.fn(), callable: vi.fn()
}));
vi.mock("../firebase", () => ({ auth: mocks.auth, functions: {}, prepareCallableSecurityContext: mocks.prepare, preparePublicCallableSecurityContext: mocks.preparePublic }));
vi.mock("firebase/functions", () => ({ httpsCallable: mocks.callable }));
vi.mock("firebase/auth", () => ({ signOut: mocks.signOut, EmailAuthProvider: { credential: mocks.credential }, reauthenticateWithCredential: mocks.reauthenticate }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.currentUser = { email: "owner@example.com", getIdToken: mocks.token };
  mocks.prepare.mockResolvedValue(undefined);
  mocks.preparePublic.mockResolvedValue(undefined);
  mocks.callable.mockReturnValue(mocks.invoke);
  mocks.invoke.mockResolvedValue({ data: { canManage: true, accounts: [], success: true, email: "member@example.com" } });
  mocks.signOut.mockImplementation(async () => { mocks.auth.currentUser = null; });
  mocks.credential.mockReturnValue({ credential: true });
  mocks.reauthenticate.mockResolvedValue(undefined);
  mocks.token.mockResolvedValue("new-id-token");
});

describe("account management callable security", () => {
  it("uses authenticated security checks for all administrative operations", async () => {
    await getAccountManagement();
    await setAccountRecovery("member", true);
    await changeAccountEmail("member", "new@example.com");
    expect(mocks.prepare).toHaveBeenCalledTimes(3);
    expect(mocks.preparePublic).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls).toEqual([[{}], [{ uid: "member", enabled: true }], [{ uid: "member", email: "new@example.com" }]]);
  });

  it("detaches a signed-in session before the explicit public password reset request", async () => {
    await expect(completeAccountRecovery("token", "chosen-password")).resolves.toMatchObject({ email: "member@example.com" });
    expect(mocks.signOut).toHaveBeenCalledWith(mocks.auth);
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(mocks.preparePublic.mock.invocationCallOrder[0]);
    expect(mocks.preparePublic).toHaveBeenCalledWith(false);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith({ token: "token", newPassword: "chosen-password" });
  });

  it("allows signed-out recovery and does not proceed if clearing the old session fails", async () => {
    mocks.auth.currentUser = null;
    await completeAccountRecovery("token", "chosen-password");
    expect(mocks.signOut).not.toHaveBeenCalled();
    mocks.auth.currentUser = { email: "owner@example.com", getIdToken: mocks.token };
    mocks.signOut.mockRejectedValue(new Error("signout failed"));
    await expect(completeAccountRecovery("token", "chosen-password")).rejects.toThrow("signout failed");
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it("never sends a callable if App Check is unavailable", async () => {
    mocks.auth.currentUser = null;
    mocks.preparePublic.mockRejectedValue({ code: "appCheck/throttled" });
    await expect(completeAccountRecovery("token", "chosen-password")).rejects.toMatchObject({ code: "appCheck/throttled" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("refreshes the same owner's token after password reauthentication", async () => {
    const user = mocks.auth.currentUser;
    await reauthenticateAccountManager("owner-password");
    expect(mocks.credential).toHaveBeenCalledWith("owner@example.com", "owner-password");
    expect(mocks.reauthenticate).toHaveBeenCalledWith(user, { credential: true });
    expect(mocks.token).toHaveBeenCalledWith(true);
  });

  it("rejects reauthentication if another user replaced the current session", async () => {
    mocks.reauthenticate.mockImplementation(async () => { mocks.auth.currentUser = { email: "other@example.com", getIdToken: mocks.token }; });
    await expect(reauthenticateAccountManager("owner-password")).rejects.toMatchObject({ code: "functions/unauthenticated" });
    expect(mocks.token).not.toHaveBeenCalled();
  });

  it("uses the authoritative email for the same owner when cached Firebase email is stale", async () => {
    const user = mocks.auth.currentUser;
    await reauthenticateAccountManager("owner-password", "owner-new@example.com");
    expect(mocks.credential).toHaveBeenCalledWith("owner-new@example.com", "owner-password");
    expect(mocks.reauthenticate).toHaveBeenCalledWith(user, { credential: true });
    expect(mocks.token).toHaveBeenCalledWith(true);
  });
});
