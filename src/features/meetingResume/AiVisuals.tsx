import type { MeetingResume } from "./model";
import type { Locale } from "../../types";

export function AiVisuals({ resume, locale }: { resume: MeetingResume; locale: Locale }) {
  const ai = resume.ai!;
  const l = (ja: string, zh: string) => locale === "ja" ? ja : zh;
  const themes = new Map(resume.themes.filter(t => t.included).map(t => [t.id, t]));
  const referenced = new Set([...themes.values()].flatMap(t => t.references));
  const progress = resume.sources.filter(s => s.kind === "todo" && s.progress !== undefined && referenced.has(s.id));
  const timeline = ai.timeline.filter(t => themes.has(t.themeId)).sort((a, b) => a.date.localeCompare(b.date));
  const relationships = ai.relationships.filter(r => themes.has(r.from) && themes.has(r.to));
  return <>
    {timeline.length > 0 && <section className="mr-ai-timeline"><h2><small>02</small>{l("進展をたどる", "进展脉络")}</h2><p className="mr-caption">{l("記録にある重要な出来事。共有・投稿の日付は、実施日と区別して記載しています。", "记录中的重要事件，共享或发帖日期与实施日期区分表述。")}</p><ol>{timeline.map((t, i) => <li key={i}><time>{t.date.slice(5).replace("-", "/")}</time><div><b>{themes.get(t.themeId)?.title}</b><p>{t.label}</p><SourceIds ids={t.sourceIds} /></div></li>)}</ol></section>}
    {progress.length > 0 && <section className="mr-ai-progress"><h2>{l("共有To Doの進捗", "共享待办进度")}</h2><p className="mr-caption">{l("期間内の最終共有時点に本人が入力した値です。テーマ全体の達成率ではありません。", "为期间内最后一次共享时本人录入的值，不代表整个主题的完成率。")}</p>{progress.map(s => <div className="mr-progress-item" key={s.id}><div><b>{s.category}</b><strong>{s.progress}%</strong></div><div className="mr-progress-track"><i style={{ width: `${s.progress}%` }} /></div><p>{s.name} · {s.date} <SourceIds ids={[s.id]} /></p></div>)}</section>}
    {relationships.length > 0 && <section className="mr-ai-relationships"><h2>{l("取り組みのつながり", "工作之间的关联")}</h2>{relationships.map((r, i) => <div className="mr-relationship" key={i}><b>{themes.get(r.from)?.title}</b><div><span>{r.label}</span><SourceIds ids={r.sourceIds} /></div><b>{themes.get(r.to)?.title}</b></div>)}</section>}
  </>;
}
export function AiDecisions({ resume, locale }: { resume: MeetingResume; locale: Locale }) {
  if (!resume.ai) return null;
  const l = (ja: string, zh: string) => locale === "ja" ? ja : zh;
  const featuredIds = new Set(resume.themes.filter(t => t.included).flatMap(t => t.references));
  const decisions = resume.ai.decisions.filter(d => d.sourceIds.some(id => featuredIds.has(id)));
  return <>
    {decisions.length > 0 && <section className="mr-decisions"><h2><small>05</small>{l("この会議で決めたいこと", "本次会议需决定的事项")}</h2>{decisions.map((d, i) => <section className="mr-decision" key={i}><header><span>{i + 1}</span><h3>{d.title}</h3></header><h4>{l("確認したいこと", "待确认事项")}</h4><p>{d.question}</p><h4>{l("判断が必要な理由", "需要判断的原因")}</h4><p>{d.reason}</p><h4>{l("検討案（未決定）", "讨论方案（尚未决定）")}</h4><p>{d.proposal}</p><SourceIds ids={d.sourceIds} /></section>)}</section>}
    {(resume.ai.caveats.length > 0 || resume.ai.notices.length > 0) && <section className="mr-ai-caveats"><h3>{l("資料を読む際の留意点", "阅读说明")}</h3><ul>{[...resume.ai.caveats, ...resume.ai.notices].map((s, i) => <li key={i}>{s}</li>)}</ul></section>}
  </>;
}
function SourceIds({ ids }: { ids: string[] }) { return <small className="mr-citations">［{ids.join("・")}］</small>; }
