import { getToken, onTokenChanged, type AppCheck } from "firebase/app-check";
import { getAppCheckRecoveryState, recordAppCheckError, recordAppCheckSuccess, subscribeToAppCheckRecovery } from "./appCheckRecovery";

const RESUME_CHECK_INTERVAL_MS = 60_000;

/** Keep proactive attestation out of hidden/offline tabs; explicit Firebase requests
 * still perform their normal App Check validation. No credentials are bypassed. */
export function startAppCheckLifecycle(appCheck: AppCheck): () => void {
  let active = true;
  let inFlight = false;
  let nextCheckAt = 0;
  let timer: number | undefined;

  function ready() {
    return active && document.visibilityState === "visible" && navigator.onLine !== false && getAppCheckRecoveryState() !== "throttled";
  }

  function clearTimer() {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  }

  function schedule() {
    if (!ready() || inFlight || timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      sync();
    }, Math.max(0, nextCheckAt - Date.now()));
  }

  function failed(error: unknown) {
    if (!active) return;
    // Shared classification distinguishes 403/404 provider lockout from the
    // SDK's shorter throttles for transient failures such as 429 or 500.
    recordAppCheckError(error);
  }

  async function check() {
    if (!ready() || inFlight) return;
    clearTimer();
    inFlight = true;
    try {
      await getToken(appCheck, false);
      if (active) recordAppCheckSuccess(false);
    } catch (error) {
      failed(error);
    } finally {
      inFlight = false;
      nextCheckAt = Date.now() + RESUME_CHECK_INTERVAL_MS;
      schedule();
    }
  }

  function sync() {
    if (!ready()) { clearTimer(); return; }
    if (inFlight) return;
    if (Date.now() >= nextCheckAt) void check();
    else schedule();
  }

  // Keep the SDK's own refresher disabled from initialization. Its installed
  // version cannot cancel a pending sleep reliably; our timer is cancellable.
  // Explicit SDK service requests continue to verify App Check normally.
  const unsubscribeRecovery = subscribeToAppCheckRecovery(sync);
  // Observer success can be a cached token accompanied by an internal refresh
  // failure, so only completed getToken calls record success.
  const unsubscribe = onTokenChanged(appCheck, () => {}, failed);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("focus", sync);
  window.addEventListener("pageshow", sync);
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  sync();

  return () => {
    active = false;
    clearTimer();
    unsubscribe();
    unsubscribeRecovery();
    document.removeEventListener("visibilitychange", sync);
    window.removeEventListener("focus", sync);
    window.removeEventListener("pageshow", sync);
    window.removeEventListener("online", sync);
    window.removeEventListener("offline", sync);
  };
}
