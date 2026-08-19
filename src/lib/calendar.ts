import type { CalendarEvent, CalendarEventInput } from "../types";

export type CalendarGridDay = {
  date: string;
  dayNumber: number;
  inCurrentMonth: boolean;
};

export const CALENDAR_MEMBER_COLORS = [
  { color: "#2563eb", soft: "#dbeafe" },
  { color: "#059669", soft: "#d1fae5" },
  { color: "#7c3aed", soft: "#ede9fe" },
  { color: "#d97706", soft: "#ffedd5" },
  { color: "#db2777", soft: "#fce7f3" },
  { color: "#0f766e", soft: "#ccfbf1" },
  { color: "#c2410c", soft: "#ffedd5" },
  { color: "#475569", soft: "#e2e8f0" }
] as const;

export function calendarGridDays(month: string): CalendarGridDay[] {
  const first = parseMonth(month);
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const value = date.toISOString().slice(0, 10);
    return { date: value, dayNumber: date.getUTCDate(), inCurrentMonth: value.slice(0, 7) === month };
  });
}

export function calendarGridRange(month: string): { fromDate: string; toDate: string } {
  const days = calendarGridDays(month);
  return { fromDate: days[0].date, toDate: days[days.length - 1].date };
}

export function shiftCalendarMonth(month: string, amount: number): string {
  const date = parseMonth(month);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

export function sortCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    const date = a.date.localeCompare(b.date);
    if (date) return date;
    const time = (a.startTime || "").localeCompare(b.startTime || "");
    if (time) return time;
    return a.title.localeCompare(b.title, "ja");
  });
}

export function isEveryoneCalendarEvent(event: CalendarEvent, memberIds: string[]): boolean {
  if (memberIds.length < 2 || memberIds.length > 3 || event.participants.length !== memberIds.length) return false;
  const participants = new Set(event.participants.map((item) => item.memberId || item.userId || ""));
  return memberIds.every((userId) => participants.has(userId));
}

export function calendarMemberColorMap(userIds: string[]): Map<string, number> {
  const assignments = new Map<string, number>();
  const used = new Set<number>();
  for (const userId of [...new Set(userIds)].sort()) {
    const preferred = stableHash(userId) % CALENDAR_MEMBER_COLORS.length;
    let colorIndex = preferred;
    for (let offset = 0; offset < CALENDAR_MEMBER_COLORS.length; offset += 1) {
      const candidate = (preferred + offset) % CALENDAR_MEMBER_COLORS.length;
      if (!used.has(candidate)) {
        colorIndex = candidate;
        break;
      }
    }
    assignments.set(userId, colorIndex);
    used.add(colorIndex);
  }
  return assignments;
}

export function calendarEventPayload(input: CalendarEventInput): CalendarEventInput {
  return {
    eventType: input.eventType,
    startDate: input.startDate,
    endDate: input.endDate,
    title: input.title,
    startTime: input.startTime || "",
    endTime: input.endTime || "",
    memo: input.memo || "",
    participantIds: input.participantIds,
    ...(input.id ? { id: input.id } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {})
  };
}

function parseMonth(month: string): Date {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Invalid calendar month");
  const date = new Date(`${month}-01T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 7) !== month) throw new Error("Invalid calendar month");
  return date;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
