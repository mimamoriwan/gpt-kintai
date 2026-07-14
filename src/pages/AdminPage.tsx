import { useMemo, useState, type FormEvent } from "react";
import { Archive, CalendarRange, Check, Clock3, Download, FileText, Filter, Plus, UserRoundPlus, UsersRound } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { elapsedMinutes, formatElapsed, formatTime, monthRange, todayJst } from "../lib/format";
import { deactivateUser, exportMonth, inviteUser, markReviewed, saveCategory } from "../services/api";
import type { AttendanceRecord, Category, DailyReport, Role, UserProfile } from "../types";

export function AdminPage({ attendance, reports, users, categories, notify }: {
  attendance: AttendanceRecord[];
  reports: DailyReport[];
  users: UserProfile[];
  categories: Category[];
  notify: (type: "success" | "error", message: string) => void;
}) {
  const { profile } = useAuth();
  const { locale, t } = useI18n();
  const [month, setMonth] = useState(todayJst().slice(0, 7));
  const range = monthRange(month);
  const [selectedUser, setSelectedUser] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [showCategory, setShowCategory] = useState(false);
  const isManager = profile?.role === "employee_manager";
  const filteredAttendance = useMemo(() => attendance.filter((item) => item.workDate >= range.from && item.workDate <= range.to && (!selectedUser || item.userId === selectedUser)), [attendance, range.from, range.to, selectedUser]);
  const filteredReports = useMemo(() => reports.filter((item) => item.reportDate >= range.from && item.reportDate <= range.to && (!selectedUser || item.userId === selectedUser)), [range.from, range.to, reports, selectedUser]);
  const totalMinutes = filteredAttendance.reduce((sum, item) => sum + elapsedMinutes(item.startedAt, item.endedAt), 0);
  const attachmentBytes = filteredReports.reduce((sum, report) => sum + (report.attachments || []).reduce((itemSum, item) => itemSum + item.size, 0), 0);
  const aiRuns = filteredReports.reduce((sum, report) => sum + Number(report.translationAttempts || 0), 0);
  const pending = reports.filter((item) => item.reviewStatus !== "reviewed" && item.userId !== profile?.uid);

  async function review(id: string) {
    try { await markReviewed("daily_report", id); notify("success", t("success")); }
    catch (error) { notify("error", error instanceof Error ? error.message : t("error")); }
  }
  async function backup() {
    try {
      const data = await exportMonth(month, selectedUser || undefined);
      downloadText(`gyoumulog-${month}.json`, data.json, "application/json");
      downloadText(`gyoumulog-${month}.csv`, data.csv, "text/csv;charset=utf-8");
      downloadText(`gyoumulog-${month}-attachments.csv`, data.manifest, "text/csv;charset=utf-8");
      notify("success", locale === "ja" ? "バックアップを3ファイル保存しました。" : "已保存3个备份文件。");
    } catch (error) { notify("error", error instanceof Error ? error.message : t("error")); }
  }
  async function toggleUser(user: UserProfile) {
    try { await deactivateUser(user.uid, user.active); notify("success", t("success")); }
    catch (error) { notify("error", error instanceof Error ? error.message : t("error")); }
  }

  return (
    <div className="page admin-page">
      <div className="page-heading split"><div><span className="eyebrow">MANAGEMENT DASHBOARD</span><h1>{locale === "ja" ? "管理ダッシュボード" : "管理仪表板"}</h1><p>{locale === "ja" ? "勤怠と業務状況を期間別に確認します。" : "按期间查看考勤和工作情况。"}</p></div>{isManager && <div className="heading-actions"><button className="button secondary" onClick={() => setShowCategory(true)}><Plus size={17} />{t("categorySettings")}</button><button className="button primary" onClick={() => setShowInvite(true)}><UserRoundPlus size={17} />{t("invite")}</button></div>}</div>
      <section className="card admin-filter"><Filter size={19} /><label><span>{locale === "ja" ? "対象月" : "月份"}</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label><label><span>{t("filterUser")}</span><select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}><option value="">{t("allUsers")}</option>{users.filter((user) => user.role !== "president_viewer").map((user) => <option key={user.uid} value={user.uid}>{user.displayName}</option>)}</select></label>{isManager && <button className="button ghost backup-button" onClick={() => void backup()}><Archive size={18} />{t("backup")}<Download size={16} /></button>}</section>
      <section className="metrics-grid"><Metric icon={CalendarRange} label={t("attendanceDays")} value={`${filteredAttendance.length}${locale === "ja" ? "日" : "天"}`} tone="blue" /><Metric icon={Clock3} label={t("totalElapsed")} value={formatElapsed(totalMinutes, locale)} tone="green" /><Metric icon={FileText} label={t("reportCount")} value={`${filteredReports.length}${locale === "ja" ? "件" : "份"}`} tone="violet" /><Metric icon={UsersRound} label={t("reviewNeeded")} value={`${pending.length}${locale === "ja" ? "件" : "份"}`} tone="amber" /></section>
      <div className="admin-content-grid">
        <section className="card"><div className="section-title"><span>{locale === "ja" ? "期間内の記録" : "期间记录"}</span><span className="tag blue">{range.from} – {range.to}</span></div><div className="table-wrap"><table><thead><tr><th>{t("displayName")}</th><th>{locale === "ja" ? "日付" : "日期"}</th><th>{locale === "ja" ? "勤務" : "方式"}</th><th>{t("startTime")}</th><th>{t("endTime")}</th><th>{t("elapsed")}</th></tr></thead><tbody>{filteredAttendance.map((item) => <tr key={item.id}><td><strong>{item.userName}</strong></td><td>{item.workDate}</td><td><span className="tag soft">{t(item.workMode === "home" ? "homeWork" : item.workMode)}</span></td><td>{formatTime(item.startedAt)}</td><td>{formatTime(item.endedAt)}</td><td>{formatElapsed(elapsedMinutes(item.startedAt, item.endedAt), locale)}</td></tr>)}</tbody></table>{filteredAttendance.length === 0 && <div className="empty-table">{t("noData")}</div>}</div></section>
        <section className="card review-panel"><div className="section-title"><span>{t("reviewNeeded")}</span><span className="count-badge">{pending.length}</span></div>{pending.slice(0, 8).map((report) => <article key={report.id}><div><strong>{report.userName}</strong><small>{report.reportDate} · {report.destinations}</small><p>{report.translatedFields?.activities || report.activities}</p></div>{isManager && <button className="icon-button success" onClick={() => void review(report.id)} title={t("markReviewed")}><Check size={18} /></button>}</article>)}{pending.length === 0 && <div className="empty-compact"><Check size={22} />{locale === "ja" ? "すべて確認済みです" : "已全部确认"}</div>}</section>
      </div>
      {isManager && <section className="card user-management"><div className="section-title"><span>{t("accountManagement")}</span><span className="usage-caption">{locale === "ja" ? `当月添付 ${formatBytes(attachmentBytes)}・AI ${aiRuns}回` : `本月附件 ${formatBytes(attachmentBytes)}・AI ${aiRuns}次`}</span></div><div className="user-grid">{users.map((user) => <article key={user.uid}><span className="avatar">{user.displayName.slice(0, 1)}</span><span><strong>{user.displayName}</strong><small>{user.email}</small><em>{user.role === "employee_manager" ? t("manager") : user.role === "president_viewer" ? t("president") : t("employee")}</em></span>{user.uid !== profile?.uid && <button className={`user-status ${user.active ? "active" : "inactive"}`} onClick={() => void toggleUser(user)}>{user.active ? (locale === "ja" ? "有効" : "启用") : (locale === "ja" ? "無効" : "停用")}</button>}</article>)}</div></section>}
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} notify={notify} />}
      {showCategory && <CategoryModal categories={categories} onClose={() => setShowCategory(false)} notify={notify} />}
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Clock3; label: string; value: string; tone: string }) { return <div className="card metric"><span className={`metric-icon ${tone}`}><Icon size={22} /></span><span><small>{label}</small><strong>{value}</strong></span></div>; }

