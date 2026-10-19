import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: "yasushi" } as { uid: string } | null },
  prepare: vi.fn(), invoke: vi.fn()
}));
vi.mock("../../firebase", () => ({ auth: mocks.auth, functions: {}, prepareCallableSecurityContext: mocks.prepare }));
vi.mock("firebase/functions", () => ({ httpsCallable: (_functions: unknown, name: string) => (input: unknown) => mocks.invoke(name, input) }));
import { getBusinessWorkspace, setBusinessMilestoneCompletion } from "./api";

describe("business callable account boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentUser = { uid: "yasushi" };
    mocks.prepare.mockResolvedValue(undefined);
    mocks.invoke.mockResolvedValue({ data: { fetchedAt: 123 } });
  });
  it("does not send a request after account changes during credential preparation", async () => {
    mocks.prepare.mockImplementationOnce(async () => { mocks.auth.currentUser = { uid: "president" }; });
    await expect(getBusinessWorkspace()).rejects.toMatchObject({ code: "business/account-changed" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("discards a response after logout", async () => {
    mocks.invoke.mockImplementationOnce(async () => { mocks.auth.currentUser = null; return { data: { themes: ["private"] } }; });
    await expect(getBusinessWorkspace()).rejects.toMatchObject({ code: "business/account-changed" });
  });
  it("also rejects an old session response after signing back into the same uid", async () => {
    mocks.invoke.mockImplementationOnce(async () => { mocks.auth.currentUser = { uid: "yasushi" }; return { data: { themes: ["old session"] } }; });
    await expect(getBusinessWorkspace()).rejects.toMatchObject({ code: "business/account-changed" });
  });
  it("retries an expired credential once with the same desired milestone value and version", async () => {
    mocks.invoke.mockRejectedValueOnce({ code: "functions/unauthenticated" }).mockResolvedValueOnce({ data: { id: "initiative", version: 3 } });
    const input = { initiativeId: "initiative", milestoneId: "stable-step", completed: true, expectedVersion: 2 };
    await expect(setBusinessMilestoneCompletion(input)).resolves.toEqual({ id: "initiative", version: 3 });
    expect(mocks.invoke.mock.calls).toEqual([["setBusinessMilestoneCompletion", input], ["setBusinessMilestoneCompletion", input]]);
    expect(mocks.prepare.mock.calls).toEqual([[false], [true]]);
  });
  it("does not replay writes after a network failure whose outcome is unknown", async () => {
    mocks.invoke.mockRejectedValueOnce({ code: "functions/unavailable" });
    await expect(setBusinessMilestoneCompletion({ initiativeId: "i", milestoneId: "m", completed: false, expectedVersion: 8 })).rejects.toMatchObject({ code: "functions/unavailable" });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("does not send any request without a signed-in user", async () => {
    mocks.auth.currentUser = null;
    await expect(getBusinessWorkspace()).rejects.toMatchObject({ code: "functions/unauthenticated" });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
