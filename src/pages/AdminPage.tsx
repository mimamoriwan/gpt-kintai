import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Archive, CalendarOff, CalendarRange, Check, Clock3, Download, Eye, FileText, Filter, Link2, LoaderCircle, PackageSearch, Paperclip, Plus, Trash2, UserRoundPlus, UsersRound } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { elapsedMinutes, formatElapsed, formatTime, monthRange, todayJst } from "../lib/format";
import { resolveCompanyDay } from "../lib/companyCalendar";
import { deactivateUser, exportMonth, getCalendarMembers, inviteUser, markReviewed, removeCompanyHolidayOverride, saveCalendarMember, saveCategory, saveCompanyHolidayOverride, watchWorkLogs } from "../services/api";
import type { AttendanceRecord, CalendarMemberInput, Category, CompanyDayType, CompanyHolidayOverride, DailyReport, Product, ProductObservation, ProductStatus, Role, UserProfile, WorkLogEntry } from "../types";

export function AdminPage({ attendance, reports, users, categories, holidayOverrides, products, productObservations, notify }: {
  attendance: AttendanceRecord[];
  reports: DailyReport[];
  users: UserProfile[];
  categories: Category[];
  holidayOverrides: CompanyHolidayOverride[];
  products: Product[];
  productObservations: ProductObservation[];
  notify: (type: "success" | "error", message: string) => void;
}) {
  const { profile } = useAuth();
  const { locale, t } = useI18n();
  const [month, setMonth] = useState(todayJst().slice(0, 7));
  const range = monthRange(month);
  const [selectedUser, setSelectedUser] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [showCategory, setShowCategory] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showCalendarMembers, setShowCalendarMembers] = useState(false);
  const [reviewingReport, setReviewingReport] = useState<DailyReport | null>(null);
  const isManager = profile?.role === "employee_manager";
  const filteredAttendance = useMemo(() => attendance.filter((item) => item.workDate >= range.from && item.workDate <= range.to && (!selectedUser || item.userId === selectedUser)), [attendance, range.from, range.to, selectedUser]);
  const filteredReports = useMemo(() => reports.filter((item) => item.reportDate >= range.from && item.reportDate <= range.to && (!selectedUser || item.userId === selectedUser)), [range.from, range.to, reports, selectedUser]);
  const totalMinutes = filteredAttendance.reduce((sum, item) => sum + elapsedMinutes(item.startedAt, item.endedAt), 0);
  const attachmentBytes = filteredReports.reduce((sum, report) => sum + (report.attachments || []).reduce((itemSum, item) => itemSum + item.size, 0), 0);
  const aiRuns = filteredReports.reduce((sum, report) => sum + Number(report.translationAttempts || 0), 0);
  const pending = reports.filter((item) => (item.reviewStatus === "unreviewed" || item.reviewStatus === "needs_review") && (!isManager || item.userId !== profile?.uid));
  const pendingProducts = productObservations.filter((item) => item.reviewStatus !== "reviewed" && (!isManager || item.userId !== profile?.uid));
  const pendingAttendance = filteredAttendance.filter((item) => item.needsReview);
  const productStatusCounts = useMemo(() => countBy(products, (item) => item.status), [products]);
  const productObserverCounts = useMemo(() => countBy(productObservations, (item) => item.userName), [productObservations]);

  async function review(id: string) {
    try { await markReviewed("daily_report", id); notify("success", locale === "ja" ? "日報を確認済みにしました。" : "日报已标记为确认。" ); setReviewingReport(null); }
    catch (error) { notify("error", error instanceof Error ? error.message : t("error")); }
  }

  async function reviewAttendance(id: string) {
    try {
      await markReviewed("attendance", id);
      notify("success", locale === "ja" ? "勤怠時刻の修正を確認済みにしました。" : "已确认考勤时间修改。");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : t("error"));
    }
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
      <div className="page-heading split"><div><span className="eyebrow">MANAGEMENT DASHBOARD</span><h1>{locale === "ja" ? "管理ダッシュボード" : "管理仪表板"}</h1><p>{locale === "ja" ? "勤怠と業務状況を期間別に確認します。" : "按期间查看考勤和工作情况。"}</p></div>{isManager && <div className="heading-actions"><button className="button secondary" onClick={() => setShowCalendar(true)}><CalendarOff size={17} />{locale === "ja" ? "会社カレンダー" : "公司日历"}</button><button className="button secondary" onClick={() => setShowCalendarMembers(true)}><UsersRound size={17} />{locale === "ja" ? "カレンダー名簿" : "日历成员"}</button><button className="button secondary" onClick={() => setShowCategory(true)}><Plus size={17} />{t("categorySettings")}</button><button className="button primary" onClick={() => setShowInvite(true)}><UserRoundPlus size={17} />{t("invite")}</button></div>}</div>
      <section className="card admin-filter"><Filter size={19} /><label><span>{locale === "ja" ? "対象月" : "月份"}</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label><label><span>{t("filterUser")}</span><select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}><option value="">{t("allUsers")}</option>{users.filter((user) => user.role !== "president_viewer").map((user) => <option key={user.uid} value={user.uid}>{user.displayName}</option>)}</select></label>{isManager && <button className="button ghost backup-button" onClick={() => void backup()}><Archive size={18} />{t("backup")}<Download size={16} /></button>}</section>
      <section className="metrics-grid"><Metric icon={CalendarRange} label={t("attendanceDays")} value={`${filteredAttendance.length}${locale === "ja" ? "日" : "天"}`} tone="blue" /><Metric icon={Clock3} label={t("totalElapsed")} value={formatElapsed(totalMinutes, locale)} tone="green" /><Metric icon={FileText} label={t("reportCount")} value={`${filteredReports.length}${locale === "ja" ? "件" : "份"}`} tone="violet" /><Metric icon={Clock3} label={locale === "ja" ? "要確認の勤怠" : "待确认考勤"} value={`${pendingAttendance.length}${locale === "ja" ? "件" : "条"}`} tone="amber" /><Metric icon={UsersRound} label={locale === "ja" ? "未確認の日報" : "待确认日报"} value={`${pending.length}${locale === "ja" ? "件" : "份"}`} tone="amber" /><Metric icon={PackageSearch} label={locale === "ja" ? "未確認の商品記録" : "待确认商品记录"} value={`${pendingProducts.length}${locale === "ja" ? "件" : "条"}`} tone="blue" /></section>
      <div className="admin-content-grid">
        <section className="card"><div className="section-title"><span>{locale === "ja" ? "期間内の記録" : "期间记录"}</span><span className="tag blue">{range.from} – {range.to}</span></div><div className="table-wrap"><table><thead><tr><th>{t("displayName")}</th><th>{locale === "ja" ? "日付" : "日期"}</th><th>{locale === "ja" ? "勤務" : "方式"}</th><th>{t("startTime")}</th><th>{t("endTime")}</th><th>{t("elapsed")}</th></tr></thead><tbody>{filteredAttendance.map((item) => <tr key={item.id}><td><strong>{item.userName}</strong></td><td>{item.workDate}</td><td><span className="attendance-kind-tags">{item.holidayWork && <span className="tag amber">{locale === "ja" ? "休日勤務" : "休息日工作"}</span>}<span className="tag soft">{t(item.workMode === "home" ? "homeWork" : item.workMode)}</span></span></td><td><div className="attendance-entry-cell"><strong>{formatTime(item.startedAt)}</strong>{item.startEntryMethod === "manual" && <><span className="tag amber">{locale === "ja" ? "手入力始業" : "手动补录开始"}</span><small>{locale === "ja" ? "操作時刻" : "操作时间"}: {formatTime(item.clockInRecordedAt)}</small><small>{locale === "ja" ? "理由" : "原因"}: {item.manualStartReason || "-"}</small></>}{item.corrected && <><span className="tag amber">{locale === "ja" ? "勤怠時刻を修正" : "已修改考勤时间"}</span><small>{locale === "ja" ? "修正理由" : "修改原因"}: {item.correctionReason || "-"}</small></>}{item.needsReview && <span className="tag amber">{locale === "ja" ? "要確認" : "待确认"}</span>}{isManager && item.needsReview && <button type="button" className="button ghost" onClick={() => void reviewAttendance(item.id)}><Check size={15} />{locale === "ja" ? "確認済みにする" : "标记为已确认"}</button>}</div></td><td>{formatTime(item.endedAt)}</td><td>{formatElapsed(elapsedMinutes(item.startedAt, item.endedAt), locale)}</td></tr>)}</tbody></table>{filteredAttendance.length === 0 && <div className="empty-table">{t("noData")}</div>}</div></section>
        <section className="card review-panel"><div className="section-title"><span>{locale === "ja" ? "未確認の日報" : "待确认日报"}</span><span className="count-badge">{pending.length}</span></div>{pending.slice(0, 8).map((report) => <article key={report.id}><div><strong>{report.userName}</strong><small>{report.reportDate}{report.destinations ? ` · ${report.destinations}` : ""}</small><p>{report.translatedFields?.activities || report.activities}</p></div><button className="button ghost review-open-button" onClick={() => setReviewingReport(report)}><Eye size={16} />{isManager ? (locale === "ja" ? "内容を確認" : "查看并确认") : (locale === "ja" ? "閲覧" : "查看")}</button></article>)}{pending.length === 0 && <div className="empty-compact"><Check size={22} />{locale === "ja" ? "すべて確認済みです" : "已全部确认"}</div>}</section>
      </div>
      <section className="card product-admin-summary"><div className="section-title"><span>{locale === "ja" ? "商品候補の状況" : "商品候选情况"}</span><span className="count-badge">{products.length}</span></div><div className="product-summary-groups"><div><small>{locale === "ja" ? "検討状態別" : "按评估状态"}</small><div className="summary-chips">{(["new", "considering", "on_hold", "closed"] as ProductStatus[]).map((value) => <span className={`status-chip product-${value}`} key={value}>{adminProductStatus(value, locale)} {productStatusCounts[value] || 0}</span>)}</div></div><div><small>{locale === "ja" ? "発見者別" : "按发现者"}</small><div className="summary-chips">{Object.entries(productObserverCounts).map(([name, count]) => <span className="tag soft" key={name}>{name} {count}</span>)}{Object.keys(productObserverCounts).length === 0 && <span className="tag soft">{locale === "ja" ? "記録なし" : "暂无记录"}</span>}</div></div></div></section>
      {isManager && <section className="card user-management"><div className="section-title"><span>{t("accountManagement")}</span><span className="usage-caption">{locale === "ja" ? `旧方式の日報添付 ${formatBytes(attachmentBytes)}・AI ${aiRuns}回` : `旧版日报附件 ${formatBytes(attachmentBytes)}・AI ${aiRuns}次`}</span></div><div className="user-grid">{users.map((user) => <article key={user.uid}><span className="avatar">{user.displayName.slice(0, 1)}</span><span><strong>{user.displayName}</strong><small>{user.email}</small><em>{user.role === "employee_manager" ? t("manager") : user.role === "president_viewer" ? t("president") : t("employee")}</em></span>{user.uid !== profile?.uid && <button className={`user-status ${user.active ? "active" : "inactive"}`} onClick={() => void toggleUser(user)}>{user.active ? (locale === "ja" ? "有効" : "启用") : (locale === "ja" ? "無効" : "停用")}</button>}</article>)}</div></section>}
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} notify={notify} />}
      {showCategory && <CategoryModal categories={categories} onClose={() => setShowCategory(false)} notify={notify} />}
      {showCalendar && <CompanyCalendarModal overrides={holidayOverrides} initialMonth={month} onClose={() => setShowCalendar(false)} notify={notify} />}
      {showCalendarMembers && <CalendarMemberModal users={users} onClose={() => setShowCalendarMembers(false)} notify={notify} />}
      {reviewingReport && <ReportReviewModal report={reviewingReport} isManager={isManager} onClose={() => setReviewingReport(null)} onReviewed={() => void review(reviewingReport.id)} />}
    </div>
  );
}

