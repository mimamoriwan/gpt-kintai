import { useMemo, useState, type FormEvent } from "react";
import { CalendarDays, CheckCircle2, Clock3, ExternalLink, FileText, Languages, MapPin, MessageSquare, Pencil, RotateCcw } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { elapsedMinutes, formatDate, formatElapsed, formatTime, todayJst } from "../lib/format";
import { correctAttendance, retryTranslation } from "../services/api";
import type { AttendanceRecord, Category, DailyReport } from "../types";

export function RecordsPage({ attendance, reports, categories, onEditReport, notify }: {
  attendance: AttendanceRecord[];
  reports: DailyReport[];
  categories: Category[];
  onEditReport: (report: DailyReport) => void;
  notify: (type: "success" | "error", message: string) => void;
}) {
  const { profile } = useAuth();
  const { locale, t } = useI18n();
  const [tab, setTab] = useState<"reports" | "attendance">("reports");
  const [month, setMonth] = useState(todayJst().slice(0, 7));
  const [editingAttendance, setEditingAttendance] = useState<AttendanceRecord | null>(null);
  const ownAttendance = useMemo(() => attendance.filter((item) => item.userId === profile?.uid && item.workDate.startsWith(month)), [attendance, month, profile?.uid]);
  const ownReports = useMemo(() => reports.filter((item) => item.userId === profile?.uid && item.reportDate.startsWith(month)), [month, profile?.uid, reports]);
  const categoryMap = useMemo(() => new Map(categories.map((item) => [item.id, locale === "ja" ? item.labelJa : item.labelZh])), [categories, locale]);

  async function retry(reportId: string) {
    try { await retryTranslation(reportId); notify("success", locale === "ja" ? "日本語化を再実行しました。" : "已重新生成日语。" ); }
    catch (error) { notify("error", error instanceof Error ? error.message : t("error")); }
  }

  return (
    <div className="page records-page">
      <div className="page-heading split"><div><span className="eyebrow">WORK HISTORY</span><h1>{t("records")}</h1><p>{locale === "ja" ? "勤怠、提出済み日報、本人確認待ちの日報を確認できます。" : "查看考勤、已提交日报及待本人确认的日报。"}</p></div><label className="month-picker"><CalendarDays size={18} /><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label></div>
      <div className="tab-bar"><button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}><FileText size={18} />{t("dailyReport")} <span>{ownReports.length}</span></button><button className={tab === "attendance" ? "active" : ""} onClick={() => setTab("attendance")}><Clock3 size={18} />{locale === "ja" ? "勤怠" : "考勤"} <span>{ownAttendance.length}</span></button></div>
      {tab === "reports" ? <div className="record-list">{ownReports.length ? ownReports.map((report) => <article className={`card report-record${report.status === "provisional" ? " is-provisional" : ""}`} key={report.id}><header><div><span className="record-date">{formatDate(report.reportDate, locale === "ja" ? "ja-JP" : "zh-CN")}</span><span className="tag blue">{categoryMap.get(report.category) || report.category}</span>{report.status === "provisional" && <span className="status-chip amber">{locale === "ja" ? "自動作成済み・本人未確認" : "已自动生成・待本人确认"}</span>}</div><button className="icon-button" onClick={() => onEditReport(report)} aria-label={report.status === "provisional" ? (locale === "ja" ? "内容を確認" : "确认内容") : t("correction")}><Pencil size={18} /></button></header>{(report.area || report.destinations) && <div className="report-meta">{report.area && <span><MapPin size={16} />{report.area}</span>}{report.destinations && <span>{report.destinations}</span>}</div>}<section><small>{t("activities")}</small><p>{report.activities}</p></section>{report.findings && <section><small>{t("findings")}</small><p>{report.findings}</p></section>}{report.sourceLanguage === "zh-CN" && report.status !== "provisional" && <section className="translation-box"><div className="translation-heading"><span><Languages size={17} />{t("translated")}</span>{report.translationStatus === "completed" ? <span className="status-chip green"><CheckCircle2 size={14} />{t("translated")}</span> : report.translationStatus === "failed" ? <button className="small-action" onClick={() => void retry(report.id)}><RotateCcw size={15} />{t("retry")}</button> : <span className="status-chip amber">{t("translationPending")}</span>}</div>{report.translationStatus === "completed" && <p>{report.translatedFields?.activities}</p>}{report.translationStatus === "failed" && <p className="muted">{t("translationFailed")}</p>}</section>}{report.attachments?.length > 0 && <div className="record-attachments">{report.attachments.map((item) => <a key={item.id} href={item.linkUrl || item.downloadUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />{item.name}</a>)}</div>}{Boolean(report.comments?.length) && <section className="employee-report-comments"><div className="employee-report-comments-heading"><span><MessageSquare size={16} />{locale === "ja" ? "日報へのコメント" : "日报评论"}</span><span className="count-badge">{report.comments?.length}</span></div><div>{report.comments?.map((item) => <article key={item.id}><header><strong>{item.authorName}</strong><span className="tag soft">{item.authorRole === "president_viewer" ? (locale === "ja" ? "社長" : "社长") : (locale === "ja" ? "管理" : "管理员")}</span><time>{todayJst(item.createdAt.toDate())} {formatTime(item.createdAt)}</time></header><p>{item.body}</p></article>)}</div></section>}<footer><span>{report.status === "provisional" ? (locale === "ja" ? "仮提出" : "临时提交") : `rev.${report.revision}`}</span></footer></article>) : <Empty text={t("noData")} />}</div> : <div className="record-list attendance-list">{ownAttendance.length ? ownAttendance.map((item) => <article className="card attendance-record" key={item.id}><span className="record-mode">{t(item.workMode === "home" ? "homeWork" : item.workMode)}</span><div><strong>{formatDate(item.workDate, locale === "ja" ? "ja-JP" : "zh-CN")}</strong><span>{formatTime(item.startedAt)} <i /> {formatTime(item.endedAt)}</span></div><div><small>{t("elapsed")}</small><strong>{formatElapsed(elapsedMinutes(item.startedAt, item.endedAt), locale)}</strong></div>{item.holidayWork && <span className="tag amber">{locale === "ja" ? "休日勤務" : "休息日工作"}</span>}{item.corrected && <span className="tag amber">{locale === "ja" ? "修正あり" : "已修改"}</span>}<button className="icon-button" onClick={() => setEditingAttendance(item)} aria-label={t("correction")}><Pencil size={17} /></button></article>) : <Empty text={t("noData")} />}</div>}
      {editingAttendance && <AttendanceCorrectionModal record={editingAttendance} onClose={() => setEditingAttendance(null)} notify={notify} />}
    </div>
  );
}

