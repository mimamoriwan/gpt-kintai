export type CompanyDayOverride = { dayType: "company_holiday" | "workday"; label?: string };

export function resolveCompanyDay(date: string, override?: CompanyDayOverride): { isHoliday: boolean; label: string; source: string } {
  if (override) return { isHoliday: override.dayType === "company_holiday", label: override.label?.trim() || (override.dayType === "company_holiday" ? "会社休日" : "通常出勤日"), source: "override" };
  const name = japaneseHolidayName(date);
  if (name) return { isHoliday: true, label: name, source: "national_holiday" };
  const parsed = parseDate(date);
  if (parsed) {
    const weekday = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
    if (weekday === 0 || weekday === 6) return { isHoliday: true, label: weekday === 0 ? "日曜日" : "土曜日", source: "weekend" };
  }
  return { isHoliday: false, label: "通常出勤日", source: "regular_workday" };
}

export function japaneseHolidayName(date: string): string | null {
  const parsed = parseDate(date); if (!parsed) return null;
  return buildJapaneseHolidays(parsed.year).get(date) || null;
}

function buildJapaneseHolidays(year: number): Map<string, string> {
  const values = new Map<string, string>();
  const add = (month: number, day: number, label: string) => values.set(key(year, month, day), label);
  add(1, 1, "元日"); add(1, nthWeekday(year, 1, 1, 2), "成人の日"); add(2, 11, "建国記念の日");
  if (year >= 2020) add(2, 23, "天皇誕生日");
  add(3, Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4)), "春分の日");
  add(4, 29, "昭和の日"); add(5, 3, "憲法記念日"); add(5, 4, "みどりの日"); add(5, 5, "こどもの日");
  add(7, nthWeekday(year, 7, 1, 3), "海の日"); add(8, 11, "山の日"); add(9, nthWeekday(year, 9, 1, 3), "敬老の日");
  add(9, Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4)), "秋分の日");
  add(10, nthWeekday(year, 10, 1, 2), "スポーツの日"); add(11, 3, "文化の日"); add(11, 23, "勤労感謝の日");
  const total = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
  for (let day = 2; day < total; day += 1) {
    const current = dayKey(year, day);
    if (!values.has(current) && values.has(dayKey(year, day - 1)) && values.has(dayKey(year, day + 1))) values.set(current, "国民の休日");
  }
  for (const holiday of [...values.keys()].sort()) {
    if (weekday(holiday) !== 0) continue;
    let candidate = addDays(holiday, 1); while (values.has(candidate)) candidate = addDays(candidate, 1);
    values.set(candidate, "振替休日");
  }
  return values;
}

function parseDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]); const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { year, month, day } : null;
}
function key(year: number, month: number, day: number): string { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function nthWeekday(year: number, month: number, weekday: number, nth: number): number { return 1 + ((weekday - new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 7) % 7) + (nth - 1) * 7; }
function dayKey(year: number, day: number): string { return new Date(Date.UTC(year, 0, day)).toISOString().slice(0, 10); }
function weekday(value: string): number { const parsed = parseDate(value)!; return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay(); }
function addDays(value: string, amount: number): string { const parsed = parseDate(value)!; return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + amount)).toISOString().slice(0, 10); }
