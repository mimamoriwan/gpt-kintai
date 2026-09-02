import { createHash } from "node:crypto";

export const AUTOMATIC_REPORT_MAX_ATTEMPTS = 3;

export type AutomaticReportStatus = "queued" | "generating" | "created" | "blocked_no_memo" | "failed";
export type AutomaticReportTrigger = "clock_out" | "day_rollover" | "memo_updated";
export type AutomaticReportCreationMethod = "auto_clock_out" | "auto_day_rollover";

export function dailyReportDocumentId(userId: string, reportDate: string): string {
  return createHash("sha256").update(`daily-report:${userId}:${reportDate}`).digest("hex").slice(0, 48);
}

export function dailyReportAutomationId(userId: string, reportDate: string): string {
  return createHash("sha256").update(`daily-report-automation:${userId}:${reportDate}`).digest("hex").slice(0, 48);
}

export function previousJstDate(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(date.getTime() - 24 * 60 * 60 * 1000));
}

export function reportIsSubmitted(status: unknown): boolean {
  // Records created before provisional reports existed always represent a
  // formally submitted report even if the status field is unexpectedly absent.
  return status !== "provisional";
}

export function automaticCreationMethod(trigger: AutomaticReportTrigger): AutomaticReportCreationMethod {
  return trigger === "day_rollover" ? "auto_day_rollover" : "auto_clock_out";
}

export function eligibleForAutomaticReport(profile: Record<string, unknown>): boolean {
  return profile.active !== false && profile.isDemo !== true && profile.role !== "president_viewer";
}
