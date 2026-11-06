import type { DailyReport, Locale, UserProfile, WeeklyReport } from "../../types";
import { reportPeriodError } from "../../lib/reportPeriod";
import { validAiMetadata, type AiMetadata } from "./aiModel";

export interface ResumeSource { id: string; date: string; name: string; category: string; activities: string; findings: string; nextPlan: string; kind?: "daily" | "business" | "todo"; progress?: number; recordId?: string }
export interface ResumeTheme { id: string; title: string; included: boolean; activities: string; findings: string; nextAction: string; issues: string; references: string[]; purpose?: string }
export const MAX_RESUME_TEXT_LENGTH = 2_000_000;
export const MAX_RESUME_DRAFT_BYTES = 20 * 1024 * 1024;

export interface MeetingResume {
  version: 1; textVersion?: 2; ownerUid: string; userId: string; locale: Locale; title: string; from: string; to: string; subject: string; createdDate: string;
  summary: string; discussion: string; themes: ResumeTheme[]; sources: ResumeSource[]; includeSources: boolean;
  ai?: AiMetadata;
}
export function sourceReports(reports: DailyReport[], userId: string, from: string, to: string): DailyReport[] {
  if (reportPeriodError(from, to)) return [];
  return reports.filter(r => r.status === "submitted" && r.isDemo !== true && (!userId || r.userId === userId) && r.reportDate >= from && r.reportDate <= to)
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.id.localeCompare(b.id));
}
function field(report: DailyReport, key: "category" | "activities" | "findings" | "nextPlan", locale: Locale) {
  return (locale === "ja" ? report.translatedFields?.[key]?.trim() || report[key] : report[key])?.trim() || "";
}
function completeLines(values: string[]): string {
  // Exact duplicate lines may be combined; never shorten or silently drop distinct text.
  return [...new Set(values.flatMap(text => text.split(/\n+/)).map(s => s.replace(/^\s*[-・●•]\s*/, "").trim()).filter(Boolean))].join("\n");
}

export function hasLegacyClipping(resume: MeetingResume): boolean {
  const original = new Set(resume.sources.flatMap(source => [source.activities, source.findings, source.nextPlan]).flatMap(text => completeLines([text]).split("\n")));
  const clipped = new Set([...original].filter(line => line.length > 140).map(line => line.slice(0, 140) + "…"));
  return [resume.summary, ...resume.themes.flatMap(theme => [theme.activities, theme.findings, theme.nextAction])]
    .some(text => completeLines([text]).split("\n").some(line => clipped.has(line) && !original.has(line)));
}

export function serializeResumeDraft(resume: MeetingResume): string {
  if ([resume.summary, resume.discussion, ...resume.themes.flatMap(t => [t.activities, t.findings, t.issues, t.nextAction])].some(text => text.length > MAX_RESUME_TEXT_LENGTH)) throw new Error("本文が1項目200万文字の下書き上限を超えています。全文は表示しています。対象期間を分けて作成してください。");
  const text = JSON.stringify(resume, null, 2);
  if (new TextEncoder().encode(text).length > MAX_RESUME_DRAFT_BYTES) throw new Error("下書きが20MBを超えるため保存できません。文章を省略せずに表示しています。対象期間を分けて作成してください。");
  return text;
}
export function buildResume(input: { reports: DailyReport[]; userId: string; from: string; to: string; owner: UserProfile; locale: Locale; createdDate: string; monthly?: WeeklyReport }): MeetingResume {
  const { from, to, owner, locale, monthly } = input;
  const error = reportPeriodError(from, to, locale === "zh-CN");
  if (error) throw new Error(error);
  const rows = sourceReports(input.reports, input.userId, from, to);
  if (!rows.length) throw new Error(locale === "ja" ? "対象期間の提出済み日報がありません。" : "此期间没有已提交日报。");
  const sources = rows.map(r => ({ id: r.id, date: r.reportDate, name: r.userName, category: field(r, "category", locale) || (locale === "ja" ? "その他" : "其他"), activities: field(r, "activities", locale), findings: field(r, "findings", locale), nextPlan: field(r, "nextPlan", locale) }));
  const groups = new Map<string, ResumeSource[]>();
  for (const row of sources) groups.set(row.category, [...(groups.get(row.category) || []), row]);
  let themes: ResumeTheme[] = [...groups].map(([title, group], i) => ({ id: `theme-${i}`, title, included: true, activities: completeLines(group.map(r => r.activities).reverse()), findings: completeLines(group.map(r => r.findings).reverse()), nextAction: completeLines(group.map(r => r.nextPlan).reverse()), issues: "", references: group.map(r => `${r.date} ${r.name}`) }));
  if (monthly) {
    if (monthly.reportKind !== "monthly" || monthly.periodStart !== from || monthly.periodEnd !== to || monthly.userId !== input.userId || monthly.isDemo) throw new Error("対象者・期間が一致する月次レポートを選択してください。");
    themes = monthly.themes.map((t, i) => ({ id: `monthly-${i}`, title: t.title, included: t.includeInReport !== false, activities: t.activities, findings: t.outcomes, nextAction: t.nextAction, issues: t.issues, references: t.sourceReferences }));
  }
  return { version: 1, textVersion: 2, ownerUid: owner.uid, userId: input.userId, locale, title: locale === "ja" ? "定例会議 業務レジュメ" : "例会业务简报", from, to, subject: input.userId ? rows[0].userName : (locale === "ja" ? "全員" : "全员"), createdDate: input.createdDate, summary: monthly?.executiveSummary || completeLines(sources.map(r => r.findings).reverse()) || completeLines(sources.map(r => r.activities).reverse()), discussion: "", themes, sources, includeSources: false };
}
export function resumeStats(resume: MeetingResume) {
  const counts = new Map<string, number>();
  const weeks = new Map<string, number>();
  // Include weeks without reports, anchored to the selected start date.
  for (let t = Date.parse(resume.from); t <= Date.parse(resume.to); t += 7 * 86400000) weeks.set(new Date(t).toISOString().slice(0, 10), 0);
  for (const row of resume.sources) {
    counts.set(row.category, (counts.get(row.category) || 0) + 1);
    const offset = Math.floor((Date.parse(row.date) - Date.parse(resume.from)) / (7 * 86400000));
    const week = new Date(Date.parse(resume.from) + offset * 7 * 86400000).toISOString().slice(0, 10);
    weeks.set(week, (weeks.get(week) || 0) + 1);
  }
  return { count: resume.sources.length, days: new Set(resume.sources.map(r => r.date)).size, counts: [...counts].sort((a, b) => b[1] - a[1]), weeks: [...weeks], themes: resume.themes.filter(t => t.included) };
}

