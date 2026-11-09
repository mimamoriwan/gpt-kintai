import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { BusinessMilestonePreview } from "./BusinessMilestonePreview";
import { businessCopy, dateLabel, memberNames, safeBusinessLink, statuses, statusLabel, statusSymbols } from "./presentation";
import { buildTimeline, milestoneCount, milestoneSections, monthIndex, todayMarker, validPlannedPeriod } from "./timeline";
import type { BusinessInitiative, BusinessTheme, BusinessWorkspace } from "./types";
import { TranslatedText, useBusinessTranslation } from "./useBusinessTranslation";

interface Props {
  view: "timeline" | "list";
  themes: BusinessTheme[];
  rows: BusinessInitiative[];
  workspace: BusinessWorkspace;
  selectedId: string;
  select: (id: string) => void;
}

type Preview = { rowId: string; anchor: HTMLButtonElement; pinned: boolean };

export function BusinessOverview({ view, themes, rows, workspace, selectedId, select }: Props) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  const timeline = useMemo(() => buildTimeline(rows), [rows]);
  const today = todayMarker();
  const groups = themes.filter(theme => rows.some(row => row.themeId === theme.id));
  const [preview, setPreview] = useState<Preview>();
  const previewId = useId();
  const dismissTimer = useRef<number | undefined>(undefined);
  const cancelDismiss = useCallback(() => window.clearTimeout(dismissTimer.current), []);
  const closePreview = useCallback(() => { cancelDismiss(); setPreview(undefined); }, [cancelDismiss]);
  useEffect(() => cancelDismiss, [cancelDismiss]);
  useEffect(() => { closePreview(); }, [view, closePreview]);
  function showPreview(next: Preview) {
    cancelDismiss();
    setPreview(previous => {
      if (next.pinned) return previous?.rowId === next.rowId && previous.pinned ? undefined : next;
      return previous?.pinned ? previous : next;
    });
  }
  function scheduleDismiss(rowId: string) {
    cancelDismiss();
    dismissTimer.current = window.setTimeout(() => setPreview(previous => previous?.rowId === rowId && !previous.pinned ? undefined : previous), 220);
  }
  if (view === "list") return <div className="business-list">{groups.map(theme => <section key={theme.id}>
    <h2><TranslatedText kind="theme" resource={theme} field="name" text={theme.name} /></h2>
    <ThemePurpose theme={theme} />
    {rows.filter(row => row.themeId === theme.id).map(row => <InitiativeListRow key={row.id} row={row} workspace={workspace} selected={selectedId === row.id} select={() => select(row.id)} />)}
  </section>)}</div>;

  const months = timeline.months;
  const monthCount = months.length;
  const currentIndex = months.indexOf(timeline.todayMonth);
  const todayPosition = currentIndex >= 0 ? (currentIndex + today.fraction) / monthCount * 100 : undefined;
  const tableStyle = { "--business-month-count": monthCount, "--business-overview-min-width": `${Math.max(650, 290 + monthCount * 50)}px`, "--business-mobile-lane-min-width": `${monthCount * 32}px` } as CSSProperties;
  return <div className="business-overview-chart">
    <div className="business-overview-heading"><span>{c("全体の予定", "整体计划")}</span><span>{months[0]} → {months[monthCount - 1]}<span className="business-overview-total">{c(`${rows.length}件`, `${rows.length}项`)}</span></span></div>
    <div className="business-overview-scroll" tabIndex={0} role="region" aria-label={c("工程表（縦・横にスクロールできます）", "计划图（可上下左右滚动）")}>
      <table className="business-overview-table" style={tableStyle}>
        <caption className="business-overview-accessible-caption">{c("横棒は予定期間、色と文字は状態、下端の緑色と数は完了した達成項目を表します。", "横条表示计划期间，颜色与文字表示状态，下沿的绿色和数字表示已完成的达成项。")}</caption>
        <colgroup><col className="business-overview-name-column" /><col className="business-overview-progress-column" />{months.map(month => <col key={month} />)}</colgroup>
        <thead><tr><th scope="col">{c("取り組み・担当", "工作与负责人")}</th><th scope="col">{c("達成項目の完了", "已完成达成项")}</th>{months.map((month, index) => <th scope="col" key={month} aria-label={month} className={month === timeline.todayMonth ? "business-overview-current-month" : undefined}>
          <span className="business-overview-year">{index === 0 || month.slice(5) === "01" ? month.slice(0, 4) : "\u00a0"}</span>
          <span>{Number(month.slice(5))}{c("月", "月")}</span>
          {month === timeline.todayMonth && <small>{c(`今日 ${today.day}日`, `今天 ${today.day}日`)}</small>}
        </th>)}</tr></thead>
        {groups.map(theme => <tbody key={theme.id}>
          <tr className="business-overview-theme"><th scope="rowgroup" colSpan={monthCount + 2}><div><span><TranslatedText kind="theme" resource={theme} field="name" text={theme.name} /></span><ThemePurpose theme={theme} /></div></th></tr>
          {rows.filter(row => row.themeId === theme.id).map(row => <TimelineRow key={row.id} row={row} workspace={workspace} selected={selectedId === row.id} select={() => { closePreview(); select(row.id); }} months={months} todayPosition={todayPosition}
            expanded={preview?.rowId === row.id} previewId={previewId} showPreview={showPreview} scheduleDismiss={scheduleDismiss} />)}
        </tbody>)}
      </table>
    </div>
    <div className="business-overview-legend" aria-label={c("工程表の見方", "计划图说明")}><div>{statuses.map(status => <span key={status}><i aria-hidden="true" className={`business-overview-swatch business-overview-bar-${status}`} />{statusLabel(status, locale)}</span>)}</div><span>{c("横棒＝予定期間　縦線＝今日　下端の緑色＝完了した達成項目", "横条＝计划期间　竖线＝今天　下沿绿色＝已完成达成项")}</span></div>
    <p className="business-overview-note">{c("下端の緑色と「3/7」は達成項目7件のうち3件が完了したことを表します。「次の未完了」は工程グループと項目の表示順で決まります。", "下沿的绿色与“3/7”表示7项达成项中已完成3项。“下一项未完成”按流程分组和事项的显示顺序确定。")}</p>
    <p className="business-overview-note">{c("横棒にカーソルを合わせるか、タップして達成項目を確認できます。", "将光标移到横条上或点击横条，即可查看达成项。")}</p>
    {preview && rows.filter(row => row.id === preview.rowId).map(row => <BusinessMilestonePreview key={row.id} row={row} id={previewId} anchor={preview.anchor} pinned={preview.pinned}
      close={closePreview} cancelDismiss={cancelDismiss} scheduleDismiss={() => scheduleDismiss(row.id)} openDetails={() => select(row.id)} />)}
  </div>;
}

