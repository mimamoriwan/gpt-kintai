import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const mock = { register: vi.fn(), update: vi.fn() };

async function setup() {
  const api = await import("./pwaUpdate");
  api.initializeAppUpdates(mock.register);
  const options = mock.register.mock.calls[0][0];
  const registration = { update: vi.fn().mockResolvedValue(undefined), installing: null as ServiceWorker | null };
  return {
    api,
    waiting: options.onNeedRefresh as () => void,
    registered: () => options.onRegisteredSW("/sw.js", registration),
    registration
  };
}

describe("manual application updates", () => {
  let windowListeners: MockInstance<typeof window.addEventListener>;
  let documentListeners: MockInstance<typeof document.addEventListener>;
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mock.update.mockReset().mockResolvedValue(undefined);
    mock.register.mockReset().mockReturnValue(mock.update);
    windowListeners = vi.spyOn(window, "addEventListener");
    documentListeners = vi.spyOn(document, "addEventListener");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => {
    windowListeners.mock.calls.forEach(([type, listener, options]) => window.removeEventListener(type, listener, options));
    documentListeners.mock.calls.forEach(([type, listener, options]) => document.removeEventListener(type, listener, options));
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("registers once and does not activate a version when it becomes available", async () => {
    const { api, waiting } = await setup();
    api.initializeAppUpdates(mock.register);
    expect(mock.register).toHaveBeenCalledTimes(1);
    expect(api.getAppUpdateState().available).toBe(false);
    waiting();
    expect(api.getAppUpdateState()).toEqual({ available: true, applying: false, failed: false });
    expect(mock.update).not.toHaveBeenCalled();
  });

  it("notifies subscribers and supports unsubscription", async () => {
    const { api, waiting } = await setup();
    const listener = vi.fn();
    const unsubscribe = api.subscribeToAppUpdate(listener);
    waiting();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    waiting();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("requires a waiting version and accepts only one activation at a time", async () => {
    const { api, waiting } = await setup();
    await api.applyAppUpdate();
    expect(mock.update).not.toHaveBeenCalled();
    waiting();
    await Promise.all([api.applyAppUpdate(), api.applyAppUpdate()]);
    expect(mock.update).toHaveBeenCalledTimes(1);
    expect(mock.update).toHaveBeenCalledWith(true);
    expect(api.getAppUpdateState().applying).toBe(true);
    waiting();
    expect(api.getAppUpdateState().applying).toBe(true);
  });

  it("preserves the update entry and permits retry when activation rejects", async () => {
    const { api, waiting } = await setup();
    mock.update.mockRejectedValueOnce(new Error("activation unavailable"));
    waiting();
    await api.applyAppUpdate();
    expect(api.getAppUpdateState()).toEqual({ available: true, applying: false, failed: true });
    await api.applyAppUpdate();
    expect(mock.update).toHaveBeenCalledTimes(2);
    expect(api.getAppUpdateState().failed).toBe(false);
  });

  it("allows retry if activation returns but the page is never reloaded", async () => {
    const { api, waiting } = await setup();
    waiting();
    await api.applyAppUpdate();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.getAppUpdateState()).toEqual({ available: true, applying: false, failed: true });
  });

  it("finishes a hung activation after the deadline and ignores its late rejection during retry", async () => {
    const { api, waiting } = await setup();
    let rejectFirst!: (error: Error) => void;
    mock.update.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectFirst = reject; }));
    waiting();
    const firstAttempt = api.applyAppUpdate();
    await vi.advanceTimersByTimeAsync(15_000);
    await firstAttempt;
    expect(api.getAppUpdateState()).toEqual({ available: true, applying: false, failed: true });
    await api.applyAppUpdate();
    rejectFirst(new Error("old request finally failed"));
    await Promise.resolve();
    expect(mock.update).toHaveBeenCalledTimes(2);
    expect(api.getAppUpdateState()).toEqual({ available: true, applying: true, failed: false });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.getAppUpdateState().failed).toBe(true);
  });

  it("preserves failure feedback if the same waiting version is reported again", async () => {
    const { api, waiting } = await setup();
    mock.update.mockRejectedValueOnce(new Error("activation unavailable"));
    waiting();
    await api.applyAppUpdate();
    waiting();
    expect(api.getAppUpdateState()).toEqual({ available: true, applying: false, failed: true });
  });

  it("checks on resume and restored pages while throttling clustered events without activating", async () => {
    const { api, registered, registration, waiting } = await setup();
    registered();
    window.dispatchEvent(new Event("focus"));
    expect(registration.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("online"));
    expect(registration.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("pageshow"));
    expect(registration.update).toHaveBeenCalledTimes(2);
    waiting();
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("focus"));
    expect(registration.update).toHaveBeenCalledTimes(2);
    expect(api.getAppUpdateState().available).toBe(true);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it("checks every five minutes only while visible and online, and checks when connectivity returns", async () => {
    const { registered, registration } = await setup();
    registered();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(registration.update).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    window.dispatchEvent(new Event("focus"));
    expect(registration.update).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(registration.update).toHaveBeenCalledTimes(1);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    expect(registration.update).toHaveBeenCalledTimes(2);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it("keeps the current app usable after a failed background check and retries later", async () => {
    const { api, registered, registration } = await setup();
    registration.update.mockRejectedValueOnce(new Error("offline"));
    registered();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(api.getAppUpdateState()).toEqual({ available: false, applying: false, failed: false });
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("focus"));
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it("avoids overlapping checks and checking while another worker is installing", async () => {
    const { registered, registration } = await setup();
    let complete!: () => void;
    registration.update.mockReturnValueOnce(new Promise<void>((resolve) => { complete = resolve; }));
    registered();
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("pageshow"));
    expect(registration.update).toHaveBeenCalledTimes(1);
    complete();
    await Promise.resolve();
    registration.installing = {} as ServiceWorker;
    window.dispatchEvent(new Event("focus"));
    expect(registration.update).toHaveBeenCalledTimes(1);
    registration.installing = null;
    window.dispatchEvent(new Event("focus"));
    expect(registration.update).toHaveBeenCalledTimes(2);
  });
});
