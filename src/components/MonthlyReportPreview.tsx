import type { Locale, WeeklyReport, WeeklyReportTheme } from "../types";

interface Props {
  report: WeeklyReport;
  themes: WeeklyReportTheme[];
  locale: Locale;
  dirty: boolean;
}

export function MonthlyReportPreview({ report, themes, locale, dirty }: Props) {
  const zh = locale === "zh-CN";
  const selected = themes.filter((theme) => theme.includeInReport !== false);
  const fields = [
    ["objective", zh ? "目的" : "目的"], ["activities", zh ? "实施内容" : "実施内容"],
    ["outcomes", zh ? "成果与进展" : "成果・進捗"], ["evidence", zh ? "依据与成果资料" : "根拠・成果物"],
    ["chinaMarketInsight", zh ? "中国市场观点" : "中国市場の視点"],
    ["issues", zh ? "课题与未解决事项" : "課題・未解決事項"], ["nextAction", zh ? "后续行动" : "次の一手"]
  ] as const;
  return <section className="weekly-print-area monthly-report-preview" aria-label={zh ? "月报输出预览" : "月次レポートの出力プレビュー"}>
    <header className="weekly-report-heading">
      <div><small>MONTHLY BUSINESS REVIEW</small><h2>{zh ? "月度业务报告" : "月次業務レポート"}</h2><p>{report.periodStart || report.weekStart} 〜 {report.periodEnd || report.weekEnd}</p></div>
      <div><strong>{report.userName}</strong><span>{report.status === "finalized" && !dirty ? (zh ? "确定版" : "確定版") : (zh ? "草稿" : "下書き")}</span>{report.isDemo && <span className="demo-badge compact">DEMO</span>}</div>
    </header>
    <h3>{zh ? "按主题、项目回顾" : "テーマ・案件別の振り返り"}</h3>
    {!selected.length && <p>{zh ? "请选择至少一个要输出的主题。" : "出力するテーマを1件以上選択してください。"}</p>}
    {selected.map((theme, index) => <article key={index} className="monthly-output-theme">
      <h3>{String(index + 1).padStart(2, "0")}　{theme.title || (zh ? "无标题主题" : "名称未設定のテーマ")}</h3>
      {fields.map(([key, label]) => theme[key] && <section key={key}><h4>{label}</h4><p>{theme[key]}</p></section>)}
      {theme.sourceReferences.length > 0 && <section><h4>{zh ? "参考记录" : "参照した記録"}</h4><p>{theme.sourceReferences.join("、")}</p></section>}
    </article>)}
  </section>;
}
