import { describe, expect, it, vi } from "vitest";
import { evidenceChunks, generateBrief, type Ask } from "./pipeline.js";
import { validateBrief, type Brief, type Evidence, type Input } from "./domain.js";
import { HttpsError } from "firebase-functions/v2/https";

const input: Input = { periodStart: "2026-10-01", periodEnd: "2026-10-28", userId: "", locale: "ja", sources: { daily: true, business: true, todo: true } };
const source: Evidence = { id: "S001", kind: "daily", date: "2026-10-02", name: "担当", category: "開発", activities: "比較を行った。", findings: "常温試験は未実施。", nextPlan: "試験条件を相談する。" };
const claim = { text: "比較を進め、常温試験の条件が未決定である。", sourceIds: [source.id] };
const brief = (): Brief => ({ headline: "比較は前進、試験条件は要判断", summary: [claim], themes: [{ id: "theme-1", title: "品質評価", purpose: claim, activities: [claim], outcomes: [], risks: [claim], nextActions: [claim] }], timeline: [{ date: source.date, label: "比較を実施", themeId: "theme-1", sourceIds: [source.id] }], decisions: [], relationships: [], notFeatured: [], caveats: [] });
function mockAsk(audits: boolean[] = [true]) {
  return vi.fn<Ask>(async q => q.name === "meeting_facts" ? { facts: (q.data as { sources: Evidence[] }).sources.map(s => ({ sourceId: s.id, topic: "品質", action: s.activities, outcome: s.findings, risk: "条件未確定", nextAction: s.nextPlan })) } : q.name === "meeting_brief" ? brief() : { passed: audits.shift() ?? false, issues: audits.length ? ["未実施の試験を完了としないこと"] : [] });
}
describe("evidence-grounded meeting pipeline", () => {
  it("actually calls reading, composing and checking and emits real stages", async () => {
    const ask = mockAsk(), progress = vi.fn(async () => undefined);
    expect(await generateBrief(input, [source], ask, progress)).toEqual(brief());
    expect(ask.mock.calls.map(([q]) => q.name)).toEqual(["meeting_facts", "meeting_brief", "meeting_audit"]);
    expect(progress.mock.calls.map(([p]: any[]) => p.stage)).toEqual(["reading", "composing", "checking", "complete"]);
    expect(JSON.stringify(ask.mock.calls)).toContain("常温試験は未実施。");
  });
  it("repairs an audit finding and checks again before returning", async () => {
    const ask = mockAsk([false, true]);
    await generateBrief(input, [source], ask, async () => undefined);
    expect(ask.mock.calls.map(([q]) => q.name)).toEqual(["meeting_facts", "meeting_brief", "meeting_audit", "meeting_brief", "meeting_audit"]);
    expect(ask.mock.calls[3][0].instruction).toContain("未実施の試験を完了としないこと");
    expect((ask.mock.calls[3][0].data as any).previousBrief).toEqual(brief());
  });
  it.each([
    ["unsupported_timeline_date", () => ({ ...brief(), timeline: [{ ...brief().timeline[0], date: "2026-10-03" }] })],
    ["timeline_date_outside_period", () => ({ ...brief(), timeline: [{ ...brief().timeline[0], date: "2026-09-30" }] })],
    ["unknown_timeline_theme", () => ({ ...brief(), timeline: [{ ...brief().timeline[0], themeId: "absent" }] })],
    ["unknown_source", () => ({ ...brief(), summary: [{ ...claim, sourceIds: ["invented"] }] })],
    ["schema", () => ({ ...brief(), themes: [] })]
  ])("repairs %s before a factual audit and never returns the invalid draft", async (code, invalid) => {
    const ask = mockAsk(), original = ask.getMockImplementation()!, bad = (invalid as () => unknown)();
    let compositions = 0;
    ask.mockImplementation(async q => q.name === "meeting_brief" && compositions++ === 0 ? bad : original(q));
    const progress = vi.fn(async () => undefined);
    expect(await generateBrief(input, [source], ask, progress)).toEqual(brief());
    expect(ask.mock.calls.map(([q]) => q.name)).toEqual(["meeting_facts", "meeting_brief", "meeting_brief", "meeting_audit"]);
    expect(ask.mock.calls[2][0].instruction).toContain(code);
    expect((ask.mock.calls[2][0].data as any).previousBrief).toEqual(bad);
    expect((ask.mock.calls[1][0].data as any).allowedTimelineDates).toEqual([{ sourceId: "S001", dates: ["2026-10-02"] }]);
    expect(progress.mock.calls.map(([p]: any[]) => p.stage)).toEqual(["reading", "composing", "repairing", "checking", "complete"]);
  });
  it("stops after one unsuccessful structural repair with safe actionable metadata", async () => {
    const ask = mockAsk(), original = ask.getMockImplementation()!;
    ask.mockImplementation(async q => q.name === "meeting_brief" ? { ...brief(), timeline: [{ ...brief().timeline[0], date: "2026-10-03" }] } : original(q));
    await expect(generateBrief(input, [source], ask, async () => undefined)).rejects.toMatchObject({ code: "data-loss", details: { validationIssues: [{ code: "unsupported_timeline_date", path: "timeline[0].date" }] } });
    expect(ask.mock.calls.map(([q]) => q.name)).toEqual(["meeting_facts", "meeting_brief", "meeting_brief"]);
  });
  it("does not grant another repair after a structural repair passes but the audit fails", async () => {
    const ask = mockAsk([false]), original = ask.getMockImplementation()!;
    let compositions = 0;
    ask.mockImplementation(async q => q.name === "meeting_brief" && compositions++ === 0 ? { ...brief(), timeline: [{ ...brief().timeline[0], date: "2026-10-03" }] } : original(q));
    await expect(generateBrief(input, [source], ask, async () => undefined)).rejects.toMatchObject({ code: "data-loss" });
    expect(ask.mock.calls.map(([q]) => q.name)).toEqual(["meeting_facts", "meeting_brief", "meeting_brief", "meeting_audit"]);
  });
  it("rejects an invalid repair of an audit finding without buying a third composition", async () => {
    const ask = mockAsk([false]), original = ask.getMockImplementation()!;
    let compositions = 0;
    ask.mockImplementation(async q => q.name === "meeting_brief" && compositions++ === 1 ? { ...brief(), timeline: [{ ...brief().timeline[0], themeId: "absent" }] } : original(q));
    await expect(generateBrief(input, [source], ask, async () => undefined)).rejects.toMatchObject({ code: "data-loss", details: { validationIssues: [{ code: "unknown_timeline_theme", path: "timeline[0].themeId" }] } });
    expect(ask.mock.calls.map(([q]) => q.name)).toEqual(["meeting_facts", "meeting_brief", "meeting_audit", "meeting_brief"]);
  });
  it.each([new Error("network failure"), new HttpsError("data-loss", "incomplete provider output"), new HttpsError("deadline-exceeded", "provider timeout")])("does not retry provider failures even when they use a data-loss code", async error => {
    const ask = mockAsk(), original = ask.getMockImplementation()!;
    ask.mockImplementation(async q => { if (q.name === "meeting_brief") throw error; return original(q); });
    await expect(generateBrief(input, [source], ask, async () => undefined)).rejects.toBe(error);
    expect(ask.mock.calls.map(([q]) => q.name)).toEqual(["meeting_facts", "meeting_brief"]);
  });
  it("never substitutes a category concatenation when AI or the audit fails", async () => {
    await expect(generateBrief(input, [source], mockAsk([false, false]), async () => undefined)).rejects.toMatchObject({ code: "data-loss" });
    await expect(generateBrief(input, [source], async () => { throw Error("network"); }, async () => undefined)).rejects.toThrow("network");
  });
  it("detects a source that was not read rather than silently losing it", async () => {
    const ask = mockAsk(); ask.mockResolvedValueOnce({ facts: [] });
    await expect(generateBrief(input, [source], ask, async () => undefined)).rejects.toMatchObject({ code: "data-loss" });
    expect(ask).toHaveBeenCalledOnce();
  });
  it("passes every long record to exactly one chunk with its ending intact", () => {
    const sources = Array.from({ length: 130 }, (_, i) => ({ ...source, id: `S${i}`, activities: "長文".repeat(600) + `最後の文${i}。` }));
    const chunks = evidenceChunks(sources);
    expect(chunks.length).toBeGreaterThan(1); expect(chunks.flat()).toEqual(sources);
    expect(() => evidenceChunks([{ ...source, activities: "長".repeat(100000) }])).toThrow("省略していません");
  });
});
describe("brief provenance validation", () => {
  it("rejects invented references, theme identifiers and dates", () => {
    for (const bad of [
      { ...brief(), summary: [{ ...claim, sourceIds: ["invented"] }] },
      { ...brief(), timeline: [{ ...brief().timeline[0], date: "2026-10-03" }] },
      { ...brief(), timeline: [{ ...brief().timeline[0], themeId: "missing" }] },
      { ...brief(), relationships: [{ from: "theme-1", to: "theme-1", label: "創作", sourceIds: ["S001"] }] }
    ]) expect(() => validateBrief(bad, [source], input)).toThrow();
  });
  it("requires every source to be cited or explicitly accounted for as not featured", () => {
    const other = { ...source, id: "S002" };
    expect(() => validateBrief(brief(), [source, other], input)).toThrow("一部の記録");
    expect(validateBrief({ ...brief(), notFeatured: [{ sourceId: "S002", reason: "同じ内容の再掲" }] }, [source, other], input).notFeatured).toHaveLength(1);
    expect(() => validateBrief({ ...brief(), notFeatured: [{ sourceId: "S001", reason: "重複" }] }, [source], input)).toThrow();
  });
});
