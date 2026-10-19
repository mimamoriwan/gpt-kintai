import { describe, expect, it, vi } from "vitest";
import { invokeWithVerifiedSecurityContext, isUnauthenticatedCallableError } from "./callable";

describe("callable security context", () => {
  it("prepares security tokens before invoking a callable", async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const invoke = vi.fn().mockResolvedValue("saved");

    await expect(invokeWithVerifiedSecurityContext(prepare, invoke)).resolves.toBe("saved");
    expect(prepare).toHaveBeenCalledWith(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("refreshes both tokens and retries once after an unauthenticated response", async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const invoke = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Unauthenticated"), { code: "functions/unauthenticated" }))
      .mockResolvedValueOnce("saved");

    await expect(invokeWithVerifiedSecurityContext(prepare, invoke)).resolves.toBe("saved");
    expect(prepare.mock.calls).toEqual([[false], [true]]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated failures", async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const error = Object.assign(new Error("Invalid report"), { code: "functions/invalid-argument" });
    const invoke = vi.fn().mockRejectedValue(error);

    await expect(invokeWithVerifiedSecurityContext(prepare, invoke)).rejects.toBe(error);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(isUnauthenticatedCallableError(error)).toBe(false);
  });

  it.each(["appCheck/throttled", "appCheck/initial-throttle", "app-check/throttled"])("does not force-refresh or invoke after %s", async (code) => {
    const error = Object.assign(new Error("App Check backoff"), { code });
    const prepare = vi.fn().mockRejectedValue(error);
    const invoke = vi.fn();
    await expect(invokeWithVerifiedSecurityContext(prepare, invoke)).rejects.toBe(error);
    expect(prepare.mock.calls).toEqual([[false]]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("still refreshes credentials after a recoverable preparation failure", async () => {
    const prepare = vi.fn().mockRejectedValueOnce(new Error("expired token")).mockResolvedValueOnce(undefined);
    const invoke = vi.fn().mockResolvedValue("saved");
    await expect(invokeWithVerifiedSecurityContext(prepare, invoke)).resolves.toBe("saved");
    expect(prepare.mock.calls).toEqual([[false], [true]]);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("stops if credential recovery encounters App Check backoff", async () => {
    const error = Object.assign(new Error("backoff"), { code: "appCheck/throttled" });
    const prepare = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);
    const invoke = vi.fn().mockRejectedValue(Object.assign(new Error("Unauthenticated"), { code: "functions/unauthenticated" }));
    await expect(invokeWithVerifiedSecurityContext(prepare, invoke)).rejects.toBe(error);
    expect(invoke).toHaveBeenCalledOnce();
  });
});
