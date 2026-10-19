import type { registerSW } from "virtual:pwa-register";

export interface AppUpdateState {
  available: boolean;
  applying: boolean;
  failed: boolean;
}

let state: AppUpdateState = { available: false, applying: false, failed: false };
const listeners = new Set<() => void>();
let initialized = false;
let updateServiceWorker: ReturnType<typeof registerSW> | undefined;
let reloadTimeout: ReturnType<typeof setTimeout> | undefined;
let activationAttempt = 0;

const UPDATE_CHECK_INTERVAL = 5 * 60_000;
const UPDATE_CHECK_THROTTLE = 60_000;

function watchForUpdates(registration: ServiceWorkerRegistration) {
  // Registration already checks for a new version. Check again when a long-lived
  // browser tab or installed app returns, without activating anything automatically.
  let lastCheckedAt = Date.now();
  let checking = false;
  async function checkForUpdate() {
    if (document.visibilityState !== "visible" || navigator.onLine === false ||
      state.available || checking || registration.installing ||
      Date.now() - lastCheckedAt < UPDATE_CHECK_THROTTLE) return;
    lastCheckedAt = Date.now();
    checking = true;
    try {
      await registration.update();
    } catch {
      // A background check may fail offline. Keep the current app usable and
      // retry on a later check; this is separate from a user-requested update.
    } finally {
      checking = false;
    }
  }
  const check = () => { void checkForUpdate(); };
  document.addEventListener("visibilitychange", check);
  window.addEventListener("focus", check);
  window.addEventListener("pageshow", check);
  window.addEventListener("online", check);
  window.setInterval(check, UPDATE_CHECK_INTERVAL);
}

function changeState(next: AppUpdateState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function getAppUpdateState() {
  return state;
}

export function subscribeToAppUpdate(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Register once outside React effects so StrictMode cannot create duplicate listeners.
export function initializeAppUpdates(register: typeof registerSW) {
  if (initialized) return;
  initialized = true;
  updateServiceWorker = register({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (registration) watchForUpdates(registration);
    },
    onNeedRefresh() {
      if (!state.available) changeState({ available: true, applying: false, failed: false });
    }
  });
}

// Only an explicit user action may activate the waiting version.
export async function applyAppUpdate() {
  if (!state.available || state.applying || !updateServiceWorker) return;
  const attempt = ++activationAttempt;
  if (reloadTimeout) clearTimeout(reloadTimeout);
  changeState({ available: true, applying: true, failed: false });
  // Start the deadline before requesting activation: a browser can leave the
  // request itself pending, as well as completing it without reloading the page.
  const deadline = new Promise<void>((resolve) => {
    reloadTimeout = setTimeout(() => {
      if (attempt === activationAttempt) {
        reloadTimeout = undefined;
        changeState({ available: true, applying: false, failed: true });
      }
      resolve();
    }, 15_000);
  });
  try {
    // A successful activation reloads this page. Keep duplicate clicks disabled
    // while it happens, but allow retry if the browser never completes the switch.
    await Promise.race([updateServiceWorker(true), deadline]);
  } catch {
    if (attempt !== activationAttempt) return;
    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = undefined;
    changeState({ available: true, applying: false, failed: true });
  }
}