function Empty({ text }: { text: string }) { return <div className="empty-state"><FileText size={38} /><p>{text}</p></div>; }

function AttendanceCorrectionModal({ record, onClose, notify }: { record: AttendanceRecord; onClose: () => void; notify: (type: "success" | "error", message: string) => void }) {
  const { locale, t } = useI18n();
  const isCompleted = record.status === "completed" || Boolean(record.endedAt);
  const minDateTime = `${record.workDate}T00:00`;
  const maxDateTime = record.workDate === todayJst() ? toLocalInput(new Date()) : `${record.workDate}T23:59`;
  const [start, setStart] = useState(toLocalInput(record.startedAt.toDate()));
  const [end, setEnd] = useState(record.endedAt ? toLocalInput(record.endedAt.toDate()) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!start) {
      notify("error", locale === "ja" ? "始業時刻を入力してください。" : "请输入开始时间。");
      return;
    }
    if (isCompleted && !end) {
      notify("error", locale === "ja" ? "終業済みの記録では終業時刻も入力してください。" : "已结束的考勤记录必须填写结束时间。");
      return;
    }
    if (!start.startsWith(`${record.workDate}T`) || (end && !end.startsWith(`${record.workDate}T`))) {
      notify("error", locale === "ja" ? "始業・終業時刻は勤務日と同じ日付で入力してください。" : "开始和结束时间必须与考勤日期相同。");
      return;
    }
    const startDate = jstInputToDate(start);
    const endDate = end ? jstInputToDate(end) : undefined;
    if (!Number.isFinite(startDate.getTime()) || (endDate && !Number.isFinite(endDate.getTime()))) {
      notify("error", locale === "ja" ? "正しい日時を入力してください。" : "请输入正确的日期和时间。");
      return;
    }
    if (startDate.getTime() > Date.now() || (endDate && endDate.getTime() > Date.now())) {
      notify("error", locale === "ja" ? "未来の時刻は保存できません。" : "不能保存未来时间。");
      return;
    }
    if (endDate && endDate.getTime() <= startDate.getTime()) {
      notify("error", locale === "ja" ? "終業時刻は始業時刻より後にしてください。" : "结束时间必须晚于开始时间。");
      return;
    }
    setBusy(true);
    try { await correctAttendance({ id: record.id, startedAt: startDate.toISOString(), endedAt: isCompleted && endDate ? endDate.toISOString() : undefined, reason, correctionKind: "record_edit" }); notify("success", t("success")); onClose(); }
    catch (error) { notify("error", error instanceof Error ? error.message : t("error")); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit}><h2>{t("correction")}</h2><label><span>{t("startTime")}</span><input type="datetime-local" value={start} min={minDateTime} max={maxDateTime} onChange={(e) => setStart(e.target.value)} required /></label><label><span>{t("endTime")}</span><input type="datetime-local" value={end} min={minDateTime} max={maxDateTime} onChange={(e) => setEnd(e.target.value)} disabled={!isCompleted} required={isCompleted} /></label>{!isCompleted && <p className="history-note">{locale === "ja" ? "終業前は終業時刻を修正できません。先にホーム画面で終業してください。" : "下班前不能修改下班时间。请先在首页完成下班打卡。"}</p>}<label><span>{t("correctionReason")}</span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={locale === "ja" ? "通信不良のため後から入力" : "因网络问题稍后补录"} required minLength={3} /></label><p className="history-note">{locale === "ja" ? "修正前の時刻・修正者・理由は履歴として保存されます。" : "修改前的时间、修改人和原因将保存在历史记录中。"}</p><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>{t("cancel")}</button><button className="button primary" disabled={busy}>{busy ? "…" : t("save")}</button></div></form></div>;
}

function jstInputToDate(value: string): Date {
  return new Date(`${value}:00+09:00`);
}

function toLocalInput(date: Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