function InviteModal({ onClose, notify }: { onClose: () => void; notify: (type: "success" | "error", message: string) => void }) {
  const { t, locale } = useI18n();
  const [form, setForm] = useState({ displayName: "", email: "", role: "employee" as Role, locale: "ja" });
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { const result = await inviteUser(form); await navigator.clipboard.writeText(result.resetLink); notify("success", locale === "ja" ? "アカウントを作成し、パスワード設定リンクをコピーしました。本人へ安全に共有してください。" : "账号已创建，密码设置链接已复制。请安全地发给本人。"); onClose(); } catch (error) { notify("error", error instanceof Error ? error.message : t("error")); } finally { setBusy(false); } }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit}><h2>{t("invite")}</h2><label><span>{t("displayName")}</span><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required /></label><label><span>{t("email")}</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label><label><span>{t("role")}</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}><option value="employee">{t("employee")}</option><option value="employee_manager">{t("manager")}</option><option value="president_viewer">{t("president")}</option></select></label><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>{t("cancel")}</button><button className="button primary" disabled={busy}>{busy ? "…" : t("invite")}</button></div></form></div>;
}

function CategoryModal({ categories, onClose, notify }: { categories: Category[]; onClose: () => void; notify: (type: "success" | "error", message: string) => void }) {
  const { t } = useI18n(); const [ja, setJa] = useState(""); const [zh, setZh] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { await saveCategory({ labelJa: ja, labelZh: zh, active: true, order: categories.length + 1 }); notify("success", t("success")); setJa(""); setZh(""); } catch (error) { notify("error", error instanceof Error ? error.message : t("error")); } finally { setBusy(false); } }
  return <div className="modal-backdrop"><div className="modal wide"><h2>{t("categorySettings")}</h2><div className="category-list">{categories.map((item) => <div key={item.id}><span>{item.labelJa}</span><small>{item.labelZh}</small></div>)}</div><form onSubmit={submit} className="inline-category"><input value={ja} onChange={(e) => setJa(e.target.value)} placeholder="日本語" required /><input value={zh} onChange={(e) => setZh(e.target.value)} placeholder="中文" required /><button className="button secondary" disabled={busy}><Plus size={17} />追加</button></form><div className="modal-actions"><button className="button primary" onClick={onClose}>{t("back")}</button></div></div></div>;
}

function downloadText(name: string, content: string, type: string) { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }

function formatBytes(bytes: number): string { if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`; return `${(bytes / 1024 / 1024).toFixed(1)}MB`; }
