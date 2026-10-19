import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Message } from "firebase-admin/messaging";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireWorkAuth, type PasswordAuthContext } from "./passwordChange.js";

const deviceId = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);
const revokeKey = z.string().regex(/^[a-f0-9]{64}$/);
const registration = z.object({ deviceId, revokeKey, token: z.string().min(20).max(4096), locale: z.enum(["ja", "zh-CN"]) }).strict();
const removal = z.object({ deviceId, revokeKey }).strict();
export const PUSH_LIFETIME_MS = 24 * 60 * 60 * 1000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Sender = { send(message: Message): Promise<string> };
type Row = Record<string, any>;
const millis = (value: unknown): number => value instanceof Timestamp ? value.toMillis() : NaN;

function validAccount(profile: Row | undefined, authTime?: number): boolean {
  return !!profile && profile.active === true && profile.isDemo !== true
    && ["employee", "employee_manager", "president_viewer"].includes(profile.role)
    && profile.passwordChangeRequired !== true
    && (!("passwordAuthTimeAfter" in profile) || (typeof authTime === "number"
      && Number.isFinite(profile.passwordAuthTimeAfter) && authTime > profile.passwordAuthTimeAfter));
}

async function authenticate(db: Firestore, auth: PasswordAuthContext | undefined) {
  const context = await requireWorkAuth(auth, async uid => (await db.doc(`users/${uid}`).get()).data());
  const profile = (await db.doc(`users/${context.uid}`).get()).data();
  if (!validAccount(profile, Number(context.token.auth_time))) throw new HttpsError("permission-denied", "このアカウントでは通知を利用できません。");
  return context;
}

export async function registerPushDevice(db: Firestore, auth: PasswordAuthContext | undefined, raw: unknown, now = Timestamp.now()) {
  const context = await authenticate(db, auth);
  const input = registration.parse(raw);
  const ref = db.doc(`announcementPushDevices/${input.deviceId}`);
  const tokenRef = db.doc(`announcementPushTokenOwners/${hash(input.token)}`);
  await db.runTransaction(async tx => {
    const [existing, owner, user] = await Promise.all([tx.get(ref), tx.get(tokenRef), tx.get(db.doc(`users/${context.uid}`))]);
    if (user.data()?.uid !== context.uid || !validAccount(user.data(), Number(context.token.auth_time))) throw new HttpsError("permission-denied", "アカウントを確認してください。");
    const previous = existing.data();
    if (previous && previous.revokeKeyHash !== hash(input.revokeKey)) throw new HttpsError("permission-denied", "端末の登録情報が一致しません。");
    if (owner.exists && owner.data()?.deviceId !== input.deviceId) throw new HttpsError("already-exists", "この通知先は別の端末情報に登録されています。");
    if (previous?.token && previous.token !== input.token) tx.delete(db.doc(`announcementPushTokenOwners/${hash(previous.token)}`));
    tx.set(ref, {
      userId: context.uid, token: input.token, locale: input.locale,
      revokeKeyHash: hash(input.revokeKey), authTime: context.token.auth_time ?? 0,
      createdAt: previous?.userId === context.uid ? previous.createdAt : now, updatedAt: now,
      ...(previous?.userId === context.uid && previous.lastTestAt instanceof Timestamp ? { lastTestAt: previous.lastTestAt } : {})
    });
    tx.set(tokenRef, { deviceId: input.deviceId });
  });
  return { registered: true as const };
}

// This single-device revocation capability also works after an offline logout.
// It cannot register, inspect, send, or revoke any other installation.
export async function unregisterPushDevice(db: Firestore, raw: unknown) {
  const input = removal.parse(raw);
  const ref = db.doc(`announcementPushDevices/${input.deviceId}`);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return;
    const row = snapshot.data()!;
    const actual = Buffer.from(hash(input.revokeKey));
    const expected = Buffer.from(String(row.revokeKeyHash || ""));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpsError("permission-denied", "端末の解除情報が一致しません。");
    tx.delete(ref);
    tx.delete(db.doc(`announcementPushTokenOwners/${hash(row.token)}`));
  });
  return { removed: true as const };
}

async function enabledFor(db: Firestore, uid: string) {
  const config = (await db.doc("announcementPushConfig/default").get()).data();
  return config?.enabled === true && Array.isArray(config.allowedUserIds) && config.allowedUserIds.includes(uid);
}

function message(token: string, userId: string, eventId: string, instructionId: string, locale: string, ttlSeconds: number): Message {
  return { token, data: { type: instructionId ? "announcement" : "test", eventId, instructionId, locale, userId },
    webpush: { headers: { TTL: String(Math.max(0, ttlSeconds)), Urgency: "normal" } } };
}

const invalidToken = (error: unknown) => ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(errorCode(error));
function errorCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  return /^messaging\/[a-z-]+$/.test(code) ? code : "unknown";
}
const transient = (error: unknown) => ["unknown", "messaging/internal-error", "messaging/server-unavailable", "messaging/unknown-error", "messaging/quota-exceeded", "messaging/message-rate-exceeded"].includes(errorCode(error));

