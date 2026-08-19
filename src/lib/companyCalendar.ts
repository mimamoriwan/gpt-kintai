import type { CompanyHolidayOverride } from "../types";

export type CompanyDayStatus = {
  isHoliday: boolean;
  source: "regular_workday" | "weekend" | "national_holiday" | "override";
  label: string;
};

export function resolveCompanyDay(date: string, override?: CompanyHolidayOverride): CompanyDayStatus {
  if (override) {
    return {
      isHoliday: override.dayType === "company_holiday",
      source: "override",
      label: override.label?.trim() || (override.dayType === "company_holiday" ? "会社休日" : "通常出勤日")
    };
  }
  const holidayName = japaneseHolidayName(date);
  if (holidayName) return { isHoliday: true, source: "national_holiday", label: holidayName };
  const parsed = parseDate(date);
  if (parsed) {
    const weekday = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
    if (weekday === 0 || weekday === 6) return { isHoliday: true, source: "weekend", label: weekday === 0 ? "日曜日" : "土曜日" };
  }
  return { isHoliday: false, source: "regular_workday", label: "通常出勤日" };
}

export function japaneseHolidayName(date: string): string | null {
  const parsed = parseDate(date);
  if (!parsed) return null;
  return buildJapaneseHolidays(parsed.year).get(date) || null;
}

function buildJapaneseHolidays(year: number): Map<string, string> {
  const holidays = new Map<string, string>();
  const add = (month: number, day: number, label: string) => holidays.set(dateKey(year, month, day), label);
  add(1, 1, "元日");
  add(1, nthWeekday(year, 1, 1, 2), "成人の日");
  add(2, 11, "建国記念の日");
  if (year >= 2020) add(2, 23, "天皇誕生日");
  add(3, vernalEquinoxDay(year), "春分の日");
  add(4, 29, "昭和の日");
  add(5, 3, "憲法記念日");
  add(5, 4, "みどりの日");
  add(5, 5, "こどもの日");
  add(7, nthWeekday(year, 7, 1, 3), "海の日");
  add(8, 11, "山の日");
  add(9, nthWeekday(year, 9, 1, 3), "敬老の日");
  add(9, autumnEquinoxDay(year), "秋分の日");
  add(10, nthWeekday(year, 10, 1, 2), "スポーツの日");
  add(11, 3, "文化の日");
  add(11, 23, "勤労感謝の日");

  // 国民の祝日に挟まれた平日は「国民の休日」です。
  for (let day = 2; day < daysInYear(year); day += 1) {
    const current = dateFromDayOfYear(year, day);
    if (!holidays.has(current) && holidays.has(dateFromDayOfYear(year, day - 1)) && holidays.has(dateFromDayOfYear(year, day + 1))) {
      holidays.set(current, "国民の休日");
    }
  }
  // 日曜の祝日は、後続する最初の非祝日へ振り替えます。
  for (const key of [...holidays.keys()].sort()) {
    if (weekdayOf(key) !== 0) continue;
    let candidate = addDays(key, 1);
    while (holidays.has(candidate)) candidate = addDays(candidate, 1);
    holidays.set(candidate, "振替休日");
  }
  return holidays;
}

function parseDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function nthWeekday(year: number, month: number, weekday: number, nth: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
}
function vernalEquinoxDay(year: number): number { return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4)); }
function autumnEquinoxDay(year: number): number { return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4)); }
function weekdayOf(value: string): number { const parsed = parseDate(value)!; return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay(); }
function addDays(value: string, amount: number): string { const parsed = parseDate(value)!; const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + amount)); return date.toISOString().slice(0, 10); }
function daysInYear(year: number): number { return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365; }
function dateFromDayOfYear(year: number, day: number): string { return new Date(Date.UTC(year, 0, day)).toISOString().slice(0, 10); }
