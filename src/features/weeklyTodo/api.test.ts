import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: "a" } as { uid: string } | null }, prepare: vi.fn(), invoke: vi.fn() }));
vi.mock("../../firebase", () => ({ auth: mocks.auth, functions: {}, prepareCallableSecurityContext: mocks.prepare }));
vi.mock("firebase/functions", () => ({ httpsCallable: (_functions: unknown, name: string) => (input: unknown) => mocks.invoke(name, input) }));
import { getWeeklyTodoWorkspace, shareWeeklyTodo } from "./api";
beforeEach(() => { vi.resetAllMocks(); mocks.auth.currentUser = { uid: "a" }; mocks.prepare.mockResolvedValue(undefined); mocks.invoke.mockResolvedValue({ data: {} }); });
describe("weekly To Do account boundaries", () => {
  it("sends no request after an account switch during authentication preparation", async () => {
    mocks.prepare.mockImplementation(async () => { mocks.auth.currentUser = { uid: "b" }; }); await expect(getWeeklyTodoWorkspace("2026-10-19")).rejects.toMatchObject({ code: "functions/unauthenticated" }); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("discards a response after logout or a replacement session of the same user", async () => {
    mocks.invoke.mockImplementationOnce(async () => { mocks.auth.currentUser = null; return { data: { ownDraft: "private" } }; }); await expect(getWeeklyTodoWorkspace("2026-10-19")).rejects.toThrow();
    mocks.auth.currentUser = { uid: "a" }; mocks.invoke.mockImplementationOnce(async () => { mocks.auth.currentUser = { uid: "a" }; return { data: {} }; }); await expect(getWeeklyTodoWorkspace("2026-10-19")).rejects.toThrow();
  });
  it("retries expired authentication with the same operation and never retries ambiguous failures", async () => {
    const input = { weekStart: "2026-10-19", expectedVersion: 0, operationId: "same-operation", items: [] };
    mocks.invoke.mockRejectedValueOnce({ code: "functions/unauthenticated" }).mockResolvedValueOnce({ data: { version: 1 } }); await expect(shareWeeklyTodo(input)).resolves.toEqual({ version: 1 }); expect(mocks.invoke.mock.calls).toEqual([["shareWeeklyTodo", input], ["shareWeeklyTodo", input]]);
    mocks.invoke.mockClear(); mocks.invoke.mockRejectedValueOnce({ code: "functions/unavailable" }); await expect(shareWeeklyTodo(input)).rejects.toMatchObject({ code: "functions/unavailable" }); expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
