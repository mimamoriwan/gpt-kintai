import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCheck } from "firebase/app-check";
import { startAppCheckLifecycle } from "./appCheckLifecycle";
import { getAppCheckRecoveryState, recordAppCheckError, recordAppCheckSuccess } from "./appCheckRecovery";

const mocks = vi.hoisted(() => ({ getToken: vi.fn(), autoRefresh: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("firebase/app-check", () => ({
  getToken: mocks.getToken,
  onTokenChanged: mocks.subscribe,
  setTokenAutoRefreshEnabled: mocks.autoRefresh
}));

const appCheck = {} as AppCheck;
let stop: (() => void) | undefined;
let visible = true;
let online = true;
let next: () => void;
let failed: (error: unknown) => void;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const throttle = (httpStatus: number, code = "appCheck/throttled") => Object.assign(new Error(`previous ${httpStatus} error`), { code, customData: { httpStatus } });

beforeEach(() => {
  vi.resetAllMocks();
  recordAppCheckSuccess(true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  visible = true;
  online = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden");
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  mocks.getToken.mockResolvedValue({ token: "valid-token" });
  mocks.subscribe.mockImplementation((_appCheck, onNext, onError) => {
    next = onNext;
    failed = onError;
    return mocks.unsubscribe;
  });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  // The installed SDK cannot reliably cancel its pending sleep. Only the
  // lifecycle's cancellable timer may run; SDK auto-refresh must stay disabled.
  expect(mocks.autoRefresh).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("App Check lifecycle", () => {
  it("checks normally once a minute while visible and online without starting SDK auto-refresh", async () => {
    stop = startAppCheckLifecycle(appCheck);
    await settle();
    expect(mocks.getToken.mock.calls).toEqual([[appCheck, false]]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.getToken.mock.calls).toEqual([[appCheck, false], [appCheck, false]]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("starts no checks or timers in a tab that loads hidden or offline", () => {
    visible = false;
    stop = startAppCheckLifecycle(appCheck);
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    online = false;
    visible = true;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    online = true;
    window.dispatchEvent(new Event("online"));
    expect(mocks.getToken.mock.calls).toEqual([[appCheck, false]]);
  });

  it("cancels the timer while hidden for eight hours and checks once when the user returns", async () => {
    stop = startAppCheckLifecycle(appCheck);
    await settle();
    visible = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);
    window.dispatchEvent(new Event("focus"));
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
    visible = true;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(mocks.getToken.mock.calls).toEqual([[appCheck, false], [appCheck, false]]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not restart its timer when a pending check finishes after the tab is hidden", async () => {
    let finish!: (value: { token: string }) => void;
    mocks.getToken.mockReturnValueOnce(new Promise<{ token: string }>(resolve => { finish = resolve; }));
    stop = startAppCheckLifecycle(appCheck);
    visible = false;
    document.dispatchEvent(new Event("visibilitychange"));
    finish({ token: "valid-token" });
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
  });

  it("cancels on lost connectivity and waits until both online and visible to resume", async () => {
    stop = startAppCheckLifecycle(appCheck);
    await settle();
    online = false;
    window.dispatchEvent(new Event("offline"));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    visible = false;
    online = true;
    window.dispatchEvent(new Event("online"));
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    visible = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.getToken).toHaveBeenCalledTimes(2);
  });

  it("checks browser state at timer execution even if no visibility event arrived", async () => {
    stop = startAppCheckLifecycle(appCheck);
    await settle();
    visible = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces resume events while pending and waits a minute after completion", async () => {
    let finish!: (value: { token: string }) => void;
    mocks.getToken.mockReturnValueOnce(new Promise<{ token: string }>(resolve => { finish = resolve; }));
    stop = startAppCheckLifecycle(appCheck);
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    finish({ token: "valid-token" });
    await settle();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    window.dispatchEvent(new Event("focus"));
    expect(mocks.getToken).toHaveBeenCalledTimes(2);
    expect(mocks.getToken.mock.calls.every(([, force]) => force === false)).toBe(true);
  });

  it.each([403, 404])("stops timers after HTTP %s lockout, including cached-token notifications", async (httpStatus) => {
    mocks.getToken.mockRejectedValueOnce(throttle(httpStatus));
    stop = startAppCheckLifecycle(appCheck);
    await settle();
    expect(getAppCheckRecoveryState()).toBe("throttled");
    expect(vi.getTimerCount()).toBe(0);
    next();
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);
    for (const event of ["focus", "pageshow", "online"]) window.dispatchEvent(new Event(event));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getAppCheckRecoveryState()).toBe("throttled");
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([429, 500])("automatically recovers a short HTTP %s throttle on the next minute check", async (httpStatus) => {
    mocks.getToken.mockRejectedValueOnce(throttle(httpStatus, "appCheck/initial-throttle"));
    stop = startAppCheckLifecycle(appCheck);
    await settle();
    expect(getAppCheckRecoveryState()).toBe("temporary");
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getToken.mock.calls).toEqual([[appCheck, false], [appCheck, false]]);
    expect(getAppCheckRecoveryState()).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("observes a background SDK error and cancels the pending timer", async () => {
    stop = startAppCheckLifecycle(appCheck);
    await settle();
    failed(throttle(403));
    expect(getAppCheckRecoveryState()).toBe("throttled");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("focus"));
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
  });

  it("includes callable failures hidden by a cached-token SDK notification, then resumes after verified fresh success", async () => {
    stop = startAppCheckLifecycle(appCheck);
    await settle();
    next();
    recordAppCheckError(throttle(403));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    recordAppCheckSuccess(false);
    expect(getAppCheckRecoveryState()).toBe("throttled");
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
    recordAppCheckSuccess(true);
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(getAppCheckRecoveryState()).toBeNull();
    expect(mocks.getToken.mock.calls).toEqual([[appCheck, false], [appCheck, false]]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("automatically retries a temporary network failure after a minute", async () => {
    mocks.getToken.mockRejectedValueOnce(Object.assign(new Error("network unavailable"), { code: "appCheck/fetch-network-error" }));
    stop = startAppCheckLifecycle(appCheck);
    await settle();
    expect(getAppCheckRecoveryState()).toBe("temporary");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getToken).toHaveBeenCalledTimes(2);
    expect(getAppCheckRecoveryState()).toBeNull();
  });

  it("ignores pending results and all lifecycle events after cleanup", async () => {
    let reject!: (error: unknown) => void;
    mocks.getToken.mockReturnValueOnce(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    stop = startAppCheckLifecycle(appCheck);
    stop();
    stop = undefined;
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    reject(throttle(403));
    failed(throttle(403));
    await settle();
    expect(getAppCheckRecoveryState()).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    for (const event of ["focus", "pageshow", "online", "offline"]) window.dispatchEvent(new Event(event));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels an already scheduled timer on cleanup", async () => {
    stop = startAppCheckLifecycle(appCheck);
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    stop();
    stop = undefined;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    recordAppCheckError(throttle(403));
    recordAppCheckSuccess(true);
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
  });
});
