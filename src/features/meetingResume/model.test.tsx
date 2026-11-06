import { describe, expect, it } from "vitest";
import { buildResume, hasLegacyClipping, MAX_RESUME_DRAFT_BYTES, parseResumeDraft, resumeStats, serializeResumeDraft, sourceReports } from "./model";
import { resumeHtml } from "./export";
import type { DailyReport, UserProfile, WeeklyReport } from "../../types";
const owner = { uid: "owner", displayName: "作成者", role: "employee_manager", active: true } as UserProfile;
const report = (id: string, date: string, patch: Partial<DailyReport> = {}) => ({ id, reportDate: date, userId: "owner", userName: "作成者", category: "商品開発", activities: "試作品の条件を確認", findings: "仕様を確認できた", nextPlan: "次回の条件を相談", status: "submitted", ...patch }) as DailyReport;
const rows = [report("a", "2026-10-01"), report("b", "2026-10-08", { category: "販促" }), report("c", "2026-10-28"), report("d", "2026-10-31"), report("other", "2026-10-02", { userId: "other" }), report("demo", "2026-10-01", { isDemo: true }), report("provisional", "2026-10-01", { status: "provisional" })];
const build = (reports = rows) => buildResume({ reports, userId: "owner", from: "2026-10-01", to: "2026-10-28", owner, locale: "ja", createdDate: "2026-10-28" });
describe("meeting resume", () => {
  it("uses inclusive real submitted reports for the chosen person and retains full evidence", () => {
    const result = build();
    expect(result.sources.map(r => r.id)).toEqual(["a", "b", "c"]);
    expect(sourceReports(rows, "", result.from, result.to)).toHaveLength(4);
    expect(resumeStats(result)).toMatchObject({ count: 3, days: 3, weeks: [["2026-10-01", 1], ["2026-10-08", 1], ["2026-10-15", 0], ["2026-10-22", 1]], counts: [["商品開発", 2], ["販促", 1]] });
    expect(result.themes[0].issues).toBe("");
  });
  it("uses Japanese translation and retains complete text without inventing outcomes", () => {
    const result = build([report("long", "2026-10-01", { activities: "長".repeat(200), findings: "", nextPlan: "", translatedFields: { category: "翻訳分類" } })]);
    expect(result.themes[0].title).toBe("翻訳分類");
    expect(result.themes[0].activities).toBe("長".repeat(200));
    expect(result.summary).toBe("長".repeat(200));
    expect(result.sources[0].activities).toHaveLength(200);
    expect(result.themes[0].findings).toBe("");
  });
  it("keeps every distinct line and final sentence across days for own and company-wide scopes", () => {
    const texts = Array.from({ length: 6 }, (_, i) => `記録${i + 1}：${"確認事項".repeat(50)}。末尾${i + 1}まで確認済み。`);
    const reports = texts.map((text, i) => report(`full-${i}`, `2026-10-0${i + 1}`, { activities: text, findings: `所見${text}`, nextPlan: `予定${text}`, userId: i === 5 ? "other" : "owner" }));
    for (const userId of ["owner", ""]) {
      const result = buildResume({ reports, userId, from: "2026-10-01", to: "2026-10-28", owner, locale: "ja", createdDate: "2026-10-28" });
      const expected = userId ? texts.slice(0, 5) : texts;
      for (const text of expected) {
        expect(result.summary).toContain(`所見${text}`);
        expect(result.themes[0].activities).toContain(text);
        expect(result.themes[0].findings).toContain(`所見${text}`);
        expect(result.themes[0].nextAction).toContain(`予定${text}`);
      }
      expect(result.themes[0].activities.split("\n")).toHaveLength(expected.length);
      expect(result.summary).not.toContain("…");
      expect(hasLegacyClipping(result)).toBe(false);
      expect(result.textVersion).toBe(2);
    }
  });
  it("round-trips generated text longer than the former 20000-character field cap", () => {
    const full = "長文の意味を最後まで保持します。".repeat(1700) + "最終行まで表示済み。";
    const result = build([report("large", "2026-10-01", { activities: full, findings: full, nextPlan: full })]);
    const restored = parseResumeDraft(serializeResumeDraft(result), owner.uid);
    expect(restored.summary).toBe(full);
    expect(restored.themes[0]).toMatchObject({ activities: full, findings: full, nextAction: full });
    expect(resumeHtml(restored, "ja")).toContain(full);
  });
  it("detects old generated clipping without rewriting user edits or removing literal ellipses", () => {
    const result = build([report("legacy", "2026-10-01", { activities: "文".repeat(200), findings: "検討中…", nextPlan: "担当者の回答待ち..." })]);
    expect(hasLegacyClipping(result)).toBe(false);
    expect(result.themes[0].findings).toBe("検討中…");
    expect(result.themes[0].nextAction).toBe("担当者の回答待ち...");
    delete result.textVersion;
    result.themes[0].activities = "文".repeat(140) + "…";
    const restored = parseResumeDraft(JSON.stringify(result), owner.uid);
    expect(restored.themes[0].activities).toBe(result.themes[0].activities);
    expect(hasLegacyClipping(restored)).toBe(true);
    restored.themes[0].activities = "全文を確認して編集した文章。";
    expect(hasLegacyClipping(restored)).toBe(false);
  });
  it("rejects invalid ranges and empty sets", () => {
    for (const [from, to] of [["2026-02-30", "2026-03-01"], ["2026-11-01", "2026-10-01"], ["2025-01-01", "2026-01-02"]]) expect(() => buildResume({ reports: rows, userId: "owner", from, to, owner, locale: "ja", createdDate: "2026-10-28" })).toThrow();
    expect(() => build([])).toThrow("提出済み日報がありません");
  });
  it("imports only a same-person same-period monthly report and respects excluded themes", () => {
    const monthly = { userId: "owner", reportKind: "monthly", periodStart: "2026-10-01", periodEnd: "2026-10-28", executiveSummary: "確認済みの要点", themes: [{ title: "案件別テーマ", activities: "活動", outcomes: "結果", nextAction: "次回", issues: "課題", sourceReferences: ["日報10/1"], includeInReport: false }] } as WeeklyReport;
    const options = { reports: rows, userId: "owner", from: "2026-10-01", to: "2026-10-28", owner, locale: "ja" as const, createdDate: "2026-10-28", monthly };
    expect(buildResume(options)).toMatchObject({ summary: "確認済みの要点", themes: [{ title: "案件別テーマ", included: false }] });
    expect(() => buildResume({ ...options, monthly: { ...monthly, userId: "other" } })).toThrow();
  });
  it("restores drafts for their owner and rejects malformed, huge or foreign drafts", () => {
    const result = build();
    expect(parseResumeDraft(JSON.stringify(result), owner.uid)).toEqual(result);
    for (const patch of [{ ownerUid: "other" }, { from: [result.from] }, { sources: [{ ...result.sources[0], date: "2026-11-01" }] }, { themes: [{ ...result.themes[0], activities: {} }] }, { version: 2 }, { themes: [result.themes[0], result.themes[0]] }]) expect(() => parseResumeDraft(JSON.stringify({ ...result, ...patch }), owner.uid)).toThrow();
    expect(() => parseResumeDraft("x".repeat(MAX_RESUME_DRAFT_BYTES + 1), owner.uid)).toThrow();
    expect(() => parseResumeDraft("null", owner.uid)).toThrow();
  });
  it("exports only selected themes without private source text by default, and escapes hostile strings", () => {
    const result = build([report("one", "2026-10-01", { activities: "公開する要点\n" + "長".repeat(200) + "非掲載の原文" })]);
    result.themes[0].activities = "公開する要点";
    result.title = '</title><script>alert("x")</script>';
    result.themes.push({ ...result.themes[0], id: "excluded", included: false, title: "隠したテーマ" });
    const html = resumeHtml(result, "ja");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("隠したテーマ");
    expect(html).not.toContain("非掲載の原文");
    expect(html).not.toContain("ownerUid");
    expect(resumeHtml({ ...result, includeSources: true }, "ja")).toContain("非掲載の原文");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.querySelectorAll("script, iframe, a, input, textarea")).toHaveLength(0);
    expect(parsed.documentElement.lang).toBe("ja");
  });
});
