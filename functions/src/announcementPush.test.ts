import { createHash } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverAnnouncementPush, registerPushDevice, unregisterPushDevice, testPushDevice } from "./announcementPush.js";

const now = Timestamp.fromMillis(1_000_000);
const key = "a".repeat(64);
const id = "device-abcdefghijklmnop";
const token = "test-token-abcdefghijklmnop";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const rows = new Map<string, Record<string, any>>();
  const ref = (path: string): any => ({ path, id: path.split("/").at(-1), get: async () => snapshot(path) });
  const snapshot = (path: string): any => ({ id: path.split("/").at(-1), exists: rows.has(path), data: () => rows.get(path), ref: ref(path) });
  let tail = Promise.resolve();
  const db = {
    doc: ref,
    collection: (name: string) => ({
      where: (field: string, _operator: string, value: unknown) => ({
        get: async () => ({ docs: [...rows].filter(([path, row]) => path.startsWith(`${name}/`) && row[field] === value).map(([path]) => snapshot(path)) })
      })
    }),
    runTransaction: (work: (tx: any) => Promise<any>) => {
      const result = tail.then(async () => {
        const changes: (() => void)[] = [];
        const value = await work({ get: async (reference: any) => snapshot(reference.path),
          set: (reference: any, row: any) => changes.push(() => rows.set(reference.path, row)),
          update: (reference: any, row: any) => changes.push(() => rows.set(reference.path, { ...rows.get(reference.path), ...row })),
          delete: (reference: any) => changes.push(() => rows.delete(reference.path)) });
        changes.forEach(change => change()); return value;
      });
      tail = result.then(() => {}, () => {});
      return result;
    }
  } as unknown as Firestore;
  rows.set("users/recipient", { uid: "recipient", active: true, role: "employee" });
  rows.set("users/second", { uid: "second", active: true, role: "president_viewer" });
  rows.set("announcementPushConfig/default", { enabled: true, allowedUserIds: ["recipient", "second"] });
  rows.set("presidentInstructions/post", { authorId: "author", recipientIds: ["recipient"], status: "active", createdAt: now, titleOriginal: "private title", bodyOriginal: "private body" });
  const auth = { uid: "recipient", token: { auth_time: 200 } };
  const input = { deviceId: id, revokeKey: key, token, locale: "ja" };
  const sender = { send: vi.fn(async (_message: any) => "accepted") };
  const register = (data: any = input, context: any = auth) => registerPushDevice(db, context, data, now);
  const deliver = (time = now) => deliverAnnouncementPush(db, sender, "post", time);
  return { db, rows, auth, input, sender, register, deliver };
}
beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

