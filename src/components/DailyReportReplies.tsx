import { useEffect, useId, useRef, useState } from "react";
import { BellRing, X } from "lucide-react";
import { useI18n } from "../i18n";
import { formatDate, formatTime, todayJst } from "../lib/format";
import { reportReplies, unreadReportReplies } from "../lib/reportReplies";
import { markDailyReportCommentsRead } from "../services/api";
import type { DailyReport } from "../types";
import "./DailyReportReplies.css";

export function DailyReportReplies({ reports, uid, selectedReportId, onOpen, onClose, notify }: {
  reports: DailyReport[];
  uid: string;
  selectedReportId: string | null;
  onOpen: (reportId: string) => void;
  onClose: () => void;
  notify: (type: "success" | "error", message: string) => void;
}) {
  const { locale } = useI18n();
  const pending = reports.map((report) => ({ report, count: unreadReportReplies(report, uid).length }))
    .filter((row) => row.count > 0).sort((a, b) => b.report.reportDate.localeCompare(a.report.reportDate));
  const count = pending.reduce((sum, row) => sum + row.count, 0);
  const selected = reports.find((report) => report.id === selectedReportId && report.userId === uid && report.status !== "provisional");
  return <>
    {count > 0 && <section className="daily-reply-notice" aria-label={locale === "ja" ? "日報への返信通知" : "日报回复通知"}>
      <div role="status"><BellRing size={20} /><strong>{locale === "ja" ? `日報への返信あり（未確認 ${count}件）` : `日报有回复（未确认 ${count}条）`}</strong></div>
      <details><summary>{locale === "ja" ? "返信のある日報を選ぶ" : "选择有回复的日报"}</summary><ul>
        {pending.map(({ report, count: replyCount }) => <li key={report.id}><button type="button" className="button ghost" onClick={() => onOpen(report.id)}>
          {formatDate(report.reportDate, locale === "ja" ? "ja-JP" : "zh-CN")} · {locale === "ja" ? `返信 ${replyCount}件を確認` : `查看 ${replyCount}条回复`}
        </button></li>)}
      </ul></details>
    </section>}
    {selected && <ReplyDialog key={`${uid}:${selected.id}`} report={selected} uid={uid} onClose={onClose} notify={notify} />}
  </>;
}

function ReplyDialog({ report, uid, onClose, notify }: {
  report: DailyReport; uid: string; onClose: () => void;
  notify: (type: "success" | "error", message: string) => void;
}) {
  const { locale } = useI18n();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const replies = reportReplies(report, uid);
  const unreadIds = unreadReportReplies(report, uid).map((comment) => comment.id);
  useEffect(() => {
    active.current = true;
    const previousFocus = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { active.current = false; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  async function confirm() {
    if (busy || unreadIds.length === 0) return;
    setBusy(true);
    setErrorMessage("");
    try {
      await markDailyReportCommentsRead(report.id, unreadIds);
      if (!active.current) return;
      notify("success", locale === "ja" ? "日報への返信を確認済みにしました。" : "日报回复已标记为已确认。");
      onClose();
    } catch (error) {
      if (!active.current) return;
      setErrorMessage(locale === "ja" ? "確認状態を保存できませんでした。接続を確認して、もう一度お試しください。" : "无法保存确认状态。请检查连接后重试。");
      notify("error", error instanceof Error ? error.message : String(error));
    } finally { if (active.current) setBusy(false); }
  }

  return <div className="modal-backdrop daily-reply-backdrop"><div className="modal daily-reply-dialog" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={(event) => {
    if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); }
    if (event.key === "Tab") {
      const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header><h2 id={titleId}>{locale === "ja" ? "日報への返信" : "日报回复"}</h2><button type="button" className="icon-button" aria-label={locale === "ja" ? "閉じる" : "关闭"} disabled={busy} onClick={onClose}><X size={20} /></button></header>
    <div className="daily-reply-body"><strong>{formatDate(report.reportDate, locale === "ja" ? "ja-JP" : "zh-CN")}</strong>
      <section><h3>{locale === "ja" ? "提出した日報" : "已提交的日报"}</h3>
        {(report.area || report.destinations) && <p>{[report.area, report.destinations].filter(Boolean).join(" · ")}</p>}
        <p>{report.activities}</p>
        {report.findings && <><h3>{locale === "ja" ? "気づき・課題" : "发现与问题"}</h3><p>{report.findings}</p></>}
        {report.nextPlan && <><h3>{locale === "ja" ? "次の予定" : "下一步计划"}</h3><p>{report.nextPlan}</p></>}
      </section>
      <section className="employee-report-comments"><h3>{locale === "ja" ? "管理者・社長からのコメント" : "管理员、社长的评论"}</h3>
        {replies.map((comment) => <article key={comment.id}><header><strong>{comment.authorName}</strong><span className="tag soft">{comment.authorRole === "president_viewer" ? (locale === "ja" ? "社長" : "社长") : (locale === "ja" ? "管理" : "管理员")}</span>
          <time>{todayJst(comment.createdAt.toDate())} {formatTime(comment.createdAt)}</time>{unreadIds.includes(comment.id) && <span className="status-chip amber">{locale === "ja" ? "未確認" : "未确认"}</span>}</header><p>{comment.body}</p></article>)}
      </section>
      {errorMessage && <p role="alert">{errorMessage}</p>}
    </div>
    <div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={onClose}>{locale === "ja" ? "閉じる" : "关闭"}</button>
      {unreadIds.length > 0 && <button type="button" className="button primary" disabled={busy} onClick={() => void confirm()}>{busy ? (locale === "ja" ? "保存中…" : "保存中…") : (locale === "ja" ? "確認しました" : "已确认")}</button>}
    </div>
  </div></div>;
}