function TimelineRow({ row, workspace, selected, select, months, todayPosition, expanded, previewId, showPreview, scheduleDismiss }: {
  row: BusinessInitiative; workspace: BusinessWorkspace; selected: boolean; select: () => void; months: string[]; todayPosition?: number;
  expanded: boolean; previewId: string; showPreview: (preview: Preview) => void; scheduleDismiss: (id: string) => void;
}) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  const hasPeriod = Boolean(row.plannedStartMonth && row.plannedEndMonth && validPlannedPeriod(row.plannedStartMonth, row.plannedEndMonth));
  const start = hasPeriod ? monthIndex(row.plannedStartMonth) - monthIndex(months[0]) : 0;
  const end = hasPeriod ? monthIndex(row.plannedEndMonth) - monthIndex(months[0]) : 0;
  const period = hasPeriod ? `${row.plannedStartMonth} → ${row.plannedEndMonth} · ${statusLabel(row.status, locale)}` : c("期間未設定", "期间未设置");
  const milestoneProgress = milestoneCount(row);
  const translated = useBusinessTranslation("initiative", row).fields?.name || row.name;
  return <tr className={`business-overview-row${selected ? " business-selected" : ""}`} onClick={event => { if (!(event.target instanceof Element) || !event.target.closest("button")) select(); }}>
    <th scope="row"><InitiativeName row={row} selected={selected} select={select} /><small>{memberNames(row.assigneeIds, workspace.members, locale)}</small><NextMilestone row={row} /></th>
    <td className="business-overview-progress"><MilestoneSummary row={row} /></td>
    <td colSpan={months.length} className="business-overview-schedule" tabIndex={months.length > 7 ? 0 : undefined} aria-label={period}>
      <div className="business-overview-mobile-months" aria-hidden="true">{months.map((month, index) => <span key={month}><small>{index === 0 || month.slice(5) === "01" ? month.slice(0, 4) : "\u00a0"}</small>{Number(month.slice(5))}月</span>)}</div>
      <div className="business-overview-lane">
        {todayPosition !== undefined && <span className="business-overview-today" style={{ left: `${todayPosition}%` }} aria-hidden="true" />}
        <button type="button" className={`business-overview-bar business-overview-bar-${row.status}${hasPeriod ? "" : " business-overview-no-period"}`}
          style={{ gridColumn: hasPeriod ? `${start + 1} / ${end + 2}` : "1 / -1" }}
          aria-label={c(`${translated}の達成項目を確認`, `查看${translated}的达成项`)}
          aria-expanded={expanded} aria-controls={expanded ? previewId : undefined}
          onPointerEnter={event => { if (event.pointerType === "mouse") showPreview({ rowId: row.id, anchor: event.currentTarget, pinned: false }); }}
          onPointerLeave={() => scheduleDismiss(row.id)}
          onClick={event => showPreview({ rowId: row.id, anchor: event.currentTarget, pinned: true })}>
          <span aria-hidden="true">{statusSymbols[row.status]}</span>
          <span>{hasPeriod ? statusLabel(row.status, locale) : c("期間未設定", "期间未设置")}</span>
          {hasPeriod && milestoneProgress.total > 0 && <span className="business-overview-milestone-track" aria-hidden="true"><span className="business-overview-milestone-fill" style={{ width: `${milestoneProgress.completed / milestoneProgress.total * 100}%` }} /></span>}
          {!hasPeriod && <span className={`business-status business-status-${row.status}`}>{statusLabel(row.status, locale)}</span>}
        </button>
      </div>
    </td>
  </tr>;
}

