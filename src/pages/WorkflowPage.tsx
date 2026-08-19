import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { todayJst } from "../lib/format";
import {
  exportMonth,
  generateWeeklyReport,
  saveDutyDefinition,
  saveEmploymentBasis,
  saveEvidenceReference,
  saveMonthlyPackage,
  saveNonWorkingReason,
  saveRenewalChecklist,
  saveSourceDocumentReference,
  saveWeeklyMeeting,
  saveWeeklyPlan,
  saveWeeklyReport
} from "../services/api";
import type {
  AttendanceRecord,
  DailyReport,
  DutyDefinition,
  EmploymentBasis,
  EvidenceCategory,
  EvidenceReference,
  MeetingActionItem,
  MonthlyEvidencePackage,
  NonWorkingReason,
  NonWorkingReasonType,
  RenewalChecklist,
  RenewalChecklistItem,
  SourceDocumentReference,
  UserProfile,
  WeeklyMeetingRecord,
  WeeklyPlan,
  WeeklyReport,
  WeeklyReportPriority,
  WeeklyReportSections,
  WeeklyReportTheme
} from "../types";

type Notice = (type: "success" | "error", message: string) => void;
type Tab = "weekly" | "absence" | "evidence" | "basis" | "monthly" | "renewal";

interface Props {
  users: UserProfile[];
  attendance: AttendanceRecord[];
  reports: DailyReport[];
  dutyDefinitions: DutyDefinition[];
  employmentBases: EmploymentBasis[];
  sourceDocuments: SourceDocumentReference[];
  weeklyPlans: WeeklyPlan[];
  weeklyReports: WeeklyReport[];
  weeklyMeetings: WeeklyMeetingRecord[];
  nonWorkingReasons: NonWorkingReason[];
  evidenceReferences: EvidenceReference[];
  monthlyPackages: MonthlyEvidencePackage[];
  renewalChecklists: RenewalChecklist[];
  notify: Notice;
}

const blankSections: WeeklyReportSections = {
  executiveSummary: "", keyOutcomes: "", blockers: "", decisionsNeeded: "",
  themes: [], nextPriorities: [],
  previousGoals: "", completedWork: "", productResults: "", chinaMarketInsights: "",
  planActualGap: "", continuingIssues: "", nextWeekPlan: "", pendingItems: ""
};

function normalizedSections(report?: WeeklyReport): WeeklyReportSections {
  if (!report) return { ...blankSections, themes: [], nextPriorities: [] };
  return {
    executiveSummary: report.executiveSummary || "",
    keyOutcomes: report.keyOutcomes || "",
    blockers: report.blockers || "",
    decisionsNeeded: report.decisionsNeeded || "",
    themes: report.themes || [],
    nextPriorities: report.nextPriorities || [],
    previousGoals: report.previousGoals || "",
    completedWork: report.completedWork || "",
    productResults: report.productResults || "",
    chinaMarketInsights: report.chinaMarketInsights || "",
    planActualGap: report.planActualGap || "",
    continuingIssues: report.continuingIssues || "",
    nextWeekPlan: report.nextWeekPlan || "",
    pendingItems: report.pendingItems || ""
  };
}

function blankTheme(): WeeklyReportTheme {
  return { title: "", objective: "", activities: "", outcomes: "", evidence: "", chinaMarketInsight: "", issues: "", nextAction: "", sourceReferences: [] };
}

function blankPriority(): WeeklyReportPriority {
  return { title: "", basis: "proposal", owner: "", dueDate: "", definitionOfDone: "" };
}

function formatElapsed(minutes = 0) {
  return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

function addDays(date: string, count: number) {
  const value = new Date(`${date}T12:00:00+09:00`);
  value.setDate(value.getDate() + count);
  return todayJst(value);
}

function mondayOf(date = todayJst()) {
  const value = new Date(`${date}T12:00:00+09:00`);
  const offset = (value.getDay() + 6) % 7;
  return addDays(date, -offset);
}

function previousMonday() { return addDays(mondayOf(), -7); }

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={{ display: "grid", gap: 6 }}><strong>{label}</strong>{children}</label>;
}

const inputStyle = { width: "100%", boxSizing: "border-box" as const, padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 10, font: "inherit", background: "white" };
const gridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 };
const panelStyle = { background: "white", border: "1px solid #dbe3f0", borderRadius: 16, padding: 18, display: "grid", gap: 16 };
const buttonStyle = { border: 0, borderRadius: 10, padding: "11px 16px", font: "inherit", fontWeight: 700, cursor: "pointer", background: "#2563eb", color: "white" };
const quietButtonStyle = { ...buttonStyle, background: "#e8eef8", color: "#183153" };

const ja = {
  weekly: "週次計画・レポート", absence: "非勤務理由", evidence: "関連資料", basis: "雇用・職務基準", monthly: "月次資料", renewal: "在留更新準備"
};
const zh = {
  weekly: "周计划和周报", absence: "未出勤原因", evidence: "相关资料", basis: "雇佣与职责标准", monthly: "月度资料", renewal: "在留更新准备"
};