function CompanyCalendarModal({ overrides, initialMonth, onClose, notify }: { overrides: CompanyHolidayOverride[]; initialMonth: string; onClose: () => void; notify: (type: "success" | "error", message: string) => void }) {
  const { locale, t } = useI18n();
  const [startDate, setStartDate] = useState(`${initialMonth}-01`);
  const [endDate, setEndDate] = useState(`${initialMonth}-01`);
  const [dayType, setDayType] = useState<CompanyDayType>("company_holiday");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const automatic = resolveCompanyDay(startDate);
  const visibleMonth = startDate.slice(0, 7);
  const visible = overrides.filter((item) => item.date.startsWith(visibleMonth)).sort((a, b) => a.date.localeCompare(b.date));
  const visibleGroups = useMemo(() => {
    const grouped = new Map<string, CompanyHolidayOverride>();
    for (const item of visible) grouped.set(item.holidayGroupId || item.date, item);
    return [...grouped.values()].sort((a, b) => (a.rangeStart || a.date).localeCompare(b.rangeStart || b.date));
  }, [visible]);

  function selectStartDate(value: string) {
    setStartDate(value);
    if (value > endDate) setEndDate(value);
    const current = overrides.find((item) => item.date === value);
    setDayType(current?.dayType || (resolveCompanyDay(value).isHoliday ? "workday" : "company_holiday"));
    setLabel(current?.label || "");
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      await saveCompanyHolidayOverride({ startDate, endDate, dayType, label: label.trim() });
      notify("success", locale === "ja" ? "指定期間の会社カレンダーを保存しました。" : "已保存指定期间的公司日历。");
    } catch (error) { notify("error", error instanceof Error ? error.message : t("error")); }
    finally { setBusy(false); }
  }
  async function remove(item: CompanyHolidayOverride) {
    setBusy(true);
    try { await removeCompanyHolidayOverride(item.date, item.holidayGroupId); notify("success", locale === "ja" ? "期間の例外設定を削除し、自動判定へ戻しました。" : "已删除期间例外并恢复自动判断。"); }
    catch (error) { notify("error", error instanceof Error ? error.message : t("error")); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop"><div className="modal wide company-calendar-modal"><div><span className="eyebrow">COMPANY CALENDAR</span><h2>{locale === "ja" ? "会社休日（予定）の例外設定" : "公司休息日（计划）例外设置"}</h2><p className="modal-description">{locale === "ja" ? "土日祝は自動で会社休日になります。平日を会社休日にする場合、または休日を通常出勤日にする場合だけ登録してください。" : "周末和日本节假日会自动设为公司休息日。仅在把工作日改为休息日或把休息日改为工作日时登记。"}</p></div>
    <form onSubmit={submit} className="company-calendar-form">
      <label><span>{locale === "ja" ? "開始日" : "开始日期"}</span><input type="date" value={startDate} onChange={(event) => selectStartDate(event.target.value)} required /></label>
      <label><span>{locale === "ja" ? "終了日" : "结束日期"}</span><input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
      <div className="calendar-auto-status"><span><small>{locale === "ja" ? "開始日の自動判定" : "开始日期的自动判断"}</small><strong className={automatic.isHoliday ? "holiday" : "workday"}>{automatic.isHoliday ? (locale === "ja" ? `会社休日（${automatic.label}）` : `公司休息日（${automatic.label}）`) : (locale === "ja" ? "通常出勤日" : "正常工作日")}</strong></span><span className="tag blue">{startDate === endDate ? (locale === "ja" ? "1日" : "1天") : `${startDate} – ${endDate}`}</span></div>
      <label><span>{locale === "ja" ? "この日の扱い" : "当天类型"}</span><select value={dayType} onChange={(event) => setDayType(event.target.value as CompanyDayType)}><option value="company_holiday">{locale === "ja" ? "会社休日にする" : "设为公司休息日"}</option><option value="workday">{locale === "ja" ? "通常出勤日にする" : "设为正常工作日"}</option></select></label>
      <label><span>{locale === "ja" ? "理由・名称（任意）" : "原因或名称（可选）"}</span><input value={label} maxLength={80} placeholder={locale === "ja" ? "例：夏季休業、棚卸し出勤日" : "例：暑假、盘点工作日"} onChange={(event) => setLabel(event.target.value)} /></label>
      <button className="button primary" disabled={busy}>{busy ? "…" : locale === "ja" ? "期間を保存" : "保存期间"}</button>
    </form>
    <section className="calendar-override-list"><div className="section-title"><span>{visibleMonth.replace("-", "/")} {locale === "ja" ? "の例外" : "的例外"}</span><span className="count-badge">{visibleGroups.length}</span></div>{visibleGroups.length === 0 ? <div className="empty-compact">{locale === "ja" ? "例外設定はありません" : "没有例外设置"}</div> : visibleGroups.map((item) => <div className="calendar-override-row" key={item.holidayGroupId || item.date}><span><strong>{item.rangeStart && item.rangeEnd && item.rangeStart !== item.rangeEnd ? `${item.rangeStart} – ${item.rangeEnd}` : item.date}</strong><small>{item.label || (item.dayType === "company_holiday" ? (locale === "ja" ? "会社休日" : "公司休息日") : (locale === "ja" ? "通常出勤日" : "正常工作日"))}</small></span><span className={`tag ${item.dayType === "company_holiday" ? "amber" : "green"}`}>{item.dayType === "company_holiday" ? (locale === "ja" ? "休日" : "休息日") : (locale === "ja" ? "出勤日" : "工作日")}</span><button type="button" className="icon-button" disabled={busy} aria-label={locale === "ja" ? "期間を削除" : "删除期间"} onClick={() => void remove(item)}><Trash2 size={17} /></button></div>)}</section>
    <div className="modal-actions"><button className="button ghost" type="button" onClick={onClose}>{t("back")}</button></div>
  </div></div>;
}

function CalendarMemberModal({ users, onClose, notify }: { users: UserProfile[]; onClose: () => void; notify: (type: "success" | "error", message: string) => void }) {
  const { locale, t } = useI18n();
  const [drafts, setDrafts] = useState<CalendarMemberInput[]>([]);
  const [busyId, setBusyId] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const rows = await getCalendarMembers(true);
      setDrafts(rows.map((item) => ({ id: item.id, displayName: item.displayName, linkedUserId: item.linkedUserId || "", active: item.active, order: item.order })));
    } catch (error) { notify("error", error instanceof Error ? error.message : t("error")); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  function update(index: number, values: Partial<CalendarMemberInput>) {
    setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...values } : item));
  }
  async function save(item: CalendarMemberInput, index: number) {
    setBusyId(item.id || `new-${index}`);
    try { await saveCalendarMember(item); notify("success", locale === "ja" ? "カレンダー名簿を保存しました。" : "日历成员已保存。"); await load(); }
    catch (error) { notify("error", error instanceof Error ? error.message : t("error")); }
    finally { setBusyId(""); }
  }
  function addMember() {
    if (drafts.length >= 3) return;
    setDrafts((current) => [...current, { displayName: "", linkedUserId: "", active: true, order: (current.length + 1) * 10 }]);
  }

  return <div className="modal-backdrop"><div className="modal wide calendar-member-modal"><div><span className="eyebrow">CALENDAR MEMBERS</span><h2>{locale === "ja" ? "共有カレンダー名簿" : "共享日历成员"}</h2><p className="modal-description">{locale === "ja" ? "ログインしない社長も、予定の参加者として登録できます。メールアドレスはカレンダー利用者には表示されません。" : "即使社长不登录，也可以作为日程参与者登记。日历用户不会看到邮箱地址。"}</p></div>
    {loading ? <div className="calendar-loading-inline"><LoaderCircle className="spin" size={18} />{locale === "ja" ? "名簿を読み込み中" : "正在读取成员"}</div> : <div className="calendar-member-admin-list">{drafts.map((item, index) => <article key={item.id || `new-${index}`}>
      <label><span>{locale === "ja" ? "表示名" : "显示名称"}</span><input value={item.displayName} maxLength={80} onChange={(event) => update(index, { displayName: event.target.value })} /></label>
      <label><span>{locale === "ja" ? "ログインとの紐付け（任意）" : "关联登录账号（可选）"}</span><select value={item.linkedUserId || ""} onChange={(event) => update(index, { linkedUserId: event.target.value })}><option value="">{locale === "ja" ? "紐付けなし" : "不关联"}</option>{users.map((user) => <option value={user.uid} key={user.uid}>{user.displayName}（{user.role === "president_viewer" ? (locale === "ja" ? "社長" : "社长") : user.role === "employee_manager" ? (locale === "ja" ? "管理" : "管理员") : (locale === "ja" ? "従業員" : "员工")}）</option>)}</select></label>
      <label className="calendar-member-order"><span>{locale === "ja" ? "表示順" : "顺序"}</span><input type="number" min="0" max="1000" value={item.order} onChange={(event) => update(index, { order: Number(event.target.value) })} /></label>
      <label className="checkbox-row calendar-member-active"><input type="checkbox" checked={item.active} onChange={(event) => update(index, { active: event.target.checked })} /><span>{locale === "ja" ? "有効" : "启用"}</span></label>
      <button className="button primary" type="button" disabled={!item.displayName.trim() || Boolean(busyId)} onClick={() => void save(item, index)}>{busyId === (item.id || `new-${index}`) ? "…" : locale === "ja" ? "保存" : "保存"}</button>
    </article>)}</div>}
    <div className="modal-actions"><button className="button secondary" type="button" disabled={drafts.length >= 3 || loading} onClick={addMember}><Plus size={16} />{locale === "ja" ? "メンバーを追加" : "添加成员"}</button><span /><button className="button ghost" type="button" onClick={onClose}>{t("back")}</button></div>
  </div></div>;
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
  const { t, locale } = useI18n(); const [ja, setJa] = useState(""); const [zh, setZh] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { await saveCategory({ labelJa: ja, labelZh: zh, active: true, order: categories.length + 1 }); notify("success", t("success")); setJa(""); setZh(""); } catch (error) { notify("error", error instanceof Error ? error.message : t("error")); } finally { setBusy(false); } }
  return <div className="modal-backdrop"><div className="modal wide"><h2>{t("categorySettings")}</h2><p className="modal-description">{locale === "ja" ? "会社共通の集計用分類です。日報全体の主な業務を1つ選ぶために使い、日々の細かな作業は「今日の業務メモ」の個人タグで整理します。" : "这是公司统一的汇总分类，用于选择日报的主要工作。日常的具体工作请使用“今日工作记录”的个人标签整理。"}</p><div className="category-list">{categories.map((item) => <div key={item.id}><span>{item.labelJa}</span><small>{item.labelZh}</small></div>)}</div><form onSubmit={submit} className="inline-category"><input value={ja} onChange={(e) => setJa(e.target.value)} placeholder="日本語" required /><input value={zh} onChange={(e) => setZh(e.target.value)} placeholder="中文" required /><button className="button secondary" disabled={busy}><Plus size={17} />追加</button></form><div className="modal-actions"><button className="button primary" onClick={onClose}>{t("back")}</button></div></div></div>;
}

