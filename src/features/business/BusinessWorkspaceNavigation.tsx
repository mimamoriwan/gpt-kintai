import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import "./workspace.css";

type View = "business" | "weeklyTodo";

export function BusinessWorkspaceNavigation({ view, onView, children }: {
  view: View;
  onView: (view: View) => void;
  children: ReactNode;
}) {
  const { locale } = useI18n();
  const ja = locale === "ja";
  return <section className="business-workspace" aria-labelledby="business-workspace-title">
    <header className="business-workspace-header">
      <h1 id="business-workspace-title">{ja ? "会社の取り組み" : "公司重点工作"}</h1>
      <p>{ja ? "会社全体の予定と、一人ひとりの今週の仕事を確認できます。" : "查看公司整体计划和每位成员本周的工作。"}</p>
    </header>
    <div className="business-workspace-tabs" role="group" aria-label={ja ? "会社の取り組みの表示" : "公司重点工作视图"}>
      <button type="button" data-business-work-tab aria-pressed={view === "business"} onClick={() => { if (view !== "business") onView("business"); }}>
        {ja ? "全体計画" : "整体计划"}
      </button>
      <button type="button" data-business-work-tab aria-pressed={view === "weeklyTodo"} onClick={() => { if (view !== "weeklyTodo") onView("weeklyTodo"); }}>
        {ja ? "今週やること" : "本周要做的事"}
      </button>
    </div>
    {children}
  </section>;
}