export function WorkflowPage(props: Props) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const [tab, setTab] = useState<Tab>("weekly");
  const manager = profile?.role === "employee_manager";
  const viewer = profile?.role === "president_viewer";
  const labels = locale === "zh-CN" ? zh : ja;
  if (!profile) return null;

  const tabs: Tab[] = manager ? ["weekly", "absence", "evidence", "basis", "monthly", "renewal"] : viewer ? ["weekly", "evidence", "basis", "monthly"] : ["weekly", "absence", "evidence", "basis", "monthly"];

  return <main style={{ display: "grid", gap: 18, paddingBottom: 110 }}>
    <header>
      <p style={{ color: "#2563eb", fontWeight: 800, letterSpacing: 2, marginBottom: 4 }}>WORK CYCLE</p>
      <h1 style={{ margin: 0 }}>{locale === "zh-CN" ? "业务计划与资料" : "業務サイクル・資料"}</h1>
      <p style={{ color: "#64748b" }}>{locale === "zh-CN" ? "把计划、日常记录、周报和月度资料连接起来。" : "計画、日々の記録、週報、月次資料を一つの流れで残します。"}</p>
    </header>
    <nav style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {tabs.map((item) => <button key={item} style={tab === item ? buttonStyle : quietButtonStyle} onClick={() => setTab(item)}>{labels[item]}</button>)}
    </nav>
    {tab === "weekly" && <WeeklySection {...props} />}
    {tab === "absence" && <AbsenceSection {...props} />}
    {tab === "evidence" && <EvidenceSection {...props} />}
    {tab === "basis" && <BasisSection {...props} />}
    {tab === "monthly" && <MonthlySection {...props} />}
    {tab === "renewal" && manager && <RenewalSection {...props} />}
  </main>;
}

function UserWeekPicker({ users, userId, setUserId, weekStart, setWeekStart, locked }: { users: UserProfile[]; userId: string; setUserId: (v: string) => void; weekStart: string; setWeekStart: (v: string) => void; locked: boolean }) {
  return <div style={gridStyle}>
    <Field label="対象者"><select style={inputStyle} value={userId} disabled={locked} onChange={(e) => setUserId(e.target.value)}>{users.map((user) => <option key={user.uid} value={user.uid}>{user.displayName}</option>)}</select></Field>
    <Field label="週の開始日（月曜日）"><input style={inputStyle} type="date" value={weekStart} onChange={(e) => setWeekStart(mondayOf(e.target.value))} /></Field>
  </div>;
}

