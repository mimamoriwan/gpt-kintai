import {installAnnouncementPushWorker} from '@coco/announcements/worker';
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

const {showPush}=installAnnouncementPushWorker(self,id=>id?`/#announcement=${encodeURIComponent(id)}`:'/');

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
