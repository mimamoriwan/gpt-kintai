import { HttpsError } from "firebase-functions/v2/https";

// Upper bounds, not expected durations. The overall budget also bounds large inputs/repair.
export const WORK_TIMEOUT_MS = 30 * 60_000;
export const FUNCTION_TIMEOUT_SECONDS = 31 * 60;
export const LEASE_TIMEOUT_MS = 32 * 60_000;
export const AI_TIMEOUT_MS = { meeting_facts: 3 * 60_000, meeting_brief: 10 * 60_000, meeting_audit: 5 * 60_000 } as const;
export const AI_STAGE_LABEL = { meeting_facts: "記録の読み取り", meeting_brief: "資料の構成", meeting_audit: "原記録との照合" } as const;

export function deadline(milliseconds: number, message: string, parent?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new HttpsError("deadline-exceeded", message)), milliseconds);
  return { signal: parent ? AbortSignal.any([parent, controller.signal]) : controller.signal, dispose: () => clearTimeout(timer) };
}
