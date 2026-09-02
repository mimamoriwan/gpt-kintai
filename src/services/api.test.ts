import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  prepare: vi.fn(),
  httpsCallable: vi.fn()
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mocks.httpsCallable
}));

vi.mock("../firebase", () => ({
  db: {},
  functions: {},
  prepareCallableSecurityContext: mocks.prepare,
  storage: {}
}));

import { clockIn } from "./api";

describe("attendance callable authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepare.mockResolvedValue(undefined);
    mocks.httpsCallable.mockImplementation((_functions, name: string) =>
      (input: unknown) => mocks.invoke(name, input)
    );
  });

  it("refreshes expired credentials and retries a manual clock-in once", async () => {
    const manual = {
      startedAt: "2026-09-01T23:04:00.000Z",
      reason: "始業打刻を忘れたため"
    };
    mocks.invoke
      .mockRejectedValueOnce(Object.assign(new Error("Unauthenticated"), { code: "functions/unauthenticated" }))
      .mockResolvedValueOnce({ data: { id: "attendance-1" } });

    await expect(clockIn("office", manual)).resolves.toBe("attendance-1");

    expect(mocks.prepare.mock.calls).toEqual([[false], [true]]);
    expect(mocks.invoke.mock.calls).toEqual([
      ["clockIn", { workMode: "office", ...manual }],
      ["clockIn", { workMode: "office", ...manual }]
    ]);
  });
});
