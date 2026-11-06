import type { GenerateResult } from "../aiModel";
export function aiFixture(): GenerateResult {
  const claim = { text: "比較表を完成し、常温試験は未実施。", sourceIds: ["S001", "S002"] };
  return {
    model: "gpt-6.1-sol", generatedAt: "2026-10-28T01:00:00.000Z", notices: ["架空データによる試験"],
    input: { periodStart: "2026-10-01", periodEnd: "2026-10-28", userId: "", locale: "ja", sources: { daily: true, business: true, todo: true } },
    sources: [
      { id: "S001", kind: "daily", date: "2026-10-03", name: "担当", category: "品質", activities: "原記録の全文は参考資料でのみ表示する。<script>alert(1)</script>", findings: "常温試験は未実施。", nextPlan: "試験条件を確認。" },
      { id: "S002", kind: "todo", date: "2026-10-09", name: "担当", category: "比較表と評価", activities: "比較表完成・全体70％", findings: "評価は継続", nextPlan: "", progress: 70 },
      { id: "S003", kind: "business", date: "2026-10-14", name: "社長", category: "調達", activities: "見積り未着、発注保留。", findings: "未発注", nextPlan: "" }
    ],
    brief: {
      headline: "比較は前進、試験条件と調達判断が残る", summary: [claim, { text: "見積りが未着で発注を保留している。", sourceIds: ["S003"] }],
      themes: [
        { id: "theme-1", title: "品質評価", purpose: claim, activities: [claim], outcomes: [claim], risks: [claim], nextActions: [{ text: "常温試験の条件を確認する。", sourceIds: ["S001"] }] },
        { id: "theme-2", title: "調達判断", purpose: { text: "見積りに基づいて容器の調達を判断する。", sourceIds: ["S003"] }, activities: [{ text: "見積り期限を確認した。", sourceIds: ["S003"] }], outcomes: [], risks: [{ text: "見積りが届いていない。", sourceIds: ["S003"] }], nextActions: [] }
      ],
      timeline: [{ date: "2026-10-03", label: "比較と品質評価を実施", themeId: "theme-1", sourceIds: ["S001"] }, { date: "2026-10-14", label: "投稿：発注判断を保留", themeId: "theme-2", sourceIds: ["S003"] }],
      decisions: [{ title: "試験条件を合意する", question: "常温試験をどの条件で行うか。", reason: "未試験のため発売の判断ができない。", proposal: "提案：品質担当と条件を決める。", sourceIds: ["S001"] }],
      relationships: [{ from: "theme-1", to: "theme-2", label: "発売判断のために並行確認", sourceIds: ["S001", "S003"] }], notFeatured: [], caveats: ["発売日は未確定。"]
    }
  };
}
