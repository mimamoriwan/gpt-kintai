import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BarChart3, BookOpenCheck, CalendarDays, ClipboardPenLine, Clock3, Flag, History, Megaphone, PackageSearch, RefreshCw, Settings, SlidersHorizontal, UserRoundCog, type LucideIcon } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { pendingInstructionSummary } from "../components/PresidentInstructions";
import { businessFeatureAvailable } from "../features/business/api";
import { formatDate, todayJst } from "../lib/format";
import { resolveCompanyDay } from "../lib/companyCalendar";
import { MONTHLY_AI_GENERATION_ALERT_THRESHOLD, aiApiGenerationCount, monthlyAiUsageEvents } from "../lib/aiUsage";
import { watchAiUsageEvents } from "../services/api";
import { HomeOperationsPage, type HomeOperationsProps } from "./HomeOperationsPage";
import type { AuditEvent, NavSection } from "../types";

type HomeTool = "attendance" | "calendar";
type HomePageProps = Omit<HomeOperationsProps, "view"> & {
  onSection: (section: NavSection) => void;
  onAnnouncements: () => void;
  canManageAccounts?: boolean;
  homeVisit?: number;
};
type HomeApp = { id: string; label: string; icon: LucideIcon; color: string; visible: boolean; open: () => void; status?: string; badge?: number };

