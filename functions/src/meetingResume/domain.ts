import { z } from "zod";
import { HttpsError } from "firebase-functions/v2/https";
import { reportPeriodSchema } from "../reportPeriod.js";

export const MODEL = "gpt-6.1-sol";
export const inputSchema = reportPeriodSchema.safeExtend({
  userId: z.string().max(128).regex(/^[A-Za-z0-9_-]*$/), locale: z.enum(["ja", "zh-CN"]),
  sources: z.object({ daily: z.boolean(), business: z.boolean(), todo: z.boolean() }).strict()
}).strict();
export type Input = z.infer<typeof inputSchema>;
export interface Evidence {
  id: string; kind: "daily" | "business" | "todo"; date: string; name: string;
  category: string; activities: string; findings: string; nextPlan: string;
  progress?: number; recordId?: string;
}
export interface Progress { stage: "collecting" | "reading" | "composing" | "checking" | "repairing" | "complete"; current?: number; total?: number; count?: number }
const text = z.string().min(1).max(2400);
const ids = z.array(z.string().min(1).max(200)).min(1).max(2000);
export const claimSchema = z.object({ text, sourceIds: ids }).strict();
export const factsSchema = z.object({ facts: z.array(z.object({
  sourceId: z.string(), topic: text, action: z.string().max(6000), outcome: z.string().max(6000),
  risk: z.string().max(4000), nextAction: z.string().max(4000)
}).strict()).max(2000) }).strict();
export const briefSchema = z.object({
  headline: z.string().min(1).max(160),
  summary: z.array(claimSchema).min(1).max(7),
  themes: z.array(z.object({
    id: z.string().regex(/^theme-[0-9]+$/), title: z.string().min(1).max(160), purpose: claimSchema,
    activities: z.array(claimSchema).min(1).max(8), outcomes: z.array(claimSchema).max(6),
    risks: z.array(claimSchema).max(5), nextActions: z.array(claimSchema).max(5)
  }).strict()).min(1).max(20),
  timeline: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: text, themeId: z.string(), sourceIds: ids }).strict()).max(20),
  decisions: z.array(z.object({ title: text, question: text, reason: text, proposal: text, sourceIds: ids }).strict()).max(6),
  relationships: z.array(z.object({ from: z.string(), to: z.string(), label: text, sourceIds: ids }).strict()).max(12),
  notFeatured: z.array(z.object({ sourceId: z.string(), reason: text }).strict()).max(2000),
  caveats: z.array(text).max(12)
}).strict();
export const auditSchema = z.object({ passed: z.boolean(), issues: z.array(text).max(20) }).strict();
export type Brief = z.infer<typeof briefSchema>;
export function claims(brief: Brief) {
  return [...brief.summary, ...brief.themes.flatMap(t => [t.purpose, ...t.activities, ...t.outcomes, ...t.risks, ...t.nextActions]), ...brief.timeline, ...brief.decisions, ...brief.relationships];
}
export type BriefIssueCode = "schema" | "unknown_source" | "duplicate_theme" | "unknown_timeline_theme" | "timeline_date_outside_period" | "unsupported_timeline_date" | "invalid_relationship" | "unknown_omitted_source" | "duplicate_omitted_source" | "cited_and_omitted_source" | "unaccounted_source";
export interface BriefValidationIssue { code: BriefIssueCode; path: string }
const issueMessages: Record<BriefIssueCode, string> = {
  schema: "AI資料の形式を確認できませんでした。",
  unknown_source: "AIの参照先に不整合があります。",
  duplicate_theme: "AIのテーマが重複しています。",
  unknown_timeline_theme: "AIが存在しないテーマを図解に指定しました。",
  timeline_date_outside_period: "AIが対象期間外の日付を図解に指定しました。",
  unsupported_timeline_date: "AIが記録で確認できない日付を図解に指定しました。",
  invalid_relationship: "AIの関連図を確認できません。",
  unknown_omitted_source: "AIの掲載対象外の参照先に不整合があります。",
  duplicate_omitted_source: "AIの掲載対象外の記録が重複しています。",
  cited_and_omitted_source: "AIが本文で参照した記録を掲載対象外にも指定しました。",
  unaccounted_source: "AIが一部の記録を照合できませんでした。"
};
export class BriefValidationError extends HttpsError {
  readonly validationIssues: BriefValidationIssue[];
  constructor(issues: BriefValidationIssue[]) {
    const bounded = issues.slice(0, 40);
    super("data-loss", issueMessages[bounded[0].code] + "原記録と資料の整合性を確認できないため、途中の資料は表示していません。", { validationIssues: bounded });
    this.validationIssues = bounded;
  }
}
const schemaFields = new Set(["headline", "summary", "themes", "id", "title", "purpose", "activities", "outcomes", "risks", "nextActions", "text", "sourceIds", "timeline", "date", "label", "themeId", "decisions", "question", "reason", "proposal", "relationships", "from", "to", "notFeatured", "sourceId", "caveats"]);
function safeSchemaPath(parts: PropertyKey[]) {
  // Never reflect an AI-generated object key or value into diagnostic metadata.
  return parts.map(part => typeof part === "number" ? `[${part}]` : `.${schemaFields.has(String(part)) ? String(part) : "field"}`).join("").replace(/^\./, "") || "$";
}
function validDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export function timelineDateOptions(sources: Evidence[], input: Input) {
  return sources.map(source => ({ sourceId: source.id, dates: [...new Set([
    source.date, ...[source.activities, source.findings, source.nextPlan].flatMap(value => value.match(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g) || [])
  ])].filter(date => validDate(date) && date >= input.periodStart && date <= input.periodEnd).sort() }));
}
export function validateBrief(value: unknown, sources: Evidence[], input: Input): Brief {
  const parsed = briefSchema.safeParse(value);
  if (!parsed.success) throw new BriefValidationError(parsed.error.issues.map(issue => ({ code: "schema", path: safeSchemaPath(issue.path) })));
  const brief = parsed.data;
  const issues: BriefValidationIssue[] = [];
  const issue = (code: BriefIssueCode, path: string) => { if (issues.length < 40) issues.push({ code, path }); };
  const available = new Map(sources.map(s => [s.id, s]));
  const covered = new Set<string>();
  const inspectClaim = (claim: { sourceIds: string[] }, path: string) => claim.sourceIds.forEach((id, index) => {
    if (!available.has(id)) issue("unknown_source", `${path}.sourceIds[${index}]`);
    else covered.add(id);
  });
  brief.summary.forEach((claim, i) => inspectClaim(claim, `summary[${i}]`));
  brief.themes.forEach((theme, i) => {
    inspectClaim(theme.purpose, `themes[${i}].purpose`);
    for (const field of ["activities", "outcomes", "risks", "nextActions"] as const) theme[field].forEach((claim, j) => inspectClaim(claim, `themes[${i}].${field}[${j}]`));
  });
  for (const field of ["timeline", "decisions", "relationships"] as const) brief[field].forEach((claim, i) => inspectClaim(claim, `${field}[${i}]`));
  const themes = new Set(brief.themes.map(t => t.id));
  brief.themes.forEach((theme, i) => { if (brief.themes.findIndex(t => t.id === theme.id) !== i) issue("duplicate_theme", `themes[${i}].id`); });
  const allowedDates = new Map(timelineDateOptions(sources, input).map(item => [item.sourceId, item.dates]));
  brief.timeline.forEach((entry, i) => {
    if (!themes.has(entry.themeId)) issue("unknown_timeline_theme", `timeline[${i}].themeId`);
    if (entry.date < input.periodStart || entry.date > input.periodEnd) issue("timeline_date_outside_period", `timeline[${i}].date`);
    else if (!entry.sourceIds.some(id => allowedDates.get(id)?.includes(entry.date))) issue("unsupported_timeline_date", `timeline[${i}].date`);
  });
  brief.relationships.forEach((entry, i) => { if (entry.from === entry.to || !themes.has(entry.from) || !themes.has(entry.to)) issue("invalid_relationship", `relationships[${i}]`); });
  const omitted = new Set<string>();
  brief.notFeatured.forEach((item, i) => {
    if (!available.has(item.sourceId)) issue("unknown_omitted_source", `notFeatured[${i}].sourceId`);
    if (omitted.has(item.sourceId)) issue("duplicate_omitted_source", `notFeatured[${i}].sourceId`);
    if (covered.has(item.sourceId)) issue("cited_and_omitted_source", `notFeatured[${i}].sourceId`);
    omitted.add(item.sourceId);
  });
  if (sources.some(s => !covered.has(s.id) && !omitted.has(s.id))) issue("unaccounted_source", "notFeatured");
  if (issues.length) throw new BriefValidationError(issues);
  return brief;
}
