import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { aiFixture } from "./__fixtures__/ai";
import { resumeFromAi } from "./aiModel";
import { parseResumeDraft, serializeResumeDraft } from "./model";
import { resumeHtml } from "./export";
import { ResumeDocument } from "./ResumeDocument";
import type { UserProfile } from "../../types";
const owner = { uid: "owner" } as UserProfile;
const draft = () => resumeFromAi(aiFixture(), owner, "会社全体", "2026-10-28");
describe("AI brief document and draft integrity", () => {
  it("preserves source citations, all source types, decisions and diagram data across draft saves", () => {
    const value = draft(); expect(parseResumeDraft(serializeResumeDraft(value), "owner")).toEqual(value);
    expect(value.themes[0].references).toEqual(["S001", "S002"]); expect(value.themes[0].findings).toContain("常温試験は未実施。");
    expect(value.ai?.reviewed).toBe(false);
  });
  it("requires the author's review before exporting an AI artifact", () => {
    expect(() => resumeHtml(draft(), "ja")).toThrow("確認してから配布");
    const value = draft(); value.ai!.reviewed = true;
    expect(resumeHtml(value, "ja")).toContain("作成者が内容・図解を確認済み。");
  });
  it("renders the storyline, actual reported progress, timeline and decisions rather than report-count charts", () => {
    const value = draft(), html = renderToStaticMarkup(<ResumeDocument resume={value} locale="ja" />);
    for (const text of ["進展をたどる", "共有To Doの進捗", "70%", "取り組みのつながり", "目的・位置づけ", "この会議で決めたいこと", "検討案（未決定）"]) expect(html).toContain(text);
    expect(html).not.toContain("日報の分類別件数"); expect(html).not.toContain("原記録の全文は参考資料でのみ表示する。");
    expect(html).not.toContain("width:100%");
  });
  it("never renders a hidden theme's timeline, relation or To Do progress", () => {
    const value = draft(); value.themes[0].included = false;
    const html = renderToStaticMarkup(<ResumeDocument resume={value} locale="ja" />);
    expect(html).not.toContain("比較と品質評価を実施"); expect(html).not.toContain("共有To Doの進捗"); expect(html).not.toContain("取り組みのつながり");
  });
  it("escapes the optional full source appendix and retains long text endings", () => {
    const value = draft(); value.ai!.reviewed = true; value.includeSources = true;
    value.summary = "要点".repeat(300) + "要点の最終文。";
    const html = resumeHtml(value, "ja");
    expect(html).toContain("要点の最終文。"); expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;"); expect(html).not.toContain("<script>");
  });
  it("rejects malformed imported diagrams, unknown citations and out-of-range progress", () => {
    for (const mutate of [
      (value: ReturnType<typeof draft>) => { value.ai!.timeline[0].themeId = "unknown"; },
      (value: ReturnType<typeof draft>) => { value.ai!.decisions[0].sourceIds = ["invented"]; },
      (value: ReturnType<typeof draft>) => { value.sources[1].progress = 200; }
    ]) { const value = draft(); mutate(value); expect(() => parseResumeDraft(JSON.stringify(value), "owner")).toThrow(); }
  });
});
