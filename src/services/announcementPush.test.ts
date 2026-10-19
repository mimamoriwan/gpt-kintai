import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disableAnnouncementPush, enableAnnouncementPush, flushPushRevocations, getPushEnvironment, sendAnnouncementPushTest, startAnnouncementPushSession } from "./announcementPush";
import type { PushDeviceState, PushRevocation } from "../lib/pushStorage";

const f = vi.hoisted(() => ({
  state: undefined as PushDeviceState | undefined,
  queue: [] as PushRevocation[], uid: "owner" as string | null,
  call: vi.fn(async (_name: string, _data: any): Promise<{ data: unknown }> => ({ data: {} })),
  permission: vi.fn(async () => "granted" as NotificationPermission),
  getToken: vi.fn(async () => "test-registration-token"),
  onMessage: vi.fn(() => vi.fn()),
  unsubscribe: vi.fn(async () => true), postMessage: vi.fn()
}));
vi.mock("firebase/app", () => ({ getApp: () => ({}) }));
vi.mock("firebase/functions", () => ({ httpsCallable: (_functions: unknown, name: string) => (data: any) => f.call(name, data) }));
vi.mock("firebase/messaging", () => ({ isSupported: async () => true, getMessaging: () => ({}), getToken: f.getToken, onMessage: f.onMessage }));
vi.mock("../firebase", () => ({
  auth: { get currentUser() { return f.uid ? { uid: f.uid } : null; } }, functions: {},
  prepareCallableSecurityContext: async () => {}, preparePublicCallableSecurityContext: async () => {}
}));
vi.mock("../lib/pushStorage", () => ({
  ensurePushIdentity: async (userId: string, locale: "ja" | "zh-CN") => {
    if (!f.state) f.state = { deviceId: "test-device-abcdefghijkl", revokeKey: "a".repeat(64), userId, locale, enabled: false };
    return { ...f.state };
  },
  getPushState: async () => f.state ? { ...f.state } : undefined,
  savePushState: async (state: PushDeviceState) => { f.state = { ...state }; },
  readPushValue: async () => [...f.queue],
  updateRevocations: async (change: (rows: PushRevocation[]) => PushRevocation[]) => { f.queue = change(f.queue); }
}));
const registration = { active: { postMessage: f.postMessage }, pushManager: { getSubscription: async () => ({ unsubscribe: f.unsubscribe }) } };
beforeEach(() => {
  vi.clearAllMocks(); f.state = undefined; f.queue = []; f.uid = "owner";
  f.call.mockImplementation(async () => ({ data: {} }));
  f.permission.mockResolvedValue("granted"); f.getToken.mockResolvedValue("test-registration-token");
  vi.stubEnv("VITE_FIREBASE_VAPID_KEY", "public-vapid-key");
  vi.stubGlobal("Notification", { permission: "granted", requestPermission: f.permission });
  vi.stubGlobal("PushManager", class {}); vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve(registration), getRegistration: async () => registration } });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("announcement push client", () => {
  it("requests permission synchronously from the tap and marks ON only after registration succeeds", async () => {
    let finish!: (value: { data: unknown }) => void;
    f.call.mockImplementation(name => name === "registerAnnouncementPushDevice" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: {} }));
    const pending = enableAnnouncementPush("owner", "ja");
    expect(f.permission).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(f.call).toHaveBeenCalledWith("registerAnnouncementPushDevice", expect.any(Object)));
    expect(f.state?.enabled).toBe(false);
    finish({ data: { registered: true } }); await pending;
    expect(f.state?.enabled).toBe(true);
    expect(f.getToken).toHaveBeenCalledWith({}, { vapidKey: "public-vapid-key", serviceWorkerRegistration: registration });
  });
  it("does not enable or generate a token when permission is denied", async () => {
    f.permission.mockResolvedValue("denied");
    await expect(enableAnnouncementPush("owner", "ja")).rejects.toThrow("permission-denied");
    expect(f.getToken).not.toHaveBeenCalled(); expect(f.state?.enabled).not.toBe(true);
  });
  it("keeps failed server registration OFF and sends no test", async () => {
    f.call.mockRejectedValue(new Error("offline"));
    await expect(enableAnnouncementPush("owner", "ja")).rejects.toThrow();
    expect(f.state?.enabled).toBe(false);
    await expect(sendAnnouncementPushTest()).rejects.toThrow("not-registered");
  });
  it("persists opt-out and retries a scoped revocation after an offline logout without a logged-in user", async () => {
    await enableAnnouncementPush("owner", "ja");
    f.call.mockRejectedValue(new Error("offline"));
    await disableAnnouncementPush();
    await vi.waitFor(() => expect(f.queue).toHaveLength(1));
    expect(f.state?.enabled).toBe(false);
    // Wait for the failed background attempt to leave its retryable queue.
    await flushPushRevocations().catch(() => {});
    f.uid = null; f.call.mockResolvedValue({ data: { removed: true } });
    await flushPushRevocations();
    expect(f.queue).toEqual([]);
    expect(f.call).toHaveBeenLastCalledWith("unregisterAnnouncementPushDevice", { deviceId: f.state!.deviceId, revokeKey: f.state!.revokeKey });
  });
  it("revokes a registration that finishes after logout instead of enabling it", async () => {
    let finish!: (value: { data: unknown }) => void;
    f.call.mockImplementation(name => name === "registerAnnouncementPushDevice" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: {} }));
    const pending = enableAnnouncementPush("owner", "ja");
    const assertion = expect(pending).rejects.toThrow("session-changed");
    await vi.waitFor(() => expect(f.call).toHaveBeenCalledWith("registerAnnouncementPushDevice", expect.any(Object)));
    await disableAnnouncementPush(); f.uid = null;
    finish({ data: {} }); await assertion;
    expect(f.state?.enabled).toBe(false);
  });
  it("does not request permission on startup or opt in a new account", async () => {
    const stop = startAnnouncementPushSession("owner", "ja");
    await new Promise(resolve => setTimeout(resolve, 0)); stop();
    expect(f.permission).not.toHaveBeenCalled(); expect(f.getToken).not.toHaveBeenCalled();
    await enableAnnouncementPush("owner", "ja");
    f.uid = "different";
    const stopNext = startAnnouncementPushSession("different", "ja");
    await vi.waitFor(() => expect(f.state?.enabled).toBe(false)); stopNext();
    expect(f.permission).toHaveBeenCalledTimes(1);
  });
  it("reports a missing project key without offering a permission prompt", () => {
    vi.stubEnv("VITE_FIREBASE_VAPID_KEY", "");
    expect(getPushEnvironment()).toBe("not-configured");
    expect(f.permission).not.toHaveBeenCalled();
  });
  it("refreshes an opted-in owner's registration without a permission prompt", async () => {
    await enableAnnouncementPush("owner", "ja");
    f.call.mockClear(); f.permission.mockClear();
    const stop = startAnnouncementPushSession("owner", "zh-CN");
    try {
      await vi.waitFor(() => expect(f.onMessage).toHaveBeenCalledOnce());
      expect(f.call).toHaveBeenCalledWith("registerAnnouncementPushDevice", expect.objectContaining({ locale: "zh-CN" }));
      expect(f.permission).not.toHaveBeenCalled();
    } finally { stop(); }
  });
  it("disables a different account before network cleanup even while its profile gate is closed", async () => {
    await enableAnnouncementPush("owner", "ja");
    f.uid = "different"; f.call.mockRejectedValue(new Error("offline"));
    const stop = startAnnouncementPushSession("different", "ja", false);
    try { await vi.waitFor(() => expect(f.state?.enabled).toBe(false)); }
    finally { stop(); await flushPushRevocations().catch(() => {}); }
  });
});
