import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());

describe("App Check recovery state", () => {
  it.each(["appCheck/throttled", "app-check/throttled", "appCheck/initial-throttle"])("recognizes %s from structured errors and existing raw notifications", async code => {
    const { getAppCheckErrorKind } = await import("./appCheckRecovery");
    expect(getAppCheckErrorKind({ code })).toBe("throttled");
    expect(getAppCheckErrorKind(`AppCheck: Requests throttled due to previous 403 error (${code}).`)).toBe("throttled");
  });

  it("does not mislabel permission errors or arbitrary HTTP failures", async () => {
    const { recordAppCheckError, getAppCheckRecoveryState } = await import("./appCheckRecovery");
    for (const error of [null, undefined, new Error("HTTP 403 Forbidden"), { code: "functions/permission-denied" }, { code: "auth/too-many-requests" }]) recordAppCheckError(error);
    expect(getAppCheckRecoveryState()).toBeNull();
  });

  it("keeps a throttle notice after cached token success or later network errors", async () => {
    const { recordAppCheckError, recordAppCheckSuccess, getAppCheckRecoveryState } = await import("./appCheckRecovery");
    recordAppCheckError({ code: "appCheck/throttled" });
    recordAppCheckSuccess();
    recordAppCheckError({ code: "appCheck/fetch-network-error" });
    expect(getAppCheckRecoveryState()).toBe("throttled");
  });

  it.each([429, 500, 503])("allows recovery after short HTTP %s SDK backoff", async httpStatus => {
    const { getAppCheckErrorKind, recordAppCheckError, recordAppCheckSuccess, getAppCheckRecoveryState } = await import("./appCheckRecovery");
    const error = { code: "appCheck/throttled", customData: { httpStatus } };
    expect(getAppCheckErrorKind(error)).toBe("temporary");
    expect(getAppCheckErrorKind(`AppCheck: Requests throttled due to previous ${httpStatus} error. (appCheck/throttled).`)).toBe("temporary");
    recordAppCheckError(error);
    // Existing screens can report the same structured error again as a string.
    recordAppCheckError(`AppCheck: ${httpStatus} error. Attempts allowed again after 00m:01s (appCheck/initial-throttle).`);
    expect(getAppCheckRecoveryState()).toBe("temporary");
    recordAppCheckSuccess();
    expect(getAppCheckRecoveryState()).toBeNull();
  });

  it("clears long backoff only after a verified fresh exchange", async () => {
    const { recordAppCheckError, recordAppCheckSuccess, getAppCheckRecoveryState } = await import("./appCheckRecovery");
    recordAppCheckError({ code: "appCheck/initial-throttle", customData: { httpStatus: 403 } });
    recordAppCheckSuccess(false);
    expect(getAppCheckRecoveryState()).toBe("throttled");
    recordAppCheckSuccess(true);
    expect(getAppCheckRecoveryState()).toBeNull();
  });

  it("clears temporary failure after success and publishes only state changes", async () => {
    const { recordAppCheckError, recordAppCheckSuccess, getAppCheckRecoveryState, subscribeToAppCheckRecovery } = await import("./appCheckRecovery");
    const listener = vi.fn();
    const stop = subscribeToAppCheckRecovery(listener);
    recordAppCheckError({ code: "appCheck/recaptcha-error" });
    recordAppCheckError({ code: "appCheck/fetch-network-error" });
    expect(getAppCheckRecoveryState()).toBe("temporary");
    expect(listener).toHaveBeenCalledTimes(1);
    recordAppCheckSuccess();
    expect(getAppCheckRecoveryState()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    recordAppCheckError({ code: "appCheck/throttled" });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
