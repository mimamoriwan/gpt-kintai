import { describe, expect, it } from "vitest";
import { BriefValidationError, timelineDateOptions, validateBrief, type Brief, type Evidence, type Input } from "./domain.js";

const input: Input = { periodStart: "2026-10-01", periodEnd: "2026-10-28", userId: "", locale: "ja", sources: { daily: true, business: true, todo: true } };
const source: Evidence = { id: "S001", kind: "daily", date: "2026-10-02", name: "担当", category: "試験", activities: "試験準備", findings: "条件を確認", nextPlan: "条件を相談" };
const claim = { text: "試験条件を確認", sourceIds: [source.id] };
const brief = (): Brief => ({ headline: "試験準備", summary: [claim], themes: [{ id: "theme-1", title: "試験", purpose: claim, activities: [claim], outcomes: [], risks: [], nextActions: [] }], timeline: [{ date: source.date, label: "試験準備を記録", themeId: "theme-1", sourceIds: [source.id] }], decisions: [], relationships: [], notFeatured: [], caveats: [] });
function issues(value: unknown, sources = [source], period = input) {
  try { validateBrief(value, sources, period); throw new Error("Expected validation failure"); }
  catch (error) { expect(error).toBeInstanceOf(BriefValidationError); return (error as BriefValidationError).details; }
}
describe("grounded timeline dates", () => {
  it("allows only exact valid in-period ISO dates from the referenced record's date and text fields", () => {
    const record = { ...source, activities: "2026-10-01に開始。2026-10-05に比較。2026-09-30は過去。2026-10-022は番号。", findings: "2026-10-06に確認。2026-10-06に再確認。", nextPlan: "2026-10-28に相談予定。2026-10-29は翌日。10/07は年未確認。" };
    expect(timelineDateOptions([record], input)).toEqual([{ sourceId: source.id, dates: ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-28"] }]);
    for (const date of ["2026-10-01", "2026-10-06", "2026-10-28"]) expect(validateBrief({ ...brief(), timeline: [{ ...brief().timeline[0], date }] }, [record], input).timeline[0].date).toBe(date);
  });
  it("does not accept impossible dates even when they occur literally in the source", () => {
    const period = { ...input, periodStart: "2026-02-01", periodEnd: "2026-03-01" };
    const record = { ...source, date: "2026-02-01", activities: "2026-02-29に試験" };
    expect(timelineDateOptions([record], period)).toEqual([{ sourceId: "S001", dates: ["2026-02-01"] }]);
    expect(issues({ ...brief(), timeline: [{ ...brief().timeline[0], date: "2026-02-29" }] }, [record], period)).toEqual({ validationIssues: [{ code: "unsupported_timeline_date", path: "timeline[0].date" }] });
  });
  it("requires the date to belong to a cited source rather than any record in the period", () => {
    const other = { ...source, id: "S002", date: "2026-10-03" };
    expect(issues({ ...brief(), timeline: [{ ...brief().timeline[0], date: other.date }], notFeatured: [{ sourceId: other.id, reason: "関連記録の再掲" }] }, [source, other])).toEqual({ validationIssues: [{ code: "unsupported_timeline_date", path: "timeline[0].date" }] });
  });
  it("identifies missing themes separately from out-of-period dates without leaking either value", () => {
    expect(issues({ ...brief(), timeline: [{ ...brief().timeline[0], date: "2026-09-30", themeId: "PRIVATE_THEME_TEXT" }] })).toEqual({ validationIssues: [
      { code: "unknown_timeline_theme", path: "timeline[0].themeId" }, { code: "timeline_date_outside_period", path: "timeline[0].date" }
    ] });
  });
});
describe("safe complete-record validation", () => {
  it("does not expose model-generated keys or values from malformed JSON in metadata or messages", () => {
    const invalid = { ...brief(), PRIVATE_MODEL_KEY: "PRIVATE_BODY", summary: [{ text: 123, sourceIds: ["PRIVATE_RECORD_ID"] }] };
    try { validateBrief(invalid, [source], input); throw new Error("Expected validation failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(BriefValidationError);
      const safe = JSON.stringify({ message: (error as Error).message, details: (error as BriefValidationError).details });
      expect(safe).not.toContain("PRIVATE_"); expect(safe).toContain("summary[0].text");
    }
  });
  it("still rejects unknown citations, repeated themes, invalid relationships and missing coverage", () => {
    const other = { ...source, id: "S002" };
    const invalid = { ...brief(), summary: [{ ...claim, sourceIds: ["PRIVATE_RECORD_ID"] }], themes: [brief().themes[0], brief().themes[0]], relationships: [{ from: "theme-1", to: "theme-1", label: "関連", sourceIds: [source.id] }] };
    expect(issues(invalid, [source, other])).toEqual({ validationIssues: [
      { code: "unknown_source", path: "summary[0].sourceIds[0]" }, { code: "duplicate_theme", path: "themes[1].id" },
      { code: "invalid_relationship", path: "relationships[0]" }, { code: "unaccounted_source", path: "notFeatured" }
    ] });
  });
  it("keeps cited and unfeatured records disjoint and rejects duplicate or invented exclusions", () => {
    const invalid = { ...brief(), notFeatured: [{ sourceId: "S001", reason: "掲載済み" }, { sourceId: "S001", reason: "重複" }, { sourceId: "PRIVATE_ID", reason: "不明" }] };
    expect(issues(invalid)).toEqual({ validationIssues: [
      { code: "cited_and_omitted_source", path: "notFeatured[0].sourceId" }, { code: "duplicate_omitted_source", path: "notFeatured[1].sourceId" },
      { code: "cited_and_omitted_source", path: "notFeatured[1].sourceId" }, { code: "unknown_omitted_source", path: "notFeatured[2].sourceId" }
    ] });
  });
});