function WeeklySection(props: Props) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const manager = profile?.role === "employee_manager";
  const viewer = profile?.role === "president_viewer";
  const [userId, setUserId] = useState(profile?.uid || "");
  const [weekStart, setWeekStart] = useState(previousMonday());
  const plan = props.weeklyPlans.find((row) => row.userId === userId && row.weekStart === weekStart);
  const report = props.weeklyReports.find((row) => row.userId === userId && row.weekStart === weekStart);
  const meeting = report ? props.weeklyMeetings.find((row) => row.weeklyReportId === report.id) : undefined;
  const [planForm, setPlanForm] = useState({ goals: "", productFields: "", visitPlans: "", deliverables: "", consultations: "" });
  const [sections, setSections] = useState<WeeklyReportSections>(blankSections);
  const [meetingForm, setMeetingForm] = useState({ heldAt: "", attendees: "", feedback: "", chinaMarketInformation: "", decisions: "", currentWeekGoals: "", nextCheckItems: "", employeeComment: "" });
  const [actionItems, setActionItems] = useState<MeetingActionItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => setPlanForm(plan ? { goals: plan.goals, productFields: plan.productFields, visitPlans: plan.visitPlans, deliverables: plan.deliverables, consultations: plan.consultations } : { goals: "", productFields: "", visitPlans: "", deliverables: "", consultations: "" }), [plan]);
  useEffect(() => setSections(normalizedSections(report)), [report]);
  useEffect(() => setMeetingForm(meeting ? { heldAt: meeting.heldAt, attendees: meeting.attendees, feedback: meeting.feedback, chinaMarketInformation: meeting.chinaMarketInformation, decisions: meeting.decisions, currentWeekGoals: meeting.currentWeekGoals, nextCheckItems: meeting.nextCheckItems, employeeComment: meeting.employeeComment } : { heldAt: "", attendees: "", feedback: "", chinaMarketInformation: "", decisions: "", currentWeekGoals: "", nextCheckItems: "", employeeComment: "" }), [meeting]);
  useEffect(() => setActionItems(meeting?.actionItems || []), [meeting]);

  async function act(task: () => Promise<unknown>, message: string) {
    setBusy(true); try { await task(); props.notify("success", message); } catch (error) { props.notify("error", error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }

  async function savePlan(status: WeeklyPlan["status"]) {
    await act(() => saveWeeklyPlan({ userId, weekStart, status, ...planForm, sourceLanguage: locale }), "週次計画を保存しました");
  }

  async function saveReport(status: WeeklyReport["status"]) {
    if (!report) return;
    await act(() => saveWeeklyReport({ reportId: report.id, sections, status, reason: report.revision ? "週次レポートを更新" : undefined }), status === "finalized" ? "週次レポートを確定しました" : "週次レポートを保存しました");
  }

  async function saveMeeting(status: "draft" | "finalized") {
    if (!report) return;
    await act(() => saveWeeklyMeeting({ weeklyReportId: report.id, userId, weekStart, ...meetingForm, actionItems, status }), "会議記録を保存しました");
  }

  function printReport() {
    const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>(".weekly-print-area textarea"));
    const previousHeights = textareas.map((textarea) => textarea.style.height);
    textareas.forEach((textarea) => {
      textarea.style.height = `${textarea.scrollHeight}px`;
    });
    document.body.classList.add("weekly-report-printing");
    const cleanup = () => {
      document.body.classList.remove("weekly-report-printing");
      textareas.forEach((textarea, index) => {
        textarea.style.height = previousHeights[index];
      });
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    window.setTimeout(cleanup, 1500);
  }

  const sectionLabels: Array<[keyof WeeklyReportSections, string]> = [
    ["previousGoals", "1. 前週の目標"], ["completedWork", "2. 実施した業務"], ["productResults", "3. 商品発掘・市場調査の成果"],
    ["chinaMarketInsights", "4. 中国市場に関する意見・気づき"], ["planActualGap", "5. 計画と実績の差"], ["continuingIssues", "6. 継続課題"],
    ["nextWeekPlan", "7. 今週の予定・目標"], ["pendingItems", "8. 勤怠・日報の未処理事項"]
  ];

  return <section style={{ display: "grid", gap: 18 }}>
    <div style={panelStyle}>
      <h2 style={{ margin: 0 }}>対象期間</h2>
      <UserWeekPicker users={props.users} userId={userId} setUserId={setUserId} weekStart={weekStart} setWeekStart={setWeekStart} locked={!manager && !viewer} />
      <small>{weekStart} 〜 {addDays(weekStart, 6)}</small>
    </div>
    <div style={panelStyle}>
      <h2 style={{ margin: 0 }}>今週の計画</h2>
      {[ ["goals", "今週の目標"], ["productFields", "調査予定の商品・分野"], ["visitPlans", "訪問・出張・オンライン商談予定"], ["deliverables", "作成予定の資料・成果物"], ["consultations", "管理担当者に相談したいこと"] ].map(([key, label]) => <Field key={key} label={label}><textarea style={inputStyle} rows={2} value={planForm[key as keyof typeof planForm]} disabled={viewer} onChange={(e) => setPlanForm({ ...planForm, [key]: e.target.value })} /></Field>)}
      {!viewer && <div style={{ display: "flex", gap: 8 }}><button disabled={busy} style={quietButtonStyle} onClick={() => savePlan("draft")}>下書き保存</button>{manager && <button disabled={busy} style={buttonStyle} onClick={() => savePlan("confirmed")}>計画を確定</button>}</div>}
    </div>
    <div style={panelStyle} className="weekly-report-panel">
      <div className="weekly-no-print" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>前週のレポート・定例会レジュメ</h2>
        {report && <button type="button" style={quietButtonStyle} onClick={printReport}>印刷・PDF保存</button>}
      </div>
      {report?.hasUnreviewedReports && <p className="weekly-no-print" style={{ color: "#b45309", fontWeight: 700 }}>管理者未確認の日報が {report.unreviewedReportCount} 件あります。確定前に確認してください。</p>}
      {!report && <p style={{ color: "#64748b" }}>この週のレポートはまだ作成されていません。</p>}
      {manager && <button className="weekly-no-print" disabled={busy} style={buttonStyle} onClick={() => act(() => generateWeeklyReport(userId, weekStart), "週次レポートの下書きを作成しました")}>AIで週次レポートを作成</button>}
      {report && <div className="weekly-print-area">
        <header className="weekly-report-heading">
          <div><small>WEEKLY BUSINESS REVIEW</small><h2>週次業務レポート</h2><p>{weekStart} 〜 {addDays(weekStart, 6)}</p></div>
          <div><strong>{props.users.find((user) => user.uid === userId)?.displayName || "対象者"}</strong><span>{report.status === "finalized" ? "確定版" : "下書き"}</span>{report.isDemo && <span className="demo-badge compact">DEMO</span>}</div>
        </header>

        {report.metrics && <section className="weekly-metrics">
          <article><strong>{report.metrics.attendanceDays}</strong><span>勤務日</span></article>
          <article><strong>{formatElapsed(report.metrics.totalElapsedMinutes)}</strong><span>休憩未控除</span></article>
          <article><strong>{report.metrics.reviewedReportCount}/{report.metrics.submittedReportCount}</strong><span>確認済み日報</span></article>
          <article><strong>{report.metrics.workLogCount}</strong><span>業務メモ</span></article>
          <article><strong>{report.metrics.productObservationCount}</strong><span>商品発見</span></article>
          <article><strong>{report.metrics.holidayWorkDays}</strong><span>休日勤務</span></article>
        </section>}

        <section className="weekly-summary-block">
          <Field label="総括（エグゼクティブ・サマリー）"><textarea style={inputStyle} rows={5} value={sections.executiveSummary} disabled={!manager} onChange={(e) => setSections({ ...sections, executiveSummary: e.target.value })} /></Field>
        </section>
        <section className="weekly-three-columns">
          <Field label="主な成果・前進"><textarea style={inputStyle} rows={5} value={sections.keyOutcomes} disabled={!manager} onChange={(e) => setSections({ ...sections, keyOutcomes: e.target.value })} /></Field>
          <Field label="課題・リスク"><textarea style={inputStyle} rows={5} value={sections.blockers} disabled={!manager} onChange={(e) => setSections({ ...sections, blockers: e.target.value })} /></Field>
          <Field label="会議で決めたいこと"><textarea style={inputStyle} rows={5} value={sections.decisionsNeeded} disabled={!manager} onChange={(e) => setSections({ ...sections, decisionsNeeded: e.target.value })} /></Field>
        </section>

        <section className="weekly-themes">
          <div className="weekly-section-title"><div><small>THEMES / PROJECTS</small><h3>テーマ・案件別の振り返り</h3></div>{manager && <button className="weekly-no-print" type="button" style={quietButtonStyle} onClick={() => setSections({ ...sections, themes: [...sections.themes, blankTheme()] })}>テーマを追加</button>}</div>
          {sections.themes.length === 0 && <p className="weekly-empty">テーマ別の記録はありません。</p>}
          {sections.themes.map((theme, index) => <article className="weekly-theme-card" key={`theme-${index}`}>
            <div className="weekly-theme-number">{String(index + 1).padStart(2, "0")}</div>
            <div className="weekly-theme-content">
              <Field label="テーマ／案件名"><input style={inputStyle} value={theme.title} disabled={!manager} onChange={(e) => setSections({ ...sections, themes: sections.themes.map((row, i) => i === index ? { ...row, title: e.target.value } : row) })} /></Field>
              <div style={gridStyle}>
                <Field label="目的"><textarea style={inputStyle} rows={2} value={theme.objective} disabled={!manager} onChange={(e) => setSections({ ...sections, themes: sections.themes.map((row, i) => i === index ? { ...row, objective: e.target.value } : row) })} /></Field>
                <Field label="実施内容"><textarea style={inputStyle} rows={2} value={theme.activities} disabled={!manager} onChange={(e) => setSections({ ...sections, themes: sections.themes.map((row, i) => i === index ? { ...row, activities: e.target.value } : row) })} /></Field>
                <Field label="成果・進捗"><textarea style={inputStyle} rows={2} value={theme.outcomes} disabled={!manager} onChange={(e) => setSections({ ...sections, themes: sections.themes.map((row, i) => i === index ? { ...row, outcomes: e.target.value } : row) })} /></Field>
                <Field label="根拠・成果物"><textarea style={inputStyle} rows={2} value={theme.evidence} disabled={!manager} onChange={(e) => setSections({ ...sections, themes: sections.themes.map((row, i) => i === index ? { ...row, evidence: e.target.value } : row) })} /></Field>
                <Field label="中国市場の視点"><textarea style={inputStyle} rows={2} value={theme.chinaMarketInsight} disabled={!manager} onChange={(e) => setSections({ ...sections, themes: sections.themes.map((row, i) => i === index ? { ...row, chinaMarketInsight: e.target.value } : row) })} /></Field>
                <Field label="課題・未解決事項"><textarea style={inputStyle} rows={2} value={theme.issues} disabled={!manager} onChange={(e) => setSections({ ...sections, themes: sections.themes.map((row, i) => i === index ? { ...row, issues: e.target.value } : row) })} /></Field>
              </div>
              <Field label="次の一手"><textarea style={inputStyle} rows={2} value={theme.nextAction} disabled={!manager} onChange={(e) => setSections({ ...sections, themes: sections.themes.map((row, i) => i === index ? { ...row, nextAction: e.target.value } : row) })} /></Field>
              <Field label="参照した記録（日付・日報・商品候補など）"><textarea style={inputStyle} rows={2} value={theme.sourceReferences.join("\n")} disabled={!manager} onChange={(e) => setSections({ ...sections, themes: sections.themes.map((row, i) => i === index ? { ...row, sourceReferences: e.target.value.split("\n").map((value) => value.trim()).filter(Boolean) } : row) })} /></Field>
              {manager && <button className="weekly-no-print" type="button" style={quietButtonStyle} onClick={() => setSections({ ...sections, themes: sections.themes.filter((_, i) => i !== index) })}>このテーマを削除</button>}
            </div>
          </article>)}
        </section>

        <section className="weekly-priorities">
          <div className="weekly-section-title"><div><small>NEXT PRIORITIES</small><h3>今週の重点行動</h3></div>{manager && <button className="weekly-no-print" type="button" style={quietButtonStyle} onClick={() => setSections({ ...sections, nextPriorities: [...sections.nextPriorities, blankPriority()] })}>重点行動を追加</button>}</div>
          {sections.nextPriorities.length === 0 && <p className="weekly-empty">重点行動はまだ登録されていません。</p>}
          {sections.nextPriorities.map((priority, index) => <article className="weekly-priority-card" key={`priority-${index}`}>
            <span>{index + 1}</span>
            <div className="weekly-priority-fields">
              <Field label="行動"><input style={inputStyle} value={priority.title} disabled={!manager} onChange={(e) => setSections({ ...sections, nextPriorities: sections.nextPriorities.map((row, i) => i === index ? { ...row, title: e.target.value } : row) })} /></Field>
              <div style={gridStyle}>
                <Field label="位置づけ"><select style={inputStyle} value={priority.basis} disabled={!manager} onChange={(e) => setSections({ ...sections, nextPriorities: sections.nextPriorities.map((row, i) => i === index ? { ...row, basis: e.target.value as WeeklyReportPriority["basis"] } : row) })}><option value="confirmed">計画・会議で確認済み</option><option value="proposal">AI／管理者からの提案</option></select></Field>
                <Field label="担当"><input style={inputStyle} value={priority.owner} disabled={!manager} onChange={(e) => setSections({ ...sections, nextPriorities: sections.nextPriorities.map((row, i) => i === index ? { ...row, owner: e.target.value } : row) })} /></Field>
                <Field label="期限"><input style={inputStyle} type="date" value={priority.dueDate} disabled={!manager} onChange={(e) => setSections({ ...sections, nextPriorities: sections.nextPriorities.map((row, i) => i === index ? { ...row, dueDate: e.target.value } : row) })} /></Field>
              </div>
              <Field label="完了条件"><textarea style={inputStyle} rows={2} value={priority.definitionOfDone} disabled={!manager} onChange={(e) => setSections({ ...sections, nextPriorities: sections.nextPriorities.map((row, i) => i === index ? { ...row, definitionOfDone: e.target.value } : row) })} /></Field>
              {manager && <button className="weekly-no-print" type="button" style={quietButtonStyle} onClick={() => setSections({ ...sections, nextPriorities: sections.nextPriorities.filter((_, i) => i !== index) })}>この行動を削除</button>}
            </div>
          </article>)}
        </section>

        <details className="weekly-legacy weekly-no-print">
          <summary>従来形式の8項目（過去資料との互換用）</summary>
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>{sectionLabels.map(([key, label]) => <Field key={key} label={label}><textarea style={inputStyle} rows={3} value={sections[key] as string} disabled={!manager} onChange={(e) => setSections({ ...sections, [key]: e.target.value })} /></Field>)}</div>
        </details>
      </div>}
      {report && manager && <div className="weekly-no-print" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button disabled={busy} style={quietButtonStyle} onClick={() => saveReport("manager_editing")}>編集内容を保存</button><button disabled={busy || report.hasUnreviewedReports} style={buttonStyle} onClick={() => saveReport("finalized")}>最終確定</button></div>}
    </div>
    {report && <div style={panelStyle}>
      <h2 style={{ margin: 0 }}>月曜定例会</h2>
      {manager && <div style={gridStyle}><Field label="開催日時"><input style={inputStyle} type="datetime-local" value={meetingForm.heldAt} onChange={(e) => setMeetingForm({ ...meetingForm, heldAt: e.target.value })} /></Field><Field label="出席者"><input style={inputStyle} value={meetingForm.attendees} onChange={(e) => setMeetingForm({ ...meetingForm, attendees: e.target.value })} /></Field></div>}
      {([ ["feedback", "前週へのフィードバック"], ["chinaMarketInformation", "中国市場の情報"], ["decisions", "決定事項"], ["currentWeekGoals", "今週の目標"], ["nextCheckItems", "次回確認事項"] ] as const).map(([key, label]) => <Field key={key} label={label}><textarea style={inputStyle} rows={2} disabled={!manager} value={meetingForm[key]} onChange={(e) => setMeetingForm({ ...meetingForm, [key]: e.target.value })} /></Field>)}
      {!viewer && <Field label="方さん・従業員からの意見／計画"><textarea style={inputStyle} rows={2} value={meetingForm.employeeComment} onChange={(e) => setMeetingForm({ ...meetingForm, employeeComment: e.target.value })} /></Field>}
      <div style={{ display: "grid", gap: 10 }}>
        <strong>担当事項</strong>
        {actionItems.length === 0 && <p style={{ color: "#64748b", margin: 0 }}>担当事項はありません。</p>}
        {actionItems.map((item, index) => <div key={item.id} style={{ ...gridStyle, alignItems: "end", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
          <Field label="内容"><input style={inputStyle} disabled={!manager} value={item.text} onChange={(e) => setActionItems(actionItems.map((row, i) => i === index ? { ...row, text: e.target.value } : row))} /></Field>
          <Field label="担当者"><input style={inputStyle} disabled={!manager} value={item.owner} onChange={(e) => setActionItems(actionItems.map((row, i) => i === index ? { ...row, owner: e.target.value } : row))} /></Field>
          <Field label="期限"><input style={inputStyle} disabled={!manager} type="date" value={item.dueDate} onChange={(e) => setActionItems(actionItems.map((row, i) => i === index ? { ...row, dueDate: e.target.value } : row))} /></Field>
          <label style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 10 }}><input type="checkbox" disabled={!manager} checked={item.completed} onChange={(e) => setActionItems(actionItems.map((row, i) => i === index ? { ...row, completed: e.target.checked } : row))} /> 完了</label>
          {manager && <button type="button" style={quietButtonStyle} onClick={() => setActionItems(actionItems.filter((_, i) => i !== index))}>削除</button>}
        </div>)}
        {manager && <button type="button" style={quietButtonStyle} onClick={() => setActionItems([...actionItems, { id: newId("action"), text: "", owner: "", dueDate: "", completed: false }])}>担当事項を追加</button>}
      </div>
      {manager ? <div style={{ display: "flex", gap: 8 }}><button disabled={busy} style={quietButtonStyle} onClick={() => saveMeeting("draft")}>下書き保存</button><button disabled={busy} style={buttonStyle} onClick={() => saveMeeting("finalized")}>会議記録を確定</button></div> : !viewer && <button disabled={busy} style={buttonStyle} onClick={() => saveMeeting(meeting?.status || "draft")}>自分の意見を保存</button>}
    </div>}
  </section>;
}

function AbsenceSection(props: Props) {
  const { profile } = useAuth();
  const [userId, setUserId] = useState(profile?.uid || "");
  const [workDate, setWorkDate] = useState(todayJst());
  const [reasonType, setReasonType] = useState<NonWorkingReasonType>("paid_leave");
  const [note, setNote] = useState("");
  const manager = profile?.role === "employee_manager";
  const names: Record<NonWorkingReasonType, string> = { paid_leave: "有給休暇", absence: "欠勤", illness: "病気・体調不良", special_leave: "特別休暇", company_closure: "会社指示による休業", other: "その他" };
  async function save() { try { await saveNonWorkingReason({ userId, workDate, reasonType, note }); props.notify("success", "非勤務理由を保存しました"); } catch (error) { props.notify("error", error instanceof Error ? error.message : String(error)); } }
  const rows = props.nonWorkingReasons.filter((row) => row.userId === userId).sort((a, b) => b.workDate.localeCompare(a.workDate));
  return <section style={{ display: "grid", gap: 18 }}><div style={panelStyle}><h2 style={{ margin: 0 }}>予定勤務日に打刻がない理由</h2><p>給与・休暇残数を計算する機能ではなく、勤務記録がない日を説明するための補助記録です。</p><div style={gridStyle}><Field label="対象者"><select style={inputStyle} value={userId} disabled={!manager} onChange={(e) => setUserId(e.target.value)}>{props.users.map((u) => <option value={u.uid} key={u.uid}>{u.displayName}</option>)}</select></Field><Field label="日付"><input style={inputStyle} type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></Field><Field label="理由"><select style={inputStyle} value={reasonType} onChange={(e) => setReasonType(e.target.value as NonWorkingReasonType)}>{Object.entries(names).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field></div><Field label="補足"><textarea style={inputStyle} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field><button style={buttonStyle} onClick={save}>保存</button></div><div style={panelStyle}><h2 style={{ margin: 0 }}>登録済み</h2>{rows.length ? rows.map((row) => <div key={row.id} style={{ borderBottom: "1px solid #e2e8f0", padding: "8px 0" }}><strong>{row.workDate}　{names[row.reasonType]}</strong><div>{row.note}</div></div>) : <p>登録はありません。</p>}</div></section>;
}

function EvidenceSection(props: Props) {
  const { profile } = useAuth();
  const manager = profile?.role === "employee_manager";
  const [form, setForm] = useState({ subjectUserId: profile?.uid || "", title: "", category: "product_research" as EvidenceCategory, documentDate: todayJst(), parties: "", driveUrl: "", description: "", visibility: "work" as "work" | "employment_confidential" });
  const categories: Record<EvidenceCategory, string> = { estimate: "見積書", product_research: "商品調査資料", maker_material: "メーカー資料", meeting_record: "商談記録", contract: "契約書", client_email: "取引先メール", internal_message: "社内連絡", minutes: "会議議事録", other: "その他" };
  async function save() { try { await saveEvidenceReference({ ...form, relatedReportIds: [], relatedWeeklyReportIds: [], relatedProductIds: [] }); props.notify("success", "関連資料を登録しました"); setForm({ ...form, title: "", driveUrl: "", description: "" }); } catch (error) { props.notify("error", error instanceof Error ? error.message : String(error)); } }
  return <section style={{ display: "grid", gap: 18 }}>
    {manager && <div style={panelStyle}><h2 style={{ margin: 0 }}>Google Drive等の資料を索引登録</h2><div style={gridStyle}><Field label="対象者"><select style={inputStyle} value={form.subjectUserId} onChange={(e) => setForm({ ...form, subjectUserId: e.target.value })}>{props.users.map((u) => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}</select></Field><Field label="資料名"><input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field><Field label="資料種別"><select style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as EvidenceCategory })}>{Object.entries(categories).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field><Field label="作成日・受領日"><input style={inputStyle} type="date" value={form.documentDate} onChange={(e) => setForm({ ...form, documentDate: e.target.value })} /></Field><Field label="関係者・会社名"><input style={inputStyle} value={form.parties} onChange={(e) => setForm({ ...form, parties: e.target.value })} /></Field><Field label="Drive URL"><input style={inputStyle} type="url" value={form.driveUrl} onChange={(e) => setForm({ ...form, driveUrl: e.target.value })} /></Field><Field label="公開範囲"><select style={inputStyle} value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as "work" | "employment_confidential" })}><option value="work">通常業務</option><option value="employment_confidential">雇用・在留関係（管理者・社長のみ）</option></select></Field></div><Field label="説明"><textarea style={inputStyle} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field><button style={buttonStyle} onClick={save}>登録</button></div>}
    <div style={panelStyle}><h2 style={{ margin: 0 }}>関連資料一覧</h2>{props.evidenceReferences.length ? props.evidenceReferences.map((row) => <article key={row.id} style={{ borderBottom: "1px solid #e2e8f0", padding: "9px 0" }}><strong>{row.title}</strong> <small>{categories[row.category]}・{row.documentDate}</small><p>{row.description}</p><a href={row.driveUrl} target="_blank" rel="noreferrer">資料を開く</a></article>) : <p>登録はありません。</p>}</div>
  </section>;
}