// Downloaded drafts contain business records; accept bounded plain data only.
export function parseResumeDraft(text: string, ownerUid: string): MeetingResume {
  const fail = () => { throw new Error("このアカウントで保存したレジュメ下書き（JSON）を選択してください。"); };
  if (new TextEncoder().encode(text).length > MAX_RESUME_DRAFT_BYTES) return fail();
  let r: MeetingResume;
  try { r = JSON.parse(text); } catch { return fail(); }
  const str = (v: unknown, max = MAX_RESUME_TEXT_LENGTH): v is string => typeof v === "string" && v.length <= max;
  if (!r || r.version !== 1 || (r.textVersion !== undefined && r.textVersion !== 2) || r.ownerUid !== ownerUid || !str(r.userId, 128) || !["ja", "zh-CN"].includes(r.locale) || !str(r.title, 200) || !str(r.subject, 200) || !str(r.createdDate, 10) || reportPeriodError(r.createdDate, r.createdDate) || !str(r.from, 10) || !str(r.to, 10) || reportPeriodError(r.from, r.to) || !str(r.summary) || !str(r.discussion) || typeof r.includeSources !== "boolean" || !Array.isArray(r.themes) || r.themes.length > 1000 || !Array.isArray(r.sources) || r.sources.length > 5000 || !r.sources.length) return fail();
  if (!r.themes.every(t => t && str(t.id, 200) && str(t.title, 200) && (t.purpose === undefined || str(t.purpose)) && typeof t.included === "boolean" && [t.activities, t.findings, t.nextAction, t.issues].every(v => str(v)) && Array.isArray(t.references) && t.references.length <= 5000 && t.references.every(v => str(v, 200)))) return fail();
  if (new Set(r.themes.map(t => t.id)).size !== r.themes.length) return fail();
  if (!r.sources.every(s => s && str(s.id, 200) && str(s.name, 200) && str(s.category, 500) && str(s.date, 10) && !reportPeriodError(s.date, s.date) && s.date >= r.from && s.date <= r.to && [s.activities, s.findings, s.nextPlan].every(v => str(v)))) return fail();
  if (new Set(r.sources.map(s => s.id)).size !== r.sources.length || !r.sources.every(s => (s.recordId === undefined || str(s.recordId, 500)) && (s.kind === undefined || ["daily", "business", "todo"].includes(s.kind)) && (s.progress === undefined || (Number.isFinite(s.progress) && s.progress >= 0 && s.progress <= 100)))) return fail();
  if (r.ai !== undefined && !validAiMetadata(r.ai, r)) return fail();
  return r;
}
