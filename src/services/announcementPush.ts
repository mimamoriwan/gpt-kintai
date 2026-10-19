import { getApp } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import { auth, functions, prepareCallableSecurityContext, preparePublicCallableSecurityContext } from "../firebase";
import { invokeWithVerifiedSecurityContext } from "../lib/callable";
import { ensurePushIdentity, getPushState, readPushValue, savePushState, updateRevocations, type PushDeviceState, type PushRevocation } from "../lib/pushStorage";
import type { Locale } from "../types";

export type PushEnvironment = "supported" | "home-screen" | "unsupported" | "not-configured";
export function getPushEnvironment(): PushEnvironment {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  if (ios && !standalone) return "home-screen";
  if (!window.isSecureContext || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window) || !("indexedDB" in window)) return "unsupported";
  if (!import.meta.env.VITE_FIREBASE_VAPID_KEY) return "not-configured";
  return "supported";
}

let sessionUid: string | null = null;
let generation = 0;
let flushing: Promise<void> | undefined;
let unsubscribing: Promise<void> | undefined;
export const pushSettingsChanged = () => window.dispatchEvent(new Event("announcement-push-settings"));
async function authenticatedCall<T>(name: string, data: unknown): Promise<T> {
  const call = httpsCallable<unknown, T>(functions, name, { timeout: 15_000 });
  return (await invokeWithVerifiedSecurityContext(prepareCallableSecurityContext, () => call(data))).data;
}
export function flushPushRevocations(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const queue = await readPushValue<PushRevocation[]>("revocations") || [];
    for (const item of queue) {
      // A random, single-device secret permits only revocation after logout.
      const call = httpsCallable(functions, "unregisterAnnouncementPushDevice", { timeout: 10_000 });
      await invokeWithVerifiedSecurityContext(preparePublicCallableSecurityContext, () => call(item));
      await updateRevocations(rows => rows.filter(row => row.deviceId !== item.deviceId || row.revokeKey !== item.revokeKey));
    }
  })().finally(() => { flushing = undefined; });
  return flushing;
}

async function queueRemoval(state: PushDeviceState) {
  await savePushState({ ...state, enabled: false });
  await updateRevocations(rows => rows.some(row => row.deviceId === state.deviceId && row.revokeKey === state.revokeKey) ? rows : [...rows, { deviceId: state.deviceId, revokeKey: state.revokeKey }]);
  pushSettingsChanged();
}

export async function disableAnnouncementPush() {
  generation++;
  const state = await getPushState();
  if (state) await queueRemoval(state);
  // Local opt-out is durable before any network request or Firebase sign-out.
  void flushPushRevocations().catch(() => { /* Kept in the durable queue for reconnect. */ });
  if ("serviceWorker" in navigator) {
    unsubscribing = navigator.serviceWorker.getRegistration("/").then(async registration => {
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
    }).catch(() => {}).finally(() => { unsubscribing = undefined; });
  }
}

async function tokenAndRegistration() {
  const sdk = await import("firebase/messaging");
  if (!await sdk.isSupported()) throw new Error("push/unsupported");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("push/worker-not-ready")), 10_000); })
  ]).finally(() => clearTimeout(timer));
  const messaging = sdk.getMessaging(getApp());
  const token = await sdk.getToken(messaging, { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY, serviceWorkerRegistration: registration });
  return { token, registration, messaging, sdk };
}

export async function enableAnnouncementPush(userId: string, locale: Locale) {
  if (getPushEnvironment() !== "supported") throw new Error("push/unsupported");
  // Keep the permission request in the original tap, before any async work.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("push/permission-denied");
  const version = generation;
  if (auth.currentUser?.uid !== userId) throw new Error("push/session-changed");
  const previous = await ensurePushIdentity(userId, locale);
  if (previous.userId !== userId) await queueRemoval(previous);
  await flushPushRevocations();
  await unsubscribing;
  const state: PushDeviceState = { deviceId: previous.deviceId,
    revokeKey: previous.revokeKey,
    userId, enabled: false, locale };
  await savePushState(state);
  const { token } = await tokenAndRegistration();
  if (generation !== version || auth.currentUser?.uid !== userId) throw new Error("push/session-changed");
  await authenticatedCall("registerAnnouncementPushDevice", { deviceId: state.deviceId, revokeKey: state.revokeKey, token, locale });
  if (generation !== version || auth.currentUser?.uid !== userId) {
    await queueRemoval(state);
    void flushPushRevocations().catch(() => {});
    throw new Error("push/session-changed");
  }
  await savePushState({ ...state, enabled: true });
  if (generation !== version || auth.currentUser?.uid !== userId) {
    await queueRemoval(state);
    void flushPushRevocations().catch(() => {});
    throw new Error("push/session-changed");
  }
  pushSettingsChanged();
}

export async function sendAnnouncementPushTest() {
  const state = await getPushState();
  if (!state?.enabled || state.userId !== auth.currentUser?.uid) throw new Error("push/not-registered");
  await authenticatedCall("testAnnouncementPushDevice", { deviceId: state.deviceId, revokeKey: state.revokeKey });
}

export function startAnnouncementPushSession(userId: string | null, locale: Locale, ready = true) {
  if (sessionUid !== userId) { generation++; sessionUid = userId; }
  let active = true;
  let busy = false;
  let lastRefresh = 0;
  let stopMessages: (() => void) | undefined;
  const current = () => active && sessionUid === userId && auth.currentUser?.uid === userId;
  async function refresh() {
    if (busy || navigator.onLine === false || document.visibilityState === "hidden") return;
    busy = true;
    try {
      const state = await getPushState();
      if (!active) return;
      if (state?.enabled && (!userId || state.userId !== userId)) { await disableAnnouncementPush(); return; }
      await flushPushRevocations();
      if (!state?.enabled || !ready) return;
      if (!current() || Date.now() - lastRefresh < 60_000) return;
      if (getPushEnvironment() !== "supported" || Notification.permission !== "granted") { await disableAnnouncementPush(); return; }
      lastRefresh = Date.now();
      const version = generation;
      const { token, registration, sdk, messaging } = await tokenAndRegistration();
      if (!current() || version !== generation) return;
      await authenticatedCall("registerAnnouncementPushDevice", { deviceId: state.deviceId, revokeKey: state.revokeKey, token, locale });
      if (!current() || version !== generation) {
        await queueRemoval(state);
        void flushPushRevocations().catch(() => {});
        return;
      }
      const latest = await getPushState();
      if (!latest?.enabled || latest.userId !== userId || !current()) return;
      await savePushState({ ...latest, locale });
      if (!stopMessages) stopMessages = sdk.onMessage(messaging, payload => {
        if (current()) registration.active?.postMessage({ type: "ANNOUNCEMENT_PUSH", payload: payload.data, requiresVisibleNotification: true });
      });
    } catch { /* Preserve opt-in on transient failures; retry on the next return. */ }
    finally { busy = false; }
  }
  const onReturn = () => { void refresh(); };
  window.addEventListener("online", onReturn);
  window.addEventListener("pageshow", onReturn);
  window.addEventListener("focus", onReturn);
  window.addEventListener("announcement-push-settings", onReturn);
  document.addEventListener("visibilitychange", onReturn);
  void refresh();
  return () => {
    active = false;
    stopMessages?.();
    window.removeEventListener("online", onReturn);
    window.removeEventListener("pageshow", onReturn);
    window.removeEventListener("focus", onReturn);
    window.removeEventListener("announcement-push-settings", onReturn);
    document.removeEventListener("visibilitychange", onReturn);
  };
}
