/// <reference lib="webworker" />
import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage, isSupported } from "firebase/messaging/sw";
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { claimPushEvent, getPushState, releasePushEvent } from "./lib/pushStorage";
import { parsePushPayload, pushNotificationOptions } from "./lib/pushPayload";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision?: string | null }[] };
precacheAndRoute(self.__WB_MANIFEST);
clientsClaim();
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")));

async function showPush(raw: unknown, requiresVisibleNotification = false) {
  const payload = parsePushPayload(raw);
  if (!payload) return;
  const claimed = await claimPushEvent(payload.eventId, payload.userId);
  if (!claimed) {
    const state = await getPushState();
    if (!requiresVisibleNotification || !state?.enabled || state.userId !== payload.userId) return;
  }
  const display = pushNotificationOptions(payload);
  // WebKit requires every real push to display a notification. Reuse the same
  // tag and silence retries rather than dropping a push and losing permission.
  try { await self.registration.showNotification(display.title, { ...display.options, ...(!claimed ? { silent: true } : {}) }); }
  catch { if (claimed) await releasePushEvent(payload.eventId); }
}

// Handle our data messages inside the actual PushEvent, including when a window
// is visible. FCM's foreground relay ends that event before the window's async
// onMessage -> postMessage -> showNotification chain finishes. Register this
// synchronously so a cold worker also receives the event before SDK checks.
self.addEventListener("push", event => {
  let raw: { data?: unknown } | null;
  try { raw = event.data?.json() ?? null; } catch { return; }
  const payload = parsePushPayload(raw?.data);
  if (!payload) return;
  event.stopImmediatePropagation();
  event.waitUntil(showPush(payload, true));
});

// Install this before FCM initializes its own notification-click handling.
self.addEventListener("notificationclick", event => {
  event.stopImmediatePropagation();
  event.notification.close();
  const { instructionId, userId } = event.notification.data || {};
  event.waitUntil((async () => {
    const state = await getPushState();
    if (!state?.enabled || state.userId !== userId) return;
    const id = typeof instructionId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(instructionId) ? instructionId : "";
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find(item => new URL(item.url).origin === self.location.origin);
    if (client) {
      client.postMessage({ type: "OPEN_ANNOUNCEMENT", instructionId: id });
      await client.focus();
    } else {
      await self.clients.openWindow(id ? `/#announcement=${encodeURIComponent(id)}` : "/");
    }
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
  if (event.data?.type === "ANNOUNCEMENT_PUSH") event.waitUntil(showPush(event.data.payload, event.data.requiresVisibleNotification === true));
});

if (import.meta.env.VITE_FIREBASE_PROJECT_ID && import.meta.env.VITE_USE_FIREBASE_EMULATORS !== "true") {
  const app = initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  });
  void isSupported().then(supported => { if (supported) onBackgroundMessage(getMessaging(app), payload => showPush(payload.data, true)); }).catch(() => {});
}
