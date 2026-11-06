import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Clock3 } from "lucide-react";
import { useI18n } from "../../i18n";
import { todayJst } from "../../lib/format";
import { businessErrorCode, businessErrorMessage, getBusinessRetrospective } from "./api";
import { businessCopy, dateLabel, memberNames, statusLabel } from "./presentation";
import type { BusinessRetrospective, BusinessRetrospectiveInput, RetrospectiveSnapshot } from "./types";
import "./retrospective.css";

export function BusinessRetrospectivePage({ onOpenInitiative }: { onOpenInitiative: (id: string) => void }) {
  const { locale } = useI18n();
  const c = businessCopy(locale);
  const today = todayJst();
  const [form, setForm] = useState({ from: today.slice(0, 7) + "-01", to: today, assigneeId: "" });
  const [request, setRequest] = useState<BusinessRetrospectiveInput>({ from: form.from, to: form.to });
  const [result, setResult] = useState<BusinessRetrospective>();
  const [members, setMembers] = useState<BusinessRetrospective["members"]>([]);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    void getBusinessRetrospective(request).then(report => {
      if (!active) return;
      setResult(report);
      setMembers(report.members);
    }).catch(caught => {
      if (!active) return;
      setError(caught);
      setMembers([]);
      setForm(value => ({ ...value, assigneeId: "" }));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [request]);

  function aggregate() {
    const days = (Date.parse(form.to) - Date.parse(form.from)) / 86_400_000 + 1;
    if (!(days >= 1 && days <= 366) || form.to > today) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setLoading(true);
    setError(undefined);
    setResult(undefined);
    setRequest({ from: form.from, to: form.to, ...(form.assigneeId ? { assigneeId: form.assigneeId } : {}) });
  }
  const rangeMessage = c("本日までの366日以内の期間を指定してください。", "请选择截至今天且不超过366天的日期范围。");
  return <section className="business-retrospective" aria-label={c("実績・振り返り", "成果与回顾")}>
    <form className="retrospective-filters" onSubmit={event => { event.preventDefault(); aggregate(); }}>
      <label>{c("開始日", "开始日期")}<input type="date" required max={today} value={form.from} onChange={event => setForm({ ...form, from: event.target.value })} /></label>
      <label>{c("終了日", "结束日期")}<input type="date" required max={today} value={form.to} onChange={event => setForm({ ...form, to: event.target.value })} /></label>
      <label>{c("担当", "负责人")}<select value={form.assigneeId} onChange={event => setForm({ ...form, assigneeId: event.target.value })}>
        <option value="">{c("全員", "全体成员")}</option>
        {members.filter(member => member.active).map(member => <option key={member.uid} value={member.uid}>{member.displayName}</option>)}
      </select></label>
      <button type="submit" className="button primary" disabled={loading}>{c("集計する", "汇总")}</button>
    </form>
    {invalid && <p role="alert">{rangeMessage}</p>}
    {loading && <p role="status">{c("期間内の記録を集計しています…", "正在汇总所选期间的记录…")}</p>}
    {error != null && <p role="alert">{businessErrorCode(error) === "resource-exhausted"
      ? c("記録が多いため、対象期間の開始日を新しくしてください。", "记录过多，请选择更近的开始日期。")
      : businessErrorMessage(error, locale)}</p>}
    {result && <RetrospectiveResults report={result} openInitiative={onOpenInitiative} />}
  </section>;
}

function RetrospectiveResults({ report, openInitiative }: { report: BusinessRetrospective; openInitiative: (id: string) => void }) {
  const { locale } = useI18n();
  const c = businessCopy(locale);
  const cards = [
    { tone: "done", icon: CheckCircle2, label: c("期間内に完了した達成項目", "期间内完成的达成项"), value: report.completedMilestones },
    { tone: "weekly", icon: ClipboardCheck, label: c("期間内に完了した週間作業", "期间内完成的每周任务"), value: report.completedWeekly },
    { tone: "remaining", icon: Clock3, label: c("期末の未完了項目", "期末未完成的达成项"), value: report.remainingMilestones }
  ];
  const remaining = report.initiatives.filter(row => row.remaining.length > 0);
  const initiatives = new Map(report.initiatives.map(row => [row.id, row]));
  return <>
    <p className="retrospective-period">{c("集計期間", "汇总期间")} {report.from} ～ {report.to} · {report.assigneeId ? memberNames([report.assigneeId], report.members, locale) : c("全員", "全体成员")}</p>
    <div className="retrospective-metrics">{cards.map(({ tone, icon: Icon, label, value }) =>
      <article className={`retrospective-metric ${tone}`} key={tone}>
        <Icon size={26} aria-hidden="true" /><div><h2>{label}</h2><strong>{value}{c("件", "项")}</strong></div>
      </article>)}</div>
    <p className="retrospective-note">{c("達成項目と週間作業は別々に集計し、期末時点で有効な完了を表示します。", "分别汇总达成项和每周任务，显示截至期末仍有效的完成记录。")}</p>
    {(report.weeklyHistoryIncomplete || report.initiatives.some(row => row.before.state === "unknown" || row.after.state === "unknown")) &&
      <p className="retrospective-note">{c("履歴が不足している時点は、記録で確認できる範囲を集計しています。", "部分时点缺少历史记录，汇总仅使用可核实的数据。")}</p>}
    <section className="retrospective-panel">
      <h2>{c("取り組みごとの変化", "各项工作的变化")}</h2>
      {report.initiatives.length > 0 ? <div className="retrospective-table-wrap" role="region" aria-label={c("取り組みごとの比較表", "各项工作对比表")} tabIndex={0}>
        <table>
          <thead><tr><th scope="col">{c("取り組み・担当", "工作与负责人")}</th><th scope="col">{c("期間開始", "期初")}</th><th scope="col">{c("期間終了", "期末")}</th><th scope="col">{c("期間内の動き", "期间变化")}</th></tr></thead>
          <tbody>{report.initiatives.map(row => <tr key={row.id}>
            <th scope="row"><button type="button" className="retrospective-link" onClick={() => openInitiative(row.id)} lang={row.sourceLocale}>{row.name}</button><small>{memberNames(row.assigneeIds, report.members, locale)}</small></th>
            <td><Snapshot value={row.before} /></td>
            <td><Snapshot value={row.after} /></td>
            <td>{row.completed.length > 0
              ? <span className="retrospective-completed" lang={row.sourceLocale}>{row.completed.map(item => item.name).join("・")}</span>
              : row.hasActivity ? c("更新あり", "有更新") : c("期間内の更新記録なし", "期间无更新记录")}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p>{c("該当する取り組みはありません。", "没有符合条件的工作。")}</p>}
    </section>
    <div className="retrospective-details">
      <section className="retrospective-panel">
        <h2>{c("期間内の完了報告", "期间内的完成报告")}</h2>
        {report.reports.length ? <ul>{report.reports.map(note => {
          const initiative = initiatives.get(note.initiativeId);
          return <li key={note.id}>
            <button type="button" className="retrospective-link" onClick={() => openInitiative(note.initiativeId)} lang={initiative?.sourceLocale}>{initiative?.name ?? c("取り組みを開く", "打开工作")}</button>
            <small>{note.authorName} · {dateLabel(note.createdAt, locale)}</small>
            <p className="retrospective-report-body" lang={note.sourceLocale}>{note.body}</p>
          </li>;
        })}</ul> : <p>{c("期間内の完了報告はありません。", "期间内没有完成报告。")}</p>}
      </section>
      <section className="retrospective-panel">
        <h2>{c("期末に残っていること", "期末尚未完成的事项")}</h2>
        {remaining.length ? <ul>{remaining.map(row => <li key={row.id}>
          <button type="button" className="retrospective-link" onClick={() => openInitiative(row.id)} lang={row.sourceLocale}>{row.name}</button>
          <small>{row.remaining.length}{c("件", "项")}</small>
          <p lang={row.sourceLocale}>{row.remaining.map(item => item.name).join("・")}</p>
        </li>)}</ul> : <p>{c("確認できる期末の未完了項目はありません。", "没有可确认的期末未完成项。")}</p>}
      </section>
    </div>
  </>;
}

function Snapshot({ value }: { value: RetrospectiveSnapshot }) {
  const { locale } = useI18n();
  const c = businessCopy(locale);
  if (value.state === "active") return <><strong>{value.completed}/{value.total}{c("件完了", "项已完成")}</strong><small>{statusLabel(value.status, locale)}</small></>;
  if (value.state === "not-created") return <span>{c("登録前", "尚未登记")}</span>;
  if (value.state === "archived") return <span>{c("アーカイブ済み", "已归档")}</span>;
  return <span>{c("履歴不足", "历史不足")}</span>;
}
