export async function invokeWithVerifiedSecurityContext<T>(
  prepare: (forceRefresh: boolean) => Promise<void>,
  invoke: () => Promise<T>
): Promise<T> {
  try {
    await prepare(false);
  } catch {
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

export function isUnauthenticatedCallableError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  return code === "unauthenticated" || code === "functions/unauthenticated";
}
