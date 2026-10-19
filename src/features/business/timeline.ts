import type { BusinessInitiative } from "./types";

/** Month arithmetic never converts a planned month through a time zone. */
export function monthIndex(month: string): number {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match || Number(match[1]) < 1900 || Number(match[1]) > 2199) throw new Error("Invalid planned month");
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}
export function monthAt(index: number): string {
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
}
export function validPlannedPeriod(start: string, end: string): boolean {
  if (!start && !end) return true;
  try { return monthIndex(start) <= monthIndex(end); } catch { return false; }
}
export function todayMarker(now = new Date()): { month: string; day: number; fraction: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const year = Number(parts.find(p => p.type === "year")!.value);
  const month = parts.find(p => p.type === "month")!.value;
  const day = Number(parts.find(p => p.type === "day")!.value);
  const days = new Date(Date.UTC(year, Number(month), 0)).getUTCDate();
  return { month: `${year}-${month}`, day, fraction: (day - 0.5) / days };
}
export function buildTimeline(initiatives: Pick<BusinessInitiative, "plannedStartMonth" | "plannedEndMonth">[], now = new Date()): { months: string[]; todayMonth: string } {
  const todayMonth = todayMarker(now).month;
  const periods = initiatives.filter(row => row.plannedStartMonth && row.plannedEndMonth && validPlannedPeriod(row.plannedStartMonth, row.plannedEndMonth));
  const first = periods.length ? Math.min(...periods.map(row => monthIndex(row.plannedStartMonth))) : monthIndex(todayMonth);
  const last = periods.length ? Math.max(...periods.map(row => monthIndex(row.plannedEndMonth))) : first + 5;
  return { months: Array.from({ length: last - first + 1 }, (_, index) => monthAt(first + index)), todayMonth };
}
export function milestoneCount(row: Pick<BusinessInitiative, "milestones">): { completed: number; total: number } {
  const active = row.milestones.filter(step => !step.archived);
  return { completed: active.filter(step => step.completed).length, total: active.length };
}