function BasisSection(props: Props) {
  const { profile } = useAuth();
  const manager = profile?.role === "employee_manager";
  const [duty, setDuty] = useState({ code: "", labelJa: "", labelZh: "", descriptionJa: "", descriptionZh: "" });
  const [doc, setDoc] = useState({ title: "", driveUrl: "", documentDate: "", confirmedDate: "", purpose: "" });
  const [userId, setUserId] = useState(props.users.find((u) => u.role === "employee")?.uid || profile?.uid || "");
  const basis = props.employmentBases.find((row) => row.userId === userId);
  const [basisForm, setBasisForm] = useState({ employmentStartDate: "", assignedDutyIds: [] as string[], descriptionJa: "", descriptionZh: "" });
  useEffect(() => setBasisForm(basis ? { employmentStartDate: basis.employmentStartDate, assignedDutyIds: basis.assignedDutyIds, descriptionJa: basis.descriptionJa, descriptionZh: basis.descriptionZh } : { employmentStartDate: "", assignedDutyIds: [], descriptionJa: "", descriptionZh: "" }), [basis]);
  async function run(task: Promise<unknown>, message: string) { try { await task; props.notify("success", message); } catch (error) { props.notify("error", error instanceof Error ? error.message : String(error)); } }
  return <section style={{ display: "grid", gap: 18 }}>
    <div style={panelStyle}><h2 style={{ margin: 0 }}>担当業務（職務区分）</h2>{props.dutyDefinitions.map((row) => <div key={row.id} style={{ padding: 8, borderBottom: "1px solid #e2e8f0" }}><strong>{row.labelJa}</strong>{row.labelZh && <span> / {row.labelZh}</span>}<div>{row.descriptionJa}</div></div>)}{manager && <><div style={gridStyle}><Field label="コード"><input style={inputStyle} value={duty.code} onChange={(e) => setDuty({ ...duty, code: e.target.value })} /></Field><Field label="名称（日本語）"><input style={inputStyle} value={duty.labelJa} onChange={(e) => setDuty({ ...duty, labelJa: e.target.value })} /></Field><Field label="名称（中国語）"><input style={inputStyle} value={duty.labelZh} onChange={(e) => setDuty({ ...duty, labelZh: e.target.value })} /></Field></div><Field label="説明（日本語）"><textarea style={inputStyle} value={duty.descriptionJa} onChange={(e) => setDuty({ ...duty, descriptionJa: e.target.value })} /></Field><Field label="説明（中国語）"><textarea style={inputStyle} value={duty.descriptionZh} onChange={(e) => setDuty({ ...duty, descriptionZh: e.target.value })} /></Field><button style={buttonStyle} onClick={() => run(saveDutyDefinition({ ...duty, active: true, order: props.dutyDefinitions.length }), "職務区分を保存しました")}>職務区分を追加</button></>}</div>
    {manager && <div style={panelStyle}><h2 style={{ margin: 0 }}>基準文書（原本はGoogle Drive）</h2><div style={gridStyle}>{([ ["title", "文書名"], ["driveUrl", "Drive URL"], ["documentDate", "作成日"], ["confirmedDate", "確認日"], ["purpose", "用途"] ] as const).map(([key, label]) => <Field key={key} label={label}><input style={inputStyle} type={key.includes("Date") ? "date" : key === "driveUrl" ? "url" : "text"} value={doc[key]} onChange={(e) => setDoc({ ...doc, [key]: e.target.value })} /></Field>)}</div><button style={buttonStyle} onClick={() => run(saveSourceDocumentReference({ ...doc, confidential: true }), "基準文書を登録しました")}>文書を登録</button>{props.sourceDocuments.map((row) => <div key={row.id}><a href={row.driveUrl} target="_blank" rel="noreferrer">{row.title}</a> <small>{row.confirmedDate}</small></div>)}</div>}
  </section>;
}