function MilestoneSummary({ row }: { row: BusinessInitiative }) {
  const { locale } = useI18n(); const count = milestoneCount(row);
  if (!count.total) return <span className="business-muted">{locale === "ja" ? "達成項目未設定" : "达成项未设置"}</span>;
  return <span className="business-milestone-count" role="group" aria-label={locale === "ja" ? `${count.total}件中${count.completed}件の達成項目が完了` : `${count.total}个达成项已完成${count.completed}个`}><strong aria-hidden="true">{count.completed}/{count.total}</strong></span>;
}

function NextMilestone({ row }: { row: BusinessInitiative }) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  const { fields } = useBusinessTranslation("initiative", row);
  const section = milestoneSections(row).find(({ items }) => items.some(item => !item.completed));
  const next = section?.items.find(item => !item.completed);
  if (!next) return null;
  const translated = fields?.[`milestone:${next.id}`];
  const group = section?.group;
  const translatedGroup = group && fields?.[`milestoneGroup:${group.id}`];
  return <p className="business-next-milestone">
    {c("次の未完了", "下一项未完成")}{" · "}
    {group && <><span lang={translatedGroup ? locale : row.sourceLocale}>{translatedGroup || group.name}</span>{" / "}</>}
    <span lang={translated ? locale : row.sourceLocale}>{translated || next.name}</span>
  </p>;
}

function InitiativeName({ row, selected, select }: { row: BusinessInitiative; selected: boolean; select: () => void }) {
  const tr = useBusinessTranslation("initiative", row);
  return <button className="business-row-name" type="button" aria-pressed={selected} onClick={select}>{tr.fields?.name || row.name}</button>;
}

function InitiativeListRow({ row, workspace, selected, select }: { row: BusinessInitiative; workspace: BusinessWorkspace; selected: boolean; select: () => void }) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  return <article className={`business-list-row${selected ? " business-selected" : ""}`}>
    <div><InitiativeName row={row} selected={selected} select={select} /><p className="business-muted">{memberNames(row.assigneeIds, workspace.members, locale)}</p></div>
    <div>
      <div className="business-row-status"><span className={`business-status business-status-${row.status}`}>{statusSymbols[row.status]} {statusLabel(row.status, locale)}</span><MilestoneSummary row={row} /></div>
      <NextMilestone row={row} />
    </div>
    <div className="business-row-update">
      {row.latestUpdate ? <><small>{row.latestUpdate.authorName} · {dateLabel(row.latestUpdate.createdAt, locale)}</small><p><TranslatedText kind="update" resource={row.latestUpdate} field="body" text={row.latestUpdate.body} compact /></p></> : <p className="business-muted">{c("近況はまだありません", "暂无动态")}</p>}
      <small>{c("最終更新", "最后更新")}: {dateLabel(row.updatedAt, locale)}</small>
    </div>
  </article>;
}

function ThemePurpose({ theme }: { theme: BusinessTheme }) {
  const { locale } = useI18n();
  return <details className="business-theme-purpose"><summary>{locale === "ja" ? "テーマの目的・参考資料" : "主题目的与参考资料"}</summary><p><TranslatedText kind="theme" resource={theme} field="description" text={theme.description || (locale === "ja" ? "説明は未登録です。" : "尚未填写说明。")} /></p>{theme.referenceLinks.map(link => { const href = safeBusinessLink(link); return href && <a key={link} href={href} target="_blank" rel="noopener noreferrer">{link}</a>; })}</details>;
}
