import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Building2, CalendarOff, CheckCircle2, ChevronDown, Clock3, Home as HomeIcon, MapPin, Plane } from "lucide-react";
import { useAuth } from "../auth";
import { SharedCalendar } from "../components/SharedCalendar";
import { InstructionHomePanel } from "../components/PresidentInstructions";
import { useI18n } from "../i18n";
import { formatDate, formatTime, todayJst } from "../lib/format";
import { resolveCompanyDay } from "../lib/companyCalendar";
import { MONTHLY_AI_GENERATION_ALERT_THRESHOLD, aiApiGenerationCount, monthlyAiUsageEvents } from "../lib/aiUsage";
import { clockIn, clockOut, correctAttendance, watchAiUsageEvents } from "../services/api";
import type { AnnouncementRecipient, AttendanceRecord, AuditEvent, CompanyHolidayOverride, DailyReport, DailyReportAutomation, PresidentInstruction, WorkMode } from "../types";

export function HomePage({ attendance, reports, automations = [], holidayOverrides, instructions = [], users = [], onReport, onReportDate, onConfirmReport, notify }: { attendance: AttendanceRecord[]; reports: DailyReport[]; automations?: DailyReportAutomation[]; holidayOverrides: CompanyHolidayOverride[]; instructions?: PresidentInstruction[]; users?: AnnouncementRecipient[]; onReport: () => void; onReportDate?: (date: string) => void; onConfirmReport?: (report: DailyReport) => void; notify: (type: "success" | "error", message: string) => void }) {
  const { profile } = useAuth();
  const { locale, t } = useI18n();
  const [mode, setMode] = useState<WorkMode>("office");
  const [busy, setBusy] = useState(false);
  const [attendanceExpanded, setAttendanceExpanded] = useState(false);
  const [confirmingClockOut, setConfirmingClockOut] = useState(false);
  const [confirmingHolidayWork, setConfirmingHolidayWork] = useState(false);
  const [startingHolidayWork, setStartingHolidayWork] = useState(false);
  const [correctingMissedClockOut, setCorrectingMissedClockOut] = useState(false);
  const [missedEndTime, setMissedEndTime] = useState("");
  const [missedReason, setMissedReason] = useState("");
  const [manualClockInOpen, setManualClockInOpen] = useState(false);
  const [manualStartTime, setManualStartTime] = useState("");
  const [manualStartReason, setManualStartReason] = useState("");
  const [aiUsageEvents, setAiUsageEvents] = useState<AuditEvent[]>([]);
  const today = todayJst();
  const presidentHome = profile?.role === "president_viewer";
  const managerHome = profile?.role === "employee_manager";
  useEffect(() => {
    if (!managerHome) return;
    return watchAiUsageEvents(setAiUsageEvents);
  }, [managerHome]);
  const monthlyAiRuns = useMemo(() => aiApiGenerationCount(monthlyAiUsageEvents(aiUsageEvents, today.slice(0, 7))), [aiUsageEvents, today]);
  const showAiUsageAlert = managerHome && monthlyAiRuns >= MONTHLY_AI_GENERATION_ALERT_THRESHOLD;
  const active = attendance.find((item) => item.userId === profile?.uid && item.status === "active");
  const staleActive = active && active.workDate < today ? active : undefined;
  const todayRecord = attendance.find((item) => item.userId === profile?.uid && item.workDate === today);
  const ownReports = useMemo(() => reports.filter((item) => item.userId === profile?.uid), [profile?.uid, reports]);
  const todayReport = ownReports.find((item) => item.reportDate === today);
  const hasReport = Boolean(todayReport);
  const todaySubmitted = Boolean(todayReport && todayReport.status !== "provisional");
  const todayProvisional = todayReport?.status === "provisional" ? todayReport : undefined;
  const actionableProvisional = useMemo(() => ownReports
    .filter((item) => item.status === "provisional" && item.reportDate < today)
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate))[0], [ownReports, today]);
  const actionableAutomation = useMemo(() => automations
    .filter((item) => item.userId === profile?.uid
      && (item.status === "blocked_no_memo" || item.status === "failed")
      && !ownReports.some((report) => report.reportDate === item.workDate && report.status !== "provisional"))
    .sort((a, b) => a.workDate.localeCompare(b.workDate))[0], [automations, ownReports, profile?.uid]);
  const generatingToday = automations.some((item) => item.userId === profile?.uid && item.workDate === today && (item.status === "queued" || item.status === "generating"));
  const companyDay = useMemo(() => resolveCompanyDay(today, holidayOverrides.find((item) => item.date === today)), [holidayOverrides, today]);
  const hasTodayWork = Boolean(todayRecord || (active && active.workDate === today));
  const showReportReminder = !hasReport && (!companyDay.isHoliday || hasTodayWork);
  const modeOptions = useMemo(() => [
    { value: "office" as const, label: t("office"), icon: Building2 },
    { value: "business_trip" as const, label: t("business_trip"), icon: Plane },
    { value: "home" as const, label: t("homeWork"), icon: HomeIcon },
    { value: "other" as const, label: t("other"), icon: MapPin }
  ], [t]);

  async function startWork() {
    setBusy(true);
    try {
      await clockIn(mode);
      setStartingHolidayWork(false);
      notify("success", locale === "ja" ? "始業時刻を記録しました。" : "已记录开始时间。");
    } catch (error) { notify("error", attendanceErrorMessage(error, locale, t("error"))); }
    finally { setBusy(false); }
  }

  function openManualClockIn() {
    setManualStartTime(toJstDateTimeLocal(new Date()));
    setManualStartReason(locale === "ja" ? "始業打刻を忘れたため" : "因忘记记录开始时间");
    setManualClockInOpen(true);
  }

  async function startWorkManually() {
    if (!manualStartTime || manualStartReason.trim().length < 3) return;
    setBusy(true);
    try {
      await clockIn(mode, { startedAt: jstLocalToIso(manualStartTime), reason: manualStartReason.trim() });
      setManualClockInOpen(false);
      setStartingHolidayWork(false);
      notify("success", locale === "ja" ? "指定した始業時刻を記録しました。" : "已记录指定的开始时间。");
    } catch (error) { notify("error", attendanceErrorMessage(error, locale, t("error"))); }
    finally { setBusy(false); }
  }

  async function finishWork() {
    setBusy(true);
    try {
      await clockOut();
      setConfirmingClockOut(false);
      setAttendanceExpanded(false);
      notify("success", locale === "ja" ? "終業時刻を記録しました。" : "已记录结束时间。");
    } catch (error) { notify("error", attendanceErrorMessage(error, locale, t("error"))); }
    finally { setBusy(false); }
  }

  function openMissedClockOut() {
    if (!staleActive) return;
    setMissedEndTime(suggestedEndTime(staleActive));
    setMissedReason(locale === "ja" ? "前日の終業打刻を忘れたため" : "因忘记记录前一天的结束时间");
    setCorrectingMissedClockOut(true);
  }

  async function resolveMissedClockOut() {
    if (!staleActive || !missedEndTime || missedReason.trim().length < 3) return;
    setBusy(true);
    try {
      await correctAttendance({
        id: staleActive.id,
        startedAt: staleActive.startedAt.toDate().toISOString(),
        endedAt: jstLocalToIso(missedEndTime),
        reason: missedReason.trim(),
        correctionKind: "missed_clock_out"
      });
      setCorrectingMissedClockOut(false);
      notify("success", locale === "ja" ? "前日の終業時刻を記録しました。本日の始業ができます。" : "已记录前一天的结束时间，现在可以开始今天的工作。");
    } catch (error) {
      notify("error", attendanceErrorMessage(error, locale, t("error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page home-page">
      <div className="page-heading"><div><span className="eyebrow">{t("today")}</span><h1>{locale === "ja" ? `${profile?.displayName}さん、お疲れさまです` : `${profile?.displayName}，辛苦了`}</h1><p>{formatDate(today, locale === "ja" ? "ja-JP" : "zh-CN")}</p></div></div>
      <InstructionHomePanel instructions={instructions} users={users} notify={notify} />
      {!presidentHome && actionableAutomation && <section className="card automatic-report-alert error" role="alert">
        <span className="modal-icon warning"><AlertTriangle size={24} /></span>
        <span><strong>{actionableAutomation.status === "blocked_no_memo" ? (locale === "ja" ? "業務メモがないため日報を作成できませんでした" : "因没有工作记录，无法生成日报") : (locale === "ja" ? "日報の自動作成に失敗しました" : "日报自动生成失败")}</strong><small>{formatDate(actionableAutomation.workDate, locale === "ja" ? "ja-JP" : "zh-CN")} · {actionableAutomation.lastError || (locale === "ja" ? "業務メモを確認して、日報画面から作成してください。" : "请检查工作记录并在日报页面生成。")}</small></span>
        <button className="button warning" type="button" onClick={() => onReportDate ? onReportDate(actionableAutomation.workDate) : onReport()}>{locale === "ja" ? "メモを確認" : "检查记录"}</button>
      </section>}
      {!presidentHome && actionableProvisional && <section className="card automatic-report-alert provisional" role="status">
        <span className="notice-icon">日</span>
        <span><strong>{locale === "ja" ? "日報は自動作成済みです。内容を確認してください" : "日报已自动生成，请确认内容"}</strong><small>{formatDate(actionableProvisional.reportDate, locale === "ja" ? "ja-JP" : "zh-CN")} · {locale === "ja" ? "本人確認後に正式提出となります" : "本人确认后将正式提交"}</small></span>
        <button className="button primary" type="button" onClick={() => onConfirmReport ? onConfirmReport(actionableProvisional) : onReport()}>{locale === "ja" ? "確認して提出" : "确认并提交"}</button>
      </section>}
      {showAiUsageAlert && <section className="card home-ai-usage-alert" role="alert"><span className="modal-icon warning"><AlertTriangle size={24} /></span><span><strong>{locale === "ja" ? `今月のAI生成が${monthlyAiRuns}回になりました` : `本月AI生成已达到${monthlyAiRuns}次`}</strong><small>{locale === "ja" ? "月50回の確認基準に達しています。管理画面の「日報AIの利用状況」で、利用者・日時・トークン数を確認してください。" : "已达到每月50次的检查标准。请在管理页面的“日报AI使用情况”中查看用户、时间和Token数。"}</small></span></section>}
      <div className={`home-grid ${presidentHome ? "president-home-grid" : ""}`}>
        {!presidentHome && <section className={`card attendance-hero ${active || todayRecord?.endedAt ? "is-compact" : ""}`}>
          {staleActive ? <div className="missed-clockout-warning">
            <div className="missed-clockout-heading"><span className="modal-icon warning"><AlertTriangle size={24} /></span><span><strong>{locale === "ja" ? "前日の終業ボタンが押されていません" : "前一天尚未记录结束时间"}</strong><small>{locale === "ja" ? "実際の終業時刻を入力して、前日の勤務を確定してください。" : "请输入实际结束时间，完成前一天的考勤。"}</small></span></div>
            <div className="missed-clockout-meta"><span><small>{locale === "ja" ? "対象日" : "日期"}</small><strong>{formatDate(staleActive.workDate, locale === "ja" ? "ja-JP" : "zh-CN")}</strong></span><span><small>{t("startTime")}</small><strong>{formatTime(staleActive.startedAt)}</strong></span></div>
            <p>{locale === "ja" ? "前日の勤務を確定するまで、本日の始業ボタンは使用できません。" : "完成前一天的考勤前，无法开始今天的工作。"}</p>
            <button className="button warning" type="button" disabled={busy} onClick={openMissedClockOut}>{locale === "ja" ? "終業時刻を入力" : "输入结束时间"}</button>
          </div> : active ? <>
            <div className="active-attendance-bar">
              <button className="attendance-summary" type="button" aria-expanded={attendanceExpanded} onClick={() => setAttendanceExpanded((current) => !current)}>
                <span className="status-chip green"><i />{t("working")}</span>
                <span className="active-attendance-meta"><strong>{t(active.workMode === "home" ? "homeWork" : active.workMode)}{active.holidayWork && <em className="mini-holiday-label">{locale === "ja" ? "休日勤務" : "休息日"}</em>}</strong><small>{formatTime(active.startedAt)}〜</small></span>
                <ChevronDown className={attendanceExpanded ? "is-open" : ""} size={19} />
              </button>
              <button className="button compact-clock-out danger" type="button" disabled={busy} onClick={() => setConfirmingClockOut(true)}>{t("clockOut")}</button>
            </div>
            {attendanceExpanded && <div className="active-attendance-details"><span><small>{t("startTime")}</small><strong>{formatTime(active.startedAt)}</strong></span><span><small>{locale === "ja" ? "勤務区分" : "工作方式"}</small><strong>{t(active.workMode === "home" ? "homeWork" : active.workMode)}</strong></span></div>}
          </> : todayRecord?.endedAt ? <div className="completed-attendance-bar"><span className="status-chip green"><CheckCircle2 size={15} />{todayRecord.holidayWork ? (locale === "ja" ? "終了済み・休日勤務" : "已结束・休息日工作") : (locale === "ja" ? "終了済み" : "已结束")}</span><span><small>{t("startTime")}</small><strong>{formatTime(todayRecord.startedAt)}</strong></span><span><small>{t("endTime")}</small><strong>{formatTime(todayRecord.endedAt)}</strong></span></div> : <>
            {companyDay.isHoliday && !startingHolidayWork ? <div className="company-holiday-card">
              <span className="company-holiday-icon"><CalendarOff size={28} /></span>
              <div><span className="eyebrow">COMPANY HOLIDAY</span><h2>{locale === "ja" ? "本日は会社休日（予定）です" : "今天是公司休息日（计划）"}</h2><p>{companyDay.label}</p></div>
              <button className="button holiday-work-button" type="button" onClick={() => setConfirmingHolidayWork(true)}>{locale === "ja" ? "休日業務を開始" : "开始休息日工作"}</button>
              <small>{locale === "ja" ? "業務がなければ操作は不要です。勤務記録や未打刻警告は作成されません。" : "如无工作则无需操作，也不会生成考勤或漏打卡提醒。"}</small>
            </div> : <>
              <div className="section-title"><span><Clock3 size={20} />{startingHolidayWork ? (locale === "ja" ? "休日勤務の勤務形態" : "休息日工作方式") : t("workStatus")}</span>{startingHolidayWork && <span className="tag amber">{locale === "ja" ? "休日勤務" : "休息日工作"}</span>}</div>
              <div className="mode-picker">{modeOptions.map((item) => <button type="button" key={item.value} className={mode === item.value ? "selected" : ""} onClick={() => setMode(item.value)}><item.icon size={22} /><span>{item.label}</span></button>)}</div>
              <button className="button punch success" type="button" disabled={busy} onClick={() => void startWork()}>{busy ? "…" : startingHolidayWork ? (locale === "ja" ? "休日勤務を始業" : "开始休息日工作") : t("clockIn")}</button>
              <button className="manual-clockin-trigger" type="button" disabled={busy} onClick={openManualClockIn}><Clock3 size={17} />{locale === "ja" ? "始業時刻を修正して開始" : "修改开始时间后开始"}</button>
              {startingHolidayWork && <button className="holiday-work-cancel" type="button" onClick={() => setStartingHolidayWork(false)}>{locale === "ja" ? "会社休日の表示へ戻る" : "返回公司休息日"}</button>}
              <p className="legal-note">{t("systemNotice")}</p>
            </>}
          </>}
        </section>}
        {!presidentHome && <aside className="home-aside">
          {showReportReminder && !generatingToday && <button className="notice-card report" onClick={onReport}><span className="notice-icon">日</span><span><strong>{t("reportReminder")}</strong><small>{t("writeReport")}</small></span><ArrowRight size={20} /></button>}
          {generatingToday && <div className="notice-card report"><span className="notice-icon">AI</span><span><strong>{locale === "ja" ? "日報を自動作成中です" : "正在自动生成日报"}</strong><small>{locale === "ja" ? "完了後に内容確認をお願いします" : "完成后请确认内容"}</small></span></div>}
          {companyDay.isHoliday && !hasTodayWork && !hasReport && <div className="notice-card holiday"><CalendarOff size={22} /><span><strong>{locale === "ja" ? "会社休日（予定）" : "公司休息日（计划）"}</strong><small>{locale === "ja" ? "未打刻・日報未提出の警告対象外です" : "不显示漏打卡或未交日报提醒"}</small></span></div>}
          {todayProvisional && <button className="notice-card report" onClick={() => onConfirmReport ? onConfirmReport(todayProvisional) : onReport()}><span className="notice-icon">仮</span><span><strong>{locale === "ja" ? "自動作成済み・本人未確認" : "已自动生成・待本人确认"}</strong><small>{locale === "ja" ? "内容を確認して正式提出してください" : "请确认内容后正式提交"}</small></span><ArrowRight size={20} /></button>}
          {todaySubmitted && <div className="notice-card success"><CheckCircle2 size={22} /><span><strong>{t("submitted")}</strong><small>{locale === "ja" ? "本日の日報は記録済みです" : "今天的日报已记录"}</small></span></div>}
        </aside>}
        <SharedCalendar attendance={attendance} reports={reports} holidayOverrides={holidayOverrides} notify={notify} />
      </div>
      {confirmingClockOut && active && !staleActive && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmingClockOut(false); }}>
        <section className="modal clock-out-modal" role="dialog" aria-modal="true" aria-labelledby="clock-out-title">
          <div className="modal-icon danger"><Clock3 size={25} /></div>
          <div><h2 id="clock-out-title">{locale === "ja" ? "終業を確定しますか？" : "确定结束工作吗？"}</h2><p>{locale === "ja" ? "終業時刻を記録します。終業後、業務メモと保存した添付資料をAIへ送信し、日報を自動で仮作成します。" : "将记录结束时间。结束工作后，工作记录及已保存附件会发送给AI并自动生成临时日报。"}</p></div>
          <div className="clock-out-times"><span><small>{t("startTime")}</small><strong>{formatTime(active.startedAt)}</strong></span><ArrowRight size={18} /><span><small>{t("endTime")}</small><strong>{locale === "ja" ? "現在" : "现在"}</strong></span></div>
          <div className="modal-actions"><button className="button ghost" type="button" disabled={busy} onClick={() => setConfirmingClockOut(false)}>{t("cancel")}</button><button className="button danger" type="button" disabled={busy} onClick={() => void finishWork()}>{busy ? "…" : locale === "ja" ? "終業を確定" : "确认结束"}</button></div>
        </section>
      </div>}
      {confirmingHolidayWork && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmingHolidayWork(false); }}>
        <section className="modal holiday-work-modal" role="dialog" aria-modal="true" aria-labelledby="holiday-work-title">
          <div className="modal-icon warning"><CalendarOff size={25} /></div>
          <div><h2 id="holiday-work-title">{locale === "ja" ? "休日業務を開始しますか？" : "要开始休息日工作吗？"}</h2><p>{locale === "ja" ? "会社休日の予定は残したまま、実際の勤務を「休日勤務」として記録します。終業打刻と日報提出も通常どおり必要です。" : "公司休息日计划会保留，实际工作将记录为休息日工作。仍需正常记录结束时间并提交日报。"}</p></div>
          <div className="holiday-work-note"><strong>{companyDay.label}</strong><small>{locale === "ja" ? "休日割増・残業・給与はこのシステムでは計算しません。" : "本系统不计算休息日津贴、加班或工资。"}</small></div>
          <div className="modal-actions"><button className="button ghost" type="button" onClick={() => setConfirmingHolidayWork(false)}>{t("cancel")}</button><button className="button warning" type="button" onClick={() => { setConfirmingHolidayWork(false); setStartingHolidayWork(true); }}>{locale === "ja" ? "勤務形態を選ぶ" : "选择工作方式"}</button></div>
        </section>
      </div>}
      {correctingMissedClockOut && staleActive && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCorrectingMissedClockOut(false); }}>
        <form className="modal missed-clockout-modal" role="dialog" aria-modal="true" aria-labelledby="missed-clockout-title" onSubmit={(event) => { event.preventDefault(); void resolveMissedClockOut(); }}>
          <div className="missed-clockout-modal-title"><span className="modal-icon warning"><AlertTriangle size={24} /></span><div><h2 id="missed-clockout-title">{locale === "ja" ? "前日の終業時刻を入力" : "输入前一天的结束时间"}</h2><p>{locale === "ja" ? "開始から8時間後を候補として表示しています。実際に仕事を終えた時刻へ直してください。" : "暂以开始8小时后为候选时间，请修改为实际结束时间。"}</p></div></div>
          <div className="clock-out-times missed"><span><small>{t("startTime")}</small><strong>{formatTime(staleActive.startedAt)}</strong></span><ArrowRight size={18} /><span><small>{locale === "ja" ? "対象日" : "日期"}</small><strong>{staleActive.workDate.replaceAll("-", "/")}</strong></span></div>
          <label><span>{t("endTime")}</span><input type="datetime-local" value={missedEndTime} min={toJstDateTimeLocal(staleActive.startedAt.toDate())} max={toJstDateTimeLocal(new Date())} onChange={(event) => setMissedEndTime(event.target.value)} required /></label>
          <label><span>{locale === "ja" ? "修正理由" : "修改原因"}</span><textarea rows={3} value={missedReason} onChange={(event) => setMissedReason(event.target.value)} minLength={3} required /></label>
          <p className="history-note">{locale === "ja" ? "入力した時刻・修正者・理由は変更履歴に保存され、管理画面では再確認が必要と表示されます。" : "输入时间、修改人和原因会保存在修改记录中，并在管理页面显示为需要复核。"}</p>
          <div className="modal-actions"><button className="button ghost" type="button" disabled={busy} onClick={() => setCorrectingMissedClockOut(false)}>{t("cancel")}</button><button className="button primary" type="submit" disabled={busy || !missedEndTime || missedReason.trim().length < 3}>{busy ? "…" : locale === "ja" ? "前日の勤務を確定" : "确认前一天考勤"}</button></div>
        </form>
      </div>}
      {manualClockInOpen && !active && !todayRecord && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setManualClockInOpen(false); }}>
        <form className="modal manual-clockin-modal" role="dialog" aria-modal="true" aria-labelledby="manual-clockin-title" onSubmit={(event) => { event.preventDefault(); void startWorkManually(); }}>
          <div className="missed-clockout-modal-title"><span className="modal-icon warning"><Clock3 size={24} /></span><div><h2 id="manual-clockin-title">{locale === "ja" ? "始業時刻を修正して開始" : "修改开始时间后开始"}</h2><p>{locale === "ja" ? "始業打刻を忘れた場合に、当日の実際の始業時刻と修正理由を入力します。" : "忘记打卡时，请输入当天实际开始工作的时间和修改原因。"}</p></div></div>
          <label><span>{locale === "ja" ? "始業時刻" : "开始时间"}</span><input type="datetime-local" value={manualStartTime} min={`${today}T00:00`} max={toJstDateTimeLocal(new Date())} onChange={(event) => setManualStartTime(event.target.value)} required /></label>
          <label><span>{locale === "ja" ? "修正理由" : "修改原因"}</span><textarea rows={3} value={manualStartReason} onChange={(event) => setManualStartReason(event.target.value)} minLength={3} required /></label>
          <p className="history-note">{locale === "ja" ? "入力した始業時刻と理由は記録として保存されます。" : "输入的开始时间和原因会作为记录保存。"}</p>
          <div className="modal-actions"><button className="button ghost" type="button" disabled={busy} onClick={() => setManualClockInOpen(false)}>{t("cancel")}</button><button className="button primary" type="submit" disabled={busy || !manualStartTime || manualStartReason.trim().length < 3}>{busy ? "…" : locale === "ja" ? "この時刻で始業" : "按此时间开始"}</button></div>
        </form>
      </div>}
    </div>
  );
}

function suggestedEndTime(record: AttendanceRecord): string {
  const startedAt = record.startedAt.toDate();
  const eightHoursLater = new Date(startedAt.getTime() + 8 * 60 * 60 * 1000);
  const endOfWorkDate = new Date(`${record.workDate}T23:59:00+09:00`);
  const candidate = new Date(Math.min(eightHoursLater.getTime(), endOfWorkDate.getTime(), Date.now()));
  return toJstDateTimeLocal(candidate);
}

function toJstDateTimeLocal(date: Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
  return parts.replace(" ", "T");
}

function jstLocalToIso(value: string): string {
  return new Date(`${value}:00+09:00`).toISOString();
}

function attendanceErrorMessage(error: unknown, locale: string, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  if (code === "unauthenticated" || code === "functions/unauthenticated" || /internal|unauthenticated|unauthorized|access token|401|invoke/i.test(message)) {
    return locale === "ja"
      ? "ログイン状態を確認できませんでした。画面を再読み込みして、もう一度お試しください。"
      : "无法确认登录状态。请刷新页面后重试。";
  }
  return message || fallback;
}
