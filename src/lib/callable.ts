export async function invokeWithVerifiedSecurityContext<T>(
  prepare: (forceRefresh: boolean) => Promise<void>,
  invoke: () => Promise<T>
): Promise<T> {
  try {
    await prepare(false);
  } catch (error) {
    // A forced refresh cannot clear App Check's provider backoff.
    if (isAppCheckThrottleError(error)) throw error;
    await prepare(true);
  }

  try {
    return await invoke();
  } catch (error) {
    if (!isUnauthenticatedCallableError(error)) throw error;
    await prepare(true);
    return invoke();
  }
}

export function isAppCheckThrottleError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "").replace(/^appCheck\//, "app-check/")
    : "";
  return code === "app-check/throttled" || code === "app-check/initial-throttle";
}

export function isUnauthenticatedCallableError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  return code === "unauthenticated" || code === "functions/unauthenticated";
}