async function removeInvalidDevice(db: Firestore, ref: FirebaseFirestore.DocumentReference, token: string) {
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (snapshot.data()?.token !== token) return;
    tx.delete(ref);
    tx.delete(db.doc(`announcementPushTokenOwners/${hash(token)}`));
  });
}

export async function testPushDevice(db: Firestore, sender: Sender, auth: PasswordAuthContext | undefined, raw: unknown, now = Timestamp.now()) {
  const context = await authenticate(db, auth);
  const { deviceId: id, revokeKey: key } = removal.parse(raw);
  if (!await enabledFor(db, context.uid)) throw new HttpsError("failed-precondition", "通知の試験利用はまだ有効になっていません。");
  const ref = db.doc(`announcementPushDevices/${id}`);
  const row = await db.runTransaction(async tx => {
    const [device, user] = await Promise.all([tx.get(ref), tx.get(db.doc(`users/${context.uid}`))]);
    const value = device.data();
    if (user.data()?.uid !== context.uid || !validAccount(user.data(), Number(context.token.auth_time)) || value?.userId !== context.uid || value.revokeKeyHash !== hash(key)) throw new HttpsError("permission-denied", "本人の登録済み端末で試してください。");
    if (now.toMillis() - millis(value.lastTestAt) < 60_000) throw new HttpsError("resource-exhausted", "テスト通知は1分ほど待ってから送ってください。");
    tx.update(ref, { lastTestAt: now });
    return value;
  });
  try {
    await sender.send(message(row.token, context.uid, `test-${randomUUID()}`, "", row.locale, 300));
  } catch (error) {
    if (invalidToken(error)) await removeInvalidDevice(db, ref, row.token);
    throw new HttpsError("unavailable", "テスト通知を送信できませんでした。通知設定を確認してください。");
  }
  return { accepted: true as const };
}

export async function deliverAnnouncementPush(db: Firestore, sender: Sender, instructionId: string, now = Timestamp.now()) {
  const instruction = (await db.doc(`presidentInstructions/${instructionId}`).get()).data();
  if (!instruction || instruction.isDemo === true || instruction.status !== "active") return;
  const age = now.toMillis() - millis(instruction.createdAt);
  if (!Number.isFinite(age) || age < 0 || age >= PUSH_LIFETIME_MS) return;
  const recipients = [...new Set<string>(Array.isArray(instruction.recipientIds) ? instruction.recipientIds : [])]
    .filter(uid => typeof uid === "string" && uid !== instruction.authorId && /^[^/]{1,128}$/.test(uid));
  let retry = false;
  for (const uid of recipients) {
    if (!await enabledFor(db, uid)) continue;
    const devices = await db.collection("announcementPushDevices").where("userId", "==", uid).get();
    for (const device of devices.docs) {
      const ledger = db.doc(`announcementPushDeliveries/${hash(`${instructionId}:${device.id}`)}`);
      const leaseId = randomUUID();
      const outcome = await db.runTransaction(async tx => {
        const [saved, current, user, post, config] = await Promise.all([
          tx.get(ledger), tx.get(device.ref), tx.get(db.doc(`users/${uid}`)),
          tx.get(db.doc(`presidentInstructions/${instructionId}`)), tx.get(db.doc("announcementPushConfig/default"))
        ]);
        const row = current.data();
        const latest = post.data();
        const settings = config.data();
        if (!row || row.userId !== uid || user.data()?.uid !== uid || !validAccount(user.data(), row.authTime)
          || millis(row.createdAt) > millis(instruction.createdAt)
          || !latest || latest.status !== "active" || latest.isDemo === true || !latest.recipientIds?.includes(uid)
          || settings?.enabled !== true || !settings.allowedUserIds?.includes(uid)) return { kind: "skip" as const };
        const prior = saved.data();
        if (["accepted", "failed"].includes(prior?.status)) return { kind: "skip" as const };
        if (prior?.status === "sending" && millis(prior.leaseUntil) > now.toMillis()) return { kind: "busy" as const };
        tx.set(ledger, { instructionId, deviceId: device.id, status: "sending", leaseId,
          leaseUntil: Timestamp.fromMillis(now.toMillis() + 120_000), updatedAt: now,
          attempts: Number(prior?.attempts || 0) + 1 });
        return { kind: "send" as const, row };
      });
      if (outcome.kind === "busy") { retry = true; continue; }
      if (outcome.kind !== "send") continue;
      let status = "accepted", code = "";
      try {
        await sender.send(message(outcome.row.token, uid, `announcement-${instructionId}`, instructionId, outcome.row.locale,
          Math.floor((PUSH_LIFETIME_MS - age) / 1000)));
      } catch (error) {
        code = errorCode(error);
        status = transient(error) ? "retry" : "failed";
        if (status === "retry") retry = true;
        if (invalidToken(error)) await removeInvalidDevice(db, device.ref, outcome.row.token);
        console.warn("announcement-push-send", { instructionId, status, code });
      }
      await db.runTransaction(async tx => {
        const current = await tx.get(ledger);
        if (current.data()?.leaseId === leaseId) tx.update(ledger, { status, code, updatedAt: now });
      });
    }
  }
  if (retry) throw new Error("announcement-push-retry");
}
