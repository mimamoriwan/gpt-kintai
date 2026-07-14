import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, CheckCircle2, Clock3, Home as HomeIcon, MapPin, Plane, TriangleAlert } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { elapsedMinutes, formatDate, formatElapsed, formatTime, todayJst } from "../lib/format";
import { clockIn, clockOut } from "../services/api";
import type { AttendanceRecord, DailyReport, WorkMode } from "../types";

export function HomePage({ attendance, reports, onReport, notify }: { attendance: AttendanceRecord[]; reports: DailyReport[]; onReport: () => void; notify: (type: "success" | "error", message: string) => void }) {
  const { profile } = useAuth();
  const { locale, t } = useI18n();
  const [mode, setMode] = useState<WorkMode>("business_trip");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);
  const today = todayJst();
  const active = attendance.find((item) => item.userId === profile?.uid && item.status === "active");
  const todayRecord = attendance.find((item) => item.userId === profile?.uid && item.workDate === today);
  const hasReport = reports.some((item) => item.userId === profile?.uid && item.reportDate === today);
  const elapsed = active ? elapsedMinutes(active.startedAt, now) : todayRecord?.endedAt ? elapsedMinutes(todayRecord.startedAt, todayRecord.endedAt) : 0;
  const modeOptions = useMemo(() => [
    { value: "office" as const, label: t("office"), icon: Building2 },
    { value: "business_trip" as const, label: t("business_trip"), icon: Plane },
    { value: "home" as const, label: t("homeWork"), icon: HomeIcon },
    { value: "other" as const, label: t("other"), icon: MapPin }
  ], [t]);

  async function toggleClock() {
    setBusy(true);
    try {
      if (active) await clockOut(); else await clockIn(mode);
      notify("success", locale === "ja" ? (active ? "終業時刻を記録しました。" : "始業時刻を記録しました。") : (active ? "已记录结束时间。" : "已记录开始时间。"));
    } catch (error) { notify("error", error instanceof Error ? error.message : t("error")); }
    finally { setBusy(false); }
  }

  return (
    <div className="page home-page">
      <div className="page-heading"><div><span className="eyebrow">{t("today")}</span><h1>{locale === "ja" ? `${profile?.displayName}さん、お疲れさまです` : `${profile?.displayName}，辛苦了`}</h1><p>{formatDate(today, locale === "ja" ? "ja-JP" : "zh-CN")}</p></div></div>
      <div className="home-grid">
        <section className={`card attendance-hero ${active ? "is-active" : ""}`}>
          <div className="section-title"><span><Clock3 size={20} />{t("workStatus")}</span>{active && <span className="status-chip green"><i />{t("working")}</span>}</div>
          <div className="clock-display">
            <div><small>{t("startTime")}</small><strong>{formatTime(todayRecord?.startedAt)}</strong></div>
            <span className="clock-line" />
            <div><small>{t("endTime")}</small><strong>{formatTime(todayRecord?.endedAt)}</strong></div>
          </div>
          {(active || todayRecord?.endedAt) && <div className="elapsed-display"><span>{t("elapsed")}</span><strong>{formatElapsed(elapsed, locale)}</strong></div>}
          {!active && !todayRecord?.endedAt && <div className="mode-picker">{modeOptions.map((item) => <button key={item.value} className={mode === item.value ? "selected" : ""} onClick={() => setMode(item.value)}><item.icon size={22} /><span>{item.label}</span></button>)}</div>}
          <button className={`button punch ${active ? "danger" : "success"}`} disabled={busy || Boolean(todayRecord?.endedAt)} onClick={() => void toggleClock()}>{busy ? "…" : active ? t("clockOut") : todayRecord?.endedAt ? t("finished") : t("clockIn")}</button>
          <p className="legal-note">{t("systemNotice")}</p>
        </section>
        <aside className="home-aside">
          {active && <div className="notice-card warning"><TriangleAlert size={21} /><span><strong>{t("unclosedReminder")}</strong><small>{formatTime(active.startedAt)}〜</small></span></div>}
          {!hasReport && <button className="notice-card report" onClick={onReport}><span className="notice-icon">日</span><span><strong>{t("reportReminder")}</strong><small>{t("writeReport")}</small></span><ArrowRight size={20} /></button>}
          {hasReport && <div className="notice-card success"><CheckCircle2 size={22} /><span><strong>{t("submitted")}</strong><small>{locale === "ja" ? "本日の日報は記録済みです" : "今天的日报已记录"}</small></span></div>}
          <div className="card recent-card"><div className="section-title"><span>{locale === "ja" ? "最近の勤務" : "最近的考勤"}</span></div>{attendance.filter((item) => item.userId === profile?.uid).slice(0, 4).map((item) => <div className="mini-row" key={item.id}><span><strong>{item.workDate.slice(5).replace("-", "/")}</strong><small>{t(item.workMode === "home" ? "homeWork" : item.workMode)}</small></span><span>{formatTime(item.startedAt)} – {formatTime(item.endedAt)}</span></div>)}</div>
        </aside>
      </div>
    </div>
  );
}
