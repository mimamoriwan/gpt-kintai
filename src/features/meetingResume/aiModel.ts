import type { MeetingResume, ResumeSource } from "./model";
import type { Locale, UserProfile } from "../../types";
import { reportPeriodError } from "../../lib/reportPeriod";

interface Claim { text: string; sourceIds: string[] }
interface AiTheme { id: string; title: string; purpose: Claim; activities: Claim[]; outcomes: Claim[]; risks: Claim[]; nextActions: Claim[] }
export interface ResumeDecision { title: string; question: string; reason: string; proposal: string; sourceIds: string[] }
export interface ResumeTimeline { date: string; label: string; themeId: string; sourceIds: string[] }
export interface ResumeRelationship { from: string; to: string; label: string; sourceIds: string[] }
export interface SourceSelection { daily: boolean; business: boolean; todo: boolean }
export interface AiMetadata {
  model: string; generatedAt: string; headline: string; reviewed: boolean;
  timeline: ResumeTimeline[]; relationships: ResumeRelationship[]; decisions: ResumeDecision[];
  notFeatured: { sourceId: string; reason: string }[]; caveats: string[]; notices: string[];
  sourceSelection: SourceSelection;
}
export interface GenerateInput { periodStart: string; periodEnd: string; userId: string; locale: Locale; sources: SourceSelection }
export interface GenerateProgress { stage: "collecting" | "reading" | "composing" | "checking" | "repairing" | "complete"; current?: number; total?: number; count?: number }
export interface GenerateResult {
  model: string; generatedAt: string; sources: ResumeSource[]; notices: string[]; input: GenerateInput;
  brief: { headline: string; summary: Claim[]; themes: AiTheme[]; timeline: ResumeTimeline[]; relationships: ResumeRelationship[]; decisions: ResumeDecision[]; notFeatured: { sourceId: string; reason: string }[]; caveats: string[] };
}
const cited = (c: Claim) => `${c.text} ［${c.sourceIds.join("・")}］`;
export function resumeFromAi(result: GenerateResult, owner: UserProfile, subject: string, createdDate: string): MeetingResume {
  const { input, brief } = result;
  return {
    version: 1, textVersion: 2, ownerUid: owner.uid, userId: input.userId, locale: input.locale,
    title: input.locale === "ja" ? "定例会議 活動・進捗レジュメ" : "例会工作与进展简报",
    from: input.periodStart, to: input.periodEnd, subject, createdDate, summary: brief.summary.map(cited).join("\n"), discussion: "",
    themes: brief.themes.map(t => ({ id: t.id, title: t.title, included: true, purpose: cited(t.purpose),
      activities: t.activities.map(cited).join("\n"), findings: t.outcomes.map(cited).join("\n"), issues: t.risks.map(cited).join("\n"), nextAction: t.nextActions.map(cited).join("\n"),
      references: [...new Set([t.purpose, ...t.activities, ...t.outcomes, ...t.risks, ...t.nextActions].flatMap(c => c.sourceIds))] })),
    sources: result.sources, includeSources: false,
    ai: { model: result.model, generatedAt: result.generatedAt, headline: brief.headline, reviewed: false,
      timeline: brief.timeline, relationships: brief.relationships, decisions: brief.decisions, notFeatured: brief.notFeatured,
      caveats: brief.caveats, notices: result.notices, sourceSelection: input.sources }
  };
}

// Bounded validation for downloaded drafts; never render arbitrary imported markup or graph code.
export function validAiMetadata(ai: AiMetadata, resume: MeetingResume): boolean {
  if (!ai || typeof ai !== "object") return false;
  const text = (s: unknown, max = 3000) => typeof s === "string" && s.length <= max;
  const sourceIds = new Set(resume.sources.map(s => s.id)), themeIds = new Set(resume.themes.map(t => t.id));
  const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 2000 && v.every(id => typeof id === "string" && sourceIds.has(id));
  const array = <T,>(v: T[], max: number, check: (item: T) => boolean) => Array.isArray(v) && v.length <= max && v.every(item => item && check(item));
  return text(ai.model, 100) && text(ai.generatedAt, 50) && Number.isFinite(Date.parse(ai.generatedAt)) && text(ai.headline, 300) && typeof ai.reviewed === "boolean"
    && !!ai.sourceSelection && [ai.sourceSelection.daily, ai.sourceSelection.business, ai.sourceSelection.todo].every(v => typeof v === "boolean")
    && resume.themes.every(t => t.references.every(id => sourceIds.has(id)))
    && array(ai.timeline, 20, t => text(t.date, 10) && !reportPeriodError(t.date, t.date) && t.date >= resume.from && t.date <= resume.to && themeIds.has(t.themeId) && text(t.label) && ids(t.sourceIds))
    && array(ai.relationships, 12, r => themeIds.has(r.from) && themeIds.has(r.to) && r.from !== r.to && text(r.label) && ids(r.sourceIds))
    && array(ai.decisions, 6, d => [d.title, d.question, d.reason, d.proposal].every(s => text(s)) && ids(d.sourceIds))
    && array(ai.notFeatured, 2000, n => sourceIds.has(n.sourceId) && text(n.reason))
    && array(ai.caveats, 12, s => text(s)) && array(ai.notices, 20, s => text(s));
}