function download(name: string, body: string, type: string) { const url = URL.createObjectURL(new Blob([body], { type })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }

function MonthlySection(props: Props) {
  const { profile } = useAuth();
  const manager = profile?.role === "employee_manager";
  const [userId, setUserId] = useState(profile?.uid || "");
  const [month, setMonth] = useState(todayJst().slice(0, 7));
  const [driveUrl, setDriveUrl] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() { setBusy(true); try { const data = await exportMonth(month, userId); download(`gyoumulog-${month}.json`, data.json, "application/json"); download(`gyoumulog-${month}.csv`, data.csv, "text/csv;charset=utf-8"); download(`gyoumulog-${month}-attachments.csv`, data.manifest, "text/csv;charset=utf-8"); if (data.html) download(`gyoumulog-${month}.html`, data.html, "text/html;charset=utf-8"); props.notify("success", "月次資料を出力しました。HTMLはブラウザからPDF保存できます。"); } catch (error) { props.notify("error", error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  const packageRow = props.monthlyPackages.find((row) => row.userId === userId && row.month === month);
  return <section style={{ display: "grid", gap: 18 }}><div style={panelStyle}><h2 style={{ margin: 0 }}>月次確定資料</h2><p>勤怠・活動・日報・関連資料を出力します。法的な労働時間や賃金の判定は行いません。</p><div style={gridStyle}><Field label="対象者"><select style={inputStyle} value={userId} disabled={!manager && profile?.role !== "president_viewer"} onChange={(e) => setUserId(e.target.value)}>{props.users.map((u) => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}</select></Field><Field label="対象月"><input style={inputStyle} type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field></div><button style={buttonStyle} disabled={busy} onClick={create}>JSON・CSV・印刷用HTMLを出力</button>{manager && <><Field label="会社Driveへ保存したPDFのURL"><input style={inputStyle} type="url" value={driveUrl} onChange={(e) => setDriveUrl(e.target.value)} /></Field><button style={quietButtonStyle} onClick={async () => { try { await saveMonthlyPackage({ userId, month, driveUrl }); props.notify("success", "月次資料の保存先を記録しました"); } catch (error) { props.notify("error", error instanceof Error ? error.message : String(error)); } }}>確定版URLを登録</button></>}</div><div style={panelStyle}><h2 style={{ margin: 0 }}>版の履歴</h2>{packageRow?.needsRegeneration && <p style={{ color: "#b45309", fontWeight: 700 }}>確定後に元記録が変更されています。新版の再出力が必要です。</p>}{packageRow?.versions?.length ? packageRow.versions.map((v) => <div key={v.version}>第{v.version}版・{v.status === "current" ? "現行" : "旧版"}　<a href={v.driveUrl} target="_blank" rel="noreferrer">Drive</a></div>) : <p>確定版はありません。</p>}</div></section>;
}

function RenewalSection(props: Props) {
  const [userId, setUserId] = useState(props.users.find((u) => u.role === "employee")?.uid || "");
  const row = props.renewalChecklists.find((item) => item.userId === userId);
  const [form, setForm] = useState({ residenceExpiryDate: "", administrativeScrivenerCheckDate: "", immigrationGuidanceCheckDate: "" });
  const [items, setItems] = useState<RenewalChecklistItem[]>([]);
  useEffect(() => setForm(row ? { residenceExpiryDate: row.residenceExpiryDate, administrativeScrivenerCheckDate: row.administrativeScrivenerCheckDate, immigrationGuidanceCheckDate: row.immigrationGuidanceCheckDate } : { residenceExpiryDate: "", administrativeScrivenerCheckDate: "", immigrationGuidanceCheckDate: "" }), [row]);
  useEffect(() => setItems(row?.items || []), [row]);
  const reminders = useMemo(() => form.residenceExpiryDate ? [120, 90, 60].map((days) => `${days}日前：${addDays(form.residenceExpiryDate, -days)}`) : [], [form.residenceExpiryDate]);
  async function save() { try { await saveRenewalChecklist({ userId, ...form, items }); props.notify("success", "在留更新準備を保存しました"); } catch (error) { props.notify("error", error instanceof Error ? error.message : String(error)); } }
  const statusLabels: Record<RenewalChecklistItem["status"], string> = { not_started: "未着手", in_progress: "準備中", completed: "完了", not_applicable: "対象外" };
  return <section style={panelStyle}>
    <h2 style={{ margin: 0 }}>在留更新準備</h2>
    <p>必要書類をシステムが法的に確定するものではありません。行政書士の最新確認内容と、確認候補の準備状況を記録します。</p>
    <Field label="対象者"><select style={inputStyle} value={userId} onChange={(e) => setUserId(e.target.value)}>{props.users.filter((u) => u.role !== "president_viewer").map((u) => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}</select></Field>
    <div style={gridStyle}><Field label="在留期限"><input style={inputStyle} type="date" value={form.residenceExpiryDate} onChange={(e) => setForm({ ...form, residenceExpiryDate: e.target.value })} /></Field><Field label="行政書士への最新確認日"><input style={inputStyle} type="date" value={form.administrativeScrivenerCheckDate} onChange={(e) => setForm({ ...form, administrativeScrivenerCheckDate: e.target.value })} /></Field><Field label="入管案内の最新確認日"><input style={inputStyle} type="date" value={form.immigrationGuidanceCheckDate} onChange={(e) => setForm({ ...form, immigrationGuidanceCheckDate: e.target.value })} /></Field></div>
    {reminders.length > 0 && <div style={{ background: "#eff6ff", borderRadius: 12, padding: 12 }}><strong>アプリ内の確認目安</strong>{reminders.map((text) => <div key={text}>{text}</div>)}</div>}
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "center" }}><strong>行政書士に確認する書類・手続の候補</strong><button type="button" style={quietButtonStyle} onClick={() => setItems([...items, { id: newId("renewal"), label: "", owner: "", status: "not_started", evidenceUrl: "", note: "" }])}>項目を追加</button></div>
      {items.length === 0 && <p style={{ color: "#64748b", margin: 0 }}>項目はまだありません。最新の行政書士確認内容に合わせて追加してください。</p>}
      {items.map((item, index) => <div key={item.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
        <div style={gridStyle}>
          <Field label="書類・手続名"><input style={inputStyle} value={item.label} onChange={(e) => setItems(items.map((row, i) => i === index ? { ...row, label: e.target.value } : row))} /></Field>
          <Field label="担当者"><input style={inputStyle} value={item.owner} onChange={(e) => setItems(items.map((row, i) => i === index ? { ...row, owner: e.target.value } : row))} /></Field>
          <Field label="準備状況"><select style={inputStyle} value={item.status} onChange={(e) => setItems(items.map((row, i) => i === index ? { ...row, status: e.target.value as RenewalChecklistItem["status"] } : row))}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="証拠・保存先URL"><input style={inputStyle} type="url" value={item.evidenceUrl} onChange={(e) => setItems(items.map((row, i) => i === index ? { ...row, evidenceUrl: e.target.value } : row))} /></Field>
        </div>
        <Field label="メモ"><textarea style={inputStyle} rows={2} value={item.note} onChange={(e) => setItems(items.map((row, i) => i === index ? { ...row, note: e.target.value } : row))} /></Field>
        <button type="button" style={quietButtonStyle} onClick={() => setItems(items.filter((_, i) => i !== index))}>項目を削除</button>
      </div>)}
    </div>
    <button style={buttonStyle} onClick={save}>保存</button>
  </section>;
}