function ReportReviewModal({ report, isManager, onClose, onReviewed }: { report: DailyReport; isManager: boolean; onClose: () => void; onReviewed: () => void }) {
  const { locale, t } = useI18n();
  const [workLogs, setWorkLogs] = useState<WorkLogEntry[]>([]);
  const japanese = report.translatedFields;
  useEffect(() => watchWorkLogs(report.userId, report.reportDate, setWorkLogs), [report.reportDate, report.userId]);
  return <div className="modal-backdrop"><div className="modal wide report-review-modal"><div className="report-review-heading"><div><span className="eyebrow">{locale === "ja" ? "提出済み日報" : "已提交日报"}</span><h2>{report.userName}</h2><p>{report.reportDate} · {report.category}</p></div><span className={`status-chip ${report.reviewStatus === "needs_review" ? "amber" : "blue"}`}>{report.reviewStatus === "needs_review" ? (locale === "ja" ? "修正後・再確認" : "修改后需复核") : (locale === "ja" ? "未確認" : "未确认")}</span></div>{(report.area || report.destinations) && <section className="report-review-meta">{report.area && <div><small>{t("area")}</small><p>{report.area}</p></div>}{report.destinations && <div><small>{t("destinations")}</small><p>{report.destinations}</p></div>}</section>}<section><small>{t("activities")}</small><p>{report.activities}</p></section>{report.findings && <section><small>{t("findings")}</small><p>{report.findings}</p></section>}{report.nextPlan && <section><small>{t("nextPlan")}</small><p>{report.nextPlan}</p></section>}{workLogs.length > 0 && <section className="report-review-work-logs"><small>{locale === "ja" ? "元の業務報告・添付資料" : "原始工作报告及附件"}</small><div>{workLogs.map((item) => <article key={item.id}><span className="tag soft">{item.tagLabel}</span><p>{item.text}</p>{Boolean(item.attachments?.length) && <div className="work-log-saved-attachments">{item.attachments?.map((attachment) => <a key={attachment.id} href={attachment.linkUrl || attachment.downloadUrl} target="_blank" rel="noreferrer">{attachment.linkUrl ? <Link2 size={14} /> : <Paperclip size={14} />}{attachment.name}</a>)}</div>}</article>)}</div></section>}{japanese && report.sourceLanguage === "zh-CN" && <section className="translation-box"><small>{t("translated")}</small><p>{japanese.activities}</p>{japanese.findings && <p>{japanese.findings}</p>}{japanese.nextPlan && <p>{japanese.nextPlan}</p>}</section>}<div className="modal-actions"><button className="button ghost" onClick={onClose}>{t("back")}</button>{isManager && <button className="button primary" onClick={onReviewed}><Check size={17} />{t("markReviewed")}</button>}</div></div></div>;
}

function downloadText(name: string, content: string, type: string) { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }

function formatBytes(bytes: number): string { if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`; return `${(bytes / 1024 / 1024).toFixed(1)}MB`; }

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> { return items.reduce<Record<string, number>>((result, item) => { const value = key(item) || "—"; result[value] = (result[value] || 0) + 1; return result; }, {}); }

function adminProductStatus(value: ProductStatus, locale: string): string { const ja = { new: "新規候補", considering: "検討中", on_hold: "保留", closed: "終了" }; const zh = { new: "新候选", considering: "评估中", on_hold: "暂缓", closed: "结束" }; return (locale === "ja" ? ja : zh)[value]; }