export function HomePage({ onSection, onAnnouncements, canManageAccounts = false, homeVisit = 0, ...operations }: HomePageProps) {
  const { profile } = useAuth();
  const { locale, t } = useI18n();
  const [tool, setTool] = useState<HomeTool | null>(null);
  const [aiUsage, setAiUsage] = useState<AuditEvent[]>([]);
  const launcherRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const president = profile?.role === "president_viewer";
  const manager = profile?.role === "employee_manager";
  const today = todayJst();
  const ja = locale === "ja";
  useEffect(() => { setTool(null); }, [homeVisit, profile?.uid]);
  useEffect(() => {
    if (manager && !tool) return watchAiUsageEvents(setAiUsage);
  }, [manager, tool]);
  useEffect(() => {
    if (!tool) return;
    const heading = detailRef.current?.querySelector("h1");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }, [tool]);
  function openTool(next: HomeTool) {
    setTool(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function backToApps() {
    const previous = tool;
    setTool(null);
    requestAnimationFrame(() => launcherRef.current?.querySelector<HTMLButtonElement>(`[data-home-app="${previous}"]`)?.focus());
  }
  const ownReports = operations.reports.filter((row) => row.userId === profile?.uid);
  const provisional = ownReports.filter((row) => row.status === "provisional" && row.reportDate <= today).sort((a, b) => a.reportDate.localeCompare(b.reportDate))[0];
  const failed = (operations.automations || []).filter((row) => row.userId === profile?.uid && (row.status === "blocked_no_memo" || row.status === "failed") && !ownReports.some((report) => report.reportDate === row.workDate && report.status !== "provisional")).sort((a, b) => a.workDate.localeCompare(b.workDate))[0];
  const generating = (operations.automations || []).some((row) => row.userId === profile?.uid && row.workDate === today && (row.status === "queued" || row.status === "generating"));
  const todayReport = ownReports.find((row) => row.reportDate === today);
  const active = operations.attendance.find((row) => row.userId === profile?.uid && row.status === "active");
  const todayAttendance = operations.attendance.find((row) => row.userId === profile?.uid && row.workDate === today);
  const companyDay = resolveCompanyDay(today, operations.holidayOverrides.find((row) => row.date === today));
  const pending = profile ? pendingInstructionSummary(operations.instructions || [], profile.uid).pending.length : 0;
  const aiRuns = aiApiGenerationCount(monthlyAiUsageEvents(aiUsage, today.slice(0, 7)));
  const attendanceStatus = active ? (active.workDate < today ? (ja ? "前日の終業未記録" : "前一天结束时间未记录") : t("working")) : todayAttendance?.endedAt ? (ja ? "終了済み" : "已结束") : companyDay.isHoliday ? (ja ? "会社休日（予定）" : "公司休息日（计划）") : undefined;
  const reportStatus = failed ? (ja ? "自動作成を要確認" : "请检查自动生成") : provisional ? (ja ? "確認して提出" : "确认并提交") : generating ? (ja ? "自動作成中" : "正在自动生成") : todayReport ? t("submitted") : !companyDay.isHoliday || todayAttendance ? (ja ? "本日未提出" : "今天尚未提交") : undefined;
  function openReport() {
    if (failed && operations.onReportDate) operations.onReportDate(failed.workDate);
    else if (provisional && operations.onConfirmReport) operations.onConfirmReport(provisional);
    else operations.onReport();
  }
  const apps: HomeApp[] = [
    { id: "announcements", label: ja ? "お知らせ" : "通知", icon: Megaphone, color: "blue", visible: true, open: onAnnouncements, badge: pending, status: pending ? (ja ? `未確認 ${pending}件` : `${pending}条未确认`) : undefined },
    { id: "attendance", label: ja ? "勤怠・打刻" : "考勤与打卡", icon: Clock3, color: "teal", visible: !president, open: () => openTool("attendance"), status: attendanceStatus },
    { id: "report", label: t("dailyReport"), icon: ClipboardPenLine, color: "blue", visible: !president, open: openReport, status: reportStatus },
    { id: "calendar", label: ja ? "共有業務カレンダー" : "共享工作日历", icon: CalendarDays, color: "blue", visible: true, open: () => openTool("calendar") },
    { id: "records", label: t("records"), icon: BarChart3, color: "indigo", visible: !president, open: () => onSection("records") },
    { id: "products", label: t("products"), icon: PackageSearch, color: "orange", visible: true, open: () => onSection("products") },
    { id: "workflow", label: t("workflow"), icon: RefreshCw, color: "cyan", visible: true, open: () => onSection("workflow") },
    { id: "weeklyTodo", label: ja ? "今週のTo Do" : "本周待办", icon: ClipboardPenLine, color: "indigo", visible: true, open: () => onSection("weeklyTodo") },
    { id: "business", label: ja ? "会社の取り組み" : "公司重点工作", icon: Flag, color: "violet", visible: businessFeatureAvailable, open: () => onSection("business") },
    { id: "admin", label: t("admin"), icon: SlidersHorizontal, color: "slate", visible: manager || president, open: () => onSection("admin"), status: manager && aiRuns >= MONTHLY_AI_GENERATION_ALERT_THRESHOLD ? (ja ? "AI利用状況を要確認" : "请检查AI使用情况") : undefined },
    { id: "accounts", label: ja ? "ログイン管理" : "登录管理", icon: UserRoundCog, color: "blue", visible: manager && canManageAccounts, open: () => onSection("accounts") },
    { id: "help", label: t("help"), icon: BookOpenCheck, color: "teal", visible: true, open: () => onSection("help") },
    { id: "updates", label: t("updates"), icon: History, color: "slate", visible: true, open: () => onSection("updates") },
    { id: "settings", label: t("settings"), icon: Settings, color: "slate", visible: true, open: () => onSection("settings") }
  ];
  if (tool) return <div ref={detailRef} className="home-tool-page">
    <div className="home-tool-navigation"><button type="button" className="back-link" onClick={backToApps}><ArrowLeft size={18} aria-hidden="true" />{ja ? "ホームの機能一覧へ戻る" : "返回首页功能列表"}</button></div>
    <HomeOperationsPage {...operations} view={tool} />
  </div>;
  return <div className="page home-page">
    <div className="page-heading home-heading"><div><span className="eyebrow">{t("home")}</span><h1><span>{profile?.displayName}{ja ? "さん、" : "，"}</span><span className="home-greeting-text">{ja ? "お疲れさまです" : "辛苦了"}</span></h1><p>{formatDate(today, ja ? "ja-JP" : "zh-CN")}</p></div></div>
    <section ref={launcherRef} className="card home-launcher" aria-labelledby="home-apps-title">
      <header><h2 id="home-apps-title">{ja ? "機能一覧" : "功能列表"}</h2><p>{ja ? "使いたい機能を選んでください" : "请选择要使用的功能"}</p></header>
      <div className="home-app-grid">{apps.filter((app) => app.visible).map(({ id, label, icon: Icon, color, open, status, badge }) => <button key={id} type="button" className="home-app" data-home-app={id} onClick={open}>
        <span className={`home-app-icon ${color}`}><Icon aria-hidden="true" strokeWidth={1.8} />
          {badge !== undefined && badge > 0 && <b className="home-app-badge" aria-hidden="true">{badge > 99 ? "99+" : badge}</b>}
        </span>
        <span className="home-app-label">{label}</span>
        {status && <span className="home-app-status">{status}</span>}
      </button>)}</div>
    </section>
  </div>;
}