describe("announcement device registration", () => {
  it("authenticates and binds owner from the session, rejects extra client-owned fields", async () => {
    const f = fixture();
    await f.register();
    await expect(registerPushDevice(f.db, undefined, f.input)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(f.register({ ...f.input, userId: "second" })).rejects.toThrow();
    expect(f.rows.get(`announcementPushDevices/${id}`)?.userId).toBe("recipient");
  });
  it.each([{ active: false }, { isDemo: true }, { passwordChangeRequired: true }, { passwordAuthTimeAfter: 201 }, { role: "unknown" }])("rejects unavailable accounts %j", async change => {
    const f = fixture(); Object.assign(f.rows.get("users/recipient")!, change);
    await expect(f.register()).rejects.toThrow();
    expect(f.rows.has(`announcementPushDevices/${id}`)).toBe(false);
  });
  it("updates a token and language and releases its previous unique token index", async () => {
    const f = fixture(); await f.register();
    await f.register({ ...f.input, token: `${token}-new`, locale: "zh-CN" });
    expect(f.rows.get(`announcementPushDevices/${id}`)).toMatchObject({ token: `${token}-new`, locale: "zh-CN" });
    expect(f.rows.has(`announcementPushTokenOwners/${hash(token)}`)).toBe(false);
  });
  it("rejects device takeover and token reuse, but permits a proven device to switch accounts", async () => {
    const f = fixture(); await f.register();
    await expect(f.register({ ...f.input, revokeKey: "b".repeat(64) })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(f.register({ ...f.input, deviceId: `${id}-other` })).rejects.toMatchObject({ code: "already-exists" });
    await f.register(f.input, { uid: "second", token: { auth_time: 200 } });
    expect(f.rows.get(`announcementPushDevices/${id}`)?.userId).toBe("second");
  });
  it("allows only the scoped secret to revoke, including after logout and on repeated requests", async () => {
    const f = fixture(); await f.register();
    await expect(unregisterPushDevice(f.db, { deviceId: id, revokeKey: "b".repeat(64) })).rejects.toMatchObject({ code: "permission-denied" });
    await unregisterPushDevice(f.db, { deviceId: id, revokeKey: key });
    await unregisterPushDevice(f.db, { deviceId: id, revokeKey: key });
    expect(f.rows.has(`announcementPushDevices/${id}`)).toBe(false);
    expect(f.rows.has(`announcementPushTokenOwners/${hash(token)}`)).toBe(false);
  });
});

describe("announcement delivery", () => {
  it("sends only to registered recipients, without content or sender details", async () => {
    const f = fixture(); await f.register();
    await f.register({ ...f.input, deviceId: `${id}-second`, token: `${token}-second` }, { uid: "second", token: { auth_time: 200 } });
    await f.deliver();
    expect(f.sender.send).toHaveBeenCalledTimes(1);
    const sent = f.sender.send.mock.calls[0][0];
    expect(sent.data).toEqual({ type: "announcement", instructionId: "post", eventId: "announcement-post", userId: "recipient", locale: "ja" });
    expect(JSON.stringify(sent)).not.toMatch(/private title|private body|author/);
  });
  it("sends to every recipient device and every addressed user, excluding the author", async () => {
    const f = fixture(); await f.register();
    await f.register({ ...f.input, deviceId: `${id}-two`, token: `${token}-two` });
    await f.register({ ...f.input, deviceId: `${id}-second`, token: `${token}-second` }, { uid: "second", token: { auth_time: 200 } });
    Object.assign(f.rows.get("presidentInstructions/post")!, { authorId: "second", recipientIds: ["recipient", "second", "recipient"] });
    await f.deliver(); expect(f.sender.send).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["config", { enabled: false }], ["config", { allowedUserIds: [] }],
    ["post", { isDemo: true }], ["post", { status: "cancelled" }],
    ["user", { active: false }], ["user", { isDemo: true }], ["user", { passwordAuthTimeAfter: 201 }]
  ])("does not deliver after %s changes %j", async (kind, change) => {
    const f = fixture(); await f.register();
    const path = kind === "config" ? "announcementPushConfig/default" : kind === "post" ? "presidentInstructions/post" : "users/recipient";
    Object.assign(f.rows.get(path)!, change); await f.deliver(); expect(f.sender.send).not.toHaveBeenCalled();
  });
  it("expires after 24 hours and does not backfill to devices enabled after a post", async () => {
    const f = fixture(); await f.register();
    await f.deliver(Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60_000));
    f.rows.get(`announcementPushDevices/${id}`)!.createdAt = Timestamp.fromMillis(now.toMillis() + 1);
    await f.deliver(); expect(f.sender.send).not.toHaveBeenCalled();
  });
  it("deduplicates concurrent events, retries busy leases, and ignores later mutations", async () => {
    const f = fixture(); await f.register();
    const results = await Promise.allSettled([f.deliver(), f.deliver()]);
    expect(results.some(row => row.status === "fulfilled")).toBe(true);
    expect(f.sender.send).toHaveBeenCalledTimes(1);
    Object.assign(f.rows.get("presidentInstructions/post")!, { translationStatus: "completed", recipientStates: { recipient: { status: "acknowledged" } } });
    await f.deliver(); expect(f.sender.send).toHaveBeenCalledTimes(1);
  });
  it("retries only failed devices and preserves accepted deliveries", async () => {
    const f = fixture(); await f.register();
    await f.register({ ...f.input, deviceId: `${id}-two`, token: `${token}-two` });
    f.sender.send.mockImplementationOnce(async () => "ok").mockRejectedValueOnce({ code: "messaging/server-unavailable" });
    await expect(f.deliver()).rejects.toThrow("announcement-push-retry");
    await f.deliver(); expect(f.sender.send).toHaveBeenCalledTimes(3);
  });
  it("removes invalid tokens and does not retry permanent errors", async () => {
    const f = fixture(); await f.register();
    f.sender.send.mockRejectedValue({ code: "messaging/registration-token-not-registered" });
    await f.deliver(); expect(f.rows.has(`announcementPushDevices/${id}`)).toBe(false);
    await f.deliver(); expect(f.sender.send).toHaveBeenCalledTimes(1);
  });
  it("sends a test only to the session owner's device, checks rollout, and rate limits", async () => {
    const f = fixture(); await f.register();
    const data = { deviceId: id, revokeKey: key };
    await expect(testPushDevice(f.db, f.sender, { uid: "second", token: { auth_time: 200 } }, data, now)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(testPushDevice(f.db, f.sender, f.auth, data, now)).resolves.toEqual({ accepted: true });
    await expect(testPushDevice(f.db, f.sender, f.auth, data, now)).rejects.toMatchObject({ code: "resource-exhausted" });
    f.rows.get("announcementPushConfig/default")!.enabled = false;
    await expect(testPushDevice(f.db, f.sender, f.auth, data, Timestamp.fromMillis(now.toMillis() + 61_000))).rejects.toMatchObject({ code: "failed-precondition" });
  });
  it("preserves the test interval across token refresh and permits the next send after a minute", async () => {
    const f = fixture(); await f.register();
    const data = { deviceId: id, revokeKey: key };
    await testPushDevice(f.db, f.sender, f.auth, data, now);
    await f.register({ ...f.input, token: `${token}-refreshed` });
    await expect(testPushDevice(f.db, f.sender, f.auth, data, Timestamp.fromMillis(now.toMillis() + 59_000))).rejects.toMatchObject({ code: "resource-exhausted" });
    await expect(testPushDevice(f.db, f.sender, f.auth, data, Timestamp.fromMillis(now.toMillis() + 60_000))).resolves.toEqual({ accepted: true });
    expect(f.sender.send).toHaveBeenCalledTimes(2);
    expect(f.sender.send.mock.calls[1][0].token).toBe(`${token}-refreshed`);
  });
});
