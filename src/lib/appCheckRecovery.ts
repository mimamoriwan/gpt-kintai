export type AppCheckRecoveryState = "temporary" | "throttled" | null;

let state: AppCheckRecoveryState = null;
const listeners = new Set<() => void>();

// Some existing screens pass Error.message through notify(). Recognize the SDK's
// embedded code as well as Error.code without treating all 403s as App Check errors.
export function getAppCheckErrorKind(error: unknown): AppCheckRecoveryState {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : "";
  const message = typeof error === "string" ? error
    : typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  const match = `${code} ${message}`.match(/\bapp-?check\/([a-z-]+)/i);
  if (!match) return null;
  if (!["throttled", "initial-throttle"].includes(match[1].toLowerCase())) return "temporary";
  const data = typeof error === "object" && error !== null && "customData" in error ? error.customData : null;
  const httpStatus = data && typeof data === "object" && "httpStatus" in data
    ? Number(data.httpStatus) : Number(message.match(/(?:previous\s+|due to\s+|AppCheck:\s*)(\d{3})\s+error/i)?.[1]);
  // The SDK uses the same throttle code for short 429/5xx backoff and day-long
  // 403/404 attestation failures. Short server backoff must be allowed to recover.
  if (Number.isFinite(httpStatus) && httpStatus >= 400 && httpStatus !== 403 && httpStatus !== 404) return "temporary";
  return "throttled";
}

function publish(next: AppCheckRecoveryState) {
  if (state === next) return;
  state = next;
  listeners.forEach(listener => listener());
}

export function recordAppCheckError(error: unknown): void {
  const kind = getAppCheckErrorKind(error);
  if (kind && state !== "throttled") publish(kind);
}

export function recordAppCheckSuccess(fresh = false): void {
  // A cached token can still be valid while the provider is throttled. Do not
  // mistake that token for proof that a fresh attestation will succeed.
  if (state === "temporary" || fresh) publish(null);
}

export function getAppCheckRecoveryState(): AppCheckRecoveryState {
  return state;
}

export function subscribeToAppCheckRecovery(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
