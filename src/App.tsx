import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "./i18n";
import { startAnnouncementPushSession } from "./services/announcementPush";
import { useAnnouncementPushRoute } from "./lib/announcementPushRoute";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "./auth";
import { DailyReportReplies } from "./components/DailyReportReplies";
import { Toast, type ToastState } from "./components/Toast";
import { Shell } from "./components/Shell";
import { AppUpdateNotice } from "./components/AppUpdateNotice";
import { AppCheckRecoveryNotice } from "./components/AppCheckRecoveryNotice";
import { AppHeader } from "./components/AppHeader";
import { BusinessFeatureEntry, useBusinessEntry } from "./components/BusinessFeatureEntry";
import { businessFeatureAvailable } from "./features/business/api";
import { LoginPage } from "./pages/LoginPage";
import { AuthRecoveryPage } from "./pages/AuthRecoveryPage";
import { InitialPasswordChangePage } from "./pages/InitialPasswordChangePage";
import { HomePage } from "./pages/HomePage";
import { ReportPage } from "./pages/ReportPage";
import { RecordsPage } from "./pages/RecordsPage";
import { AdminPage } from "./pages/AdminPage";
import { SettingsPage } from "./pages/SettingsPage";
import { HelpPage } from "./pages/HelpPage";
import { UpdatesPage } from "./pages/UpdatesPage";
import { AccountManagementPage } from "./pages/AccountManagementPage";
import { PasswordRecoveryPage } from "./pages/PasswordRecoveryPage";
import { LoginRenewalPage } from "./pages/LoginRenewalPage";
import { getAccountManagement } from "./services/accountManagement";
import { ProductsPage } from "./pages/ProductsPage";
import { WorkflowPage } from "./pages/WorkflowPage";
import { WeeklyTodoPage } from "./features/weeklyTodo/WeeklyTodoPage";
import { filterDemoScope } from "./lib/demo";
import { getAppCheckErrorKind, recordAppCheckError } from "./lib/appCheckRecovery";
import {
  watchAttendance, watchCategories, watchCompanyHolidayOverrides, watchDutyDefinitions,
  watchEmploymentBases, watchEvidenceReferences, watchMonthlyPackages, watchNonWorkingReasons,
  watchProductObservations, watchProductRevisions, watchProducts, watchRenewalChecklists,
  watchReports, watchSourceDocumentReferences, watchUsers, watchWeeklyMeetings,
  watchWeeklyPlans, watchWeeklyReports, watchPresidentInstructions, getAnnouncementRecipients,
  watchDailyReportAutomations
} from "./services/api";
import type {
  AttendanceRecord, Category, CompanyHolidayOverride, DailyReport, DailyReportAutomation, DutyDefinition,
  EmploymentBasis, EvidenceReference, MonthlyEvidencePackage, NavSection, NonWorkingReason,
  Product, ProductObservation, ProductRevision, RenewalChecklist, SourceDocumentReference,
  AnnouncementRecipient, UserProfile, WeeklyMeetingRecord, WeeklyPlan, WeeklyReport, PresidentInstruction
} from "./types";

export default function App() {
  const { locale } = useI18n();
  const pushRoute = useAnnouncementPushRoute();
  const { user, profile, loading, passwordChangePending, sessionReauthRequired, logout } = useAuth();
  const [recoveryToken, setRecoveryToken] = useState<string | null>(() => {
    const hash = window.location.hash;
    return hash.startsWith("#password-recovery=") ? hash.slice("#password-recovery=".length) : null;
  });
  useEffect(() => {
    const captureRecoveryLink = () => {
      if (window.location.hash.startsWith("#password-recovery=")) {
        setRecoveryToken(window.location.hash.slice("#password-recovery=".length));
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    };
    captureRecoveryLink();
    window.addEventListener("hashchange", captureRecoveryLink);
    return () => window.removeEventListener("hashchange", captureRecoveryLink);
  }, []);
  const needsPasswordChange = profile?.passwordChangeRequired === true || passwordChangePending;
  const canUseApp = Boolean(recoveryToken === null && user && profile?.active && user.uid === profile.uid && !loading && !needsPasswordChange && !sessionReauthRequired);
  // Keep subscriptions while restoring authentication; disable on an actual
  // logout/account change, rather than a temporary profile/App Check failure.
  useEffect(() => {
    if (loading) return;
    return startAnnouncementPushSession(user?.uid || null, locale, canUseApp);
  }, [canUseApp, user?.uid, loading, locale]);
  const [managementUid, setManagementUid] = useState<string | null>(null);
  const canManageAccounts = canUseApp && managementUid === user?.uid && profile?.role === "employee_manager";
  useEffect(() => {
    let active = true;
    setManagementUid(null);
    if (canUseApp && profile?.role === "employee_manager" && profile.isDemo !== true) {
      const uid = profile.uid;
      void getAccountManagement().then((result) => {
        if (active && result.canManage) setManagementUid(uid);
      }).catch(() => { /* Management stays hidden when its authority cannot be verified. */ });
    }
    return () => { active = false; };
  }, [canUseApp, profile?.uid, profile?.role, profile?.isDemo]);
  const [section, setSection] = useState<NavSection>("home");
  const [homeVisit, setHomeVisit] = useState(0);
  useEffect(() => {
    if (section === "accounts" && !canManageAccounts) setSection("home");
  }, [section, canManageAccounts]);
  const openBusinessSection = useCallback((next: "home" | "business") => setSection(next), []);
  const businessUid = canUseApp ? profile?.uid : undefined;
  const businessEntry = useBusinessEntry(businessUid, openBusinessSection);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [dailyReportAutomations, setDailyReportAutomations] = useState<DailyReportAutomation[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [holidayOverrides, setHolidayOverrides] = useState<CompanyHolidayOverride[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productObservations, setProductObservations] = useState<ProductObservation[]>([]);
  const [productRevisions, setProductRevisions] = useState<ProductRevision[]>([]);
  const [dutyDefinitions, setDutyDefinitions] = useState<DutyDefinition[]>([]);
  const [employmentBases, setEmploymentBases] = useState<EmploymentBasis[]>([]);
  const [sourceDocuments, setSourceDocuments] = useState<SourceDocumentReference[]>([]);
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>([]);
  const [weeklyMeetings, setWeeklyMeetings] = useState<WeeklyMeetingRecord[]>([]);
  const [nonWorkingReasons, setNonWorkingReasons] = useState<NonWorkingReason[]>([]);
  const [evidenceReferences, setEvidenceReferences] = useState<EvidenceReference[]>([]);
  const [monthlyPackages, setMonthlyPackages] = useState<MonthlyEvidencePackage[]>([]);
  const [renewalChecklists, setRenewalChecklists] = useState<RenewalChecklist[]>([]);
  const [presidentInstructions, setPresidentInstructions] = useState<PresidentInstruction[]>([]);
  const [announcementRecipients, setAnnouncementRecipients] = useState<AnnouncementRecipient[]>([]);
  const [replyReportId, setReplyReportId] = useState<string | null>(null);
  useEffect(() => { setReplyReportId(null); }, [profile?.uid]);
  const [editingReport, setEditingReport] = useState<DailyReport | null>(null);
  const [initialReportDate, setInitialReportDate] = useState<string | undefined>();
  const [toast, setToast] = useState<ToastState | null>(null);
  const canViewAll = profile?.role === "employee_manager" || profile?.role === "president_viewer";

  const notify = useCallback((type: "success" | "error", message: string) => {
    if (type === "error" && getAppCheckErrorKind(message)) {
      recordAppCheckError(message);
      return;
    }
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => {
    if (!canUseApp || !profile) return;
    const unsubs = [
      watchAttendance(profile.uid, canViewAll, setAttendance, (error) => notify("error", error.message)),
      watchReports(profile.uid, canViewAll, setReports, (error) => notify("error", error.message)),
      watchDailyReportAutomations(profile.uid, canViewAll, setDailyReportAutomations, (error) => notify("error", error.message)),
      watchPresidentInstructions(profile, setPresidentInstructions, (error) => notify("error", error.message)),
      watchProducts(profile, canViewAll, setProducts, (error) => notify("error", error.message)),
      watchProductObservations(profile, canViewAll, setProductObservations, (error) => notify("error", error.message)),
      watchDutyDefinitions(setDutyDefinitions, (error) => notify("error", error.message)),
      watchEmploymentBases(profile.uid, canViewAll, setEmploymentBases, (error) => notify("error", error.message)),
      watchWeeklyPlans(profile.uid, canViewAll, setWeeklyPlans, (error) => notify("error", error.message)),
      watchWeeklyReports(profile.uid, canViewAll, setWeeklyReports, (error) => notify("error", error.message)),
      watchWeeklyMeetings(profile.uid, canViewAll, setWeeklyMeetings, (error) => notify("error", error.message)),
      watchNonWorkingReasons(profile.uid, canViewAll, setNonWorkingReasons, (error) => notify("error", error.message)),
      watchEvidenceReferences(profile.uid, canViewAll, setEvidenceReferences, (error) => notify("error", error.message)),
      watchMonthlyPackages(profile.uid, canViewAll, setMonthlyPackages, (error) => notify("error", error.message)),
      watchCategories(setCategories),
      watchCompanyHolidayOverrides(setHolidayOverrides, (error) => notify("error", error.message))
    ];
    if (canViewAll) unsubs.push(watchProductRevisions(setProductRevisions, (error) => notify("error", error.message))); else setProductRevisions([]);
    if (canViewAll) unsubs.push(watchSourceDocumentReferences(setSourceDocuments, (error) => notify("error", error.message))); else setSourceDocuments([]);
    if (profile.role === "employee_manager") unsubs.push(watchRenewalChecklists(setRenewalChecklists, (error) => notify("error", error.message))); else setRenewalChecklists([]);
    if (canViewAll) unsubs.push(watchUsers(setUsers)); else setUsers([profile]);
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [canUseApp, canViewAll, profile]);

  useEffect(() => {
    if (!canUseApp || !profile) {
      setAnnouncementRecipients([]);
      return;
    }
    let active = true;
    void getAnnouncementRecipients()
      .then((rows) => { if (active) setAnnouncementRecipients(rows); })
      .catch((error) => { if (active) notify("error", error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [canUseApp, notify, profile]);

  const scopedAttendance = useMemo(() => profile ? filterDemoScope(attendance, profile, false) : [], [attendance, profile]);
  const scopedReports = useMemo(() => profile ? filterDemoScope(reports, profile, false) : [], [profile, reports]);
  const scopedDailyReportAutomations = useMemo(() => profile ? filterDemoScope(dailyReportAutomations, profile, false) : [], [dailyReportAutomations, profile]);
  const scopedUsers = useMemo(() => profile ? filterDemoScope(users.length ? users : [profile], profile, false) : [], [profile, users]);
  const scopedProducts = useMemo(() => profile ? filterDemoScope(products, profile, false) : [], [products, profile]);
  const scopedObservations = useMemo(() => profile ? filterDemoScope(productObservations, profile, false) : [], [productObservations, profile]);
  const scopedProductRevisions = useMemo(() => profile ? filterDemoScope(productRevisions, profile, false) : [], [productRevisions, profile]);
  const scopedWeeklyPlans = useMemo(() => profile ? filterDemoScope(weeklyPlans, profile, false) : [], [weeklyPlans, profile]);
  const scopedWeeklyReports = useMemo(() => profile ? filterDemoScope(weeklyReports, profile, false) : [], [weeklyReports, profile]);
  const scopedWeeklyMeetings = useMemo(() => profile ? filterDemoScope(weeklyMeetings, profile, false) : [], [weeklyMeetings, profile]);
  const scopedNonWorkingReasons = useMemo(() => profile ? filterDemoScope(nonWorkingReasons, profile, false) : [], [nonWorkingReasons, profile]);
  const scopedEvidenceReferences = useMemo(() => profile ? filterDemoScope(evidenceReferences, profile, false) : [], [evidenceReferences, profile]);
  const scopedMonthlyPackages = useMemo(() => profile ? filterDemoScope(monthlyPackages, profile, false) : [], [monthlyPackages, profile]);
  const scopedPresidentInstructions = useMemo(() => profile ? filterDemoScope(presidentInstructions, profile, false) : [], [presidentInstructions, profile]);
  const sortedUsers = useMemo(() => [...scopedUsers].sort((a, b) => a.displayName.localeCompare(b.displayName, "ja")), [scopedUsers]);

  if (recoveryToken !== null) return <><AppHeader><AppCheckRecoveryNotice /></AppHeader><PasswordRecoveryPage token={recoveryToken} onDone={async () => { await logout(); setRecoveryToken(null); setSection("home"); }} /></>;
  if (loading && !(user && passwordChangePending)) return <><AppHeader><AppUpdateNotice /><AppCheckRecoveryNotice /></AppHeader><div className="full-loader"><LoaderCircle className="spin" size={34} /><span>GyoumuLog</span></div></>;
  if (!user) return <><AppHeader><AppUpdateNotice /><AppCheckRecoveryNotice /></AppHeader><LoginPage /></>;
  if (sessionReauthRequired && profile?.active && !profile.passwordChangeRequired) return <><AppHeader><AppCheckRecoveryNotice /></AppHeader><LoginRenewalPage /></>;
  if (needsPasswordChange && (!profile || profile.active)) return <><AppHeader><AppUpdateNotice /><AppCheckRecoveryNotice /></AppHeader><InitialPasswordChangePage key={user.uid} /></>;
  if (!profile || !profile.active || user.uid !== profile.uid) return <><AppHeader><AppUpdateNotice /><AppCheckRecoveryNotice /></AppHeader><AuthRecoveryPage /></>;

  function navigate(next: NavSection) { if ((next === "business" && !businessFeatureAvailable) || (next === "accounts" && !canManageAccounts)) return; if (next === "home") setHomeVisit((visit) => visit + 1); businessEntry.clearRoute(); setEditingReport(null); setInitialReportDate(undefined); setSection(next); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openReportDate(reportDate: string) { businessEntry.clearRoute(); setEditingReport(null); setInitialReportDate(reportDate); setSection("report"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openExistingReport(report: DailyReport) { businessEntry.clearRoute(); setEditingReport(report); setInitialReportDate(report.reportDate); setSection("report"); window.scrollTo({ top: 0, behavior: "smooth" }); }

  return (
    <Shell key={`${user.uid}:${profile.uid}`} section={section} onSection={navigate} instructions={scopedPresidentInstructions} users={announcementRecipients} notify={notify} announcementDraft={businessEntry.announcementDraft} canManageAccounts={canManageAccounts} notificationInstructionId={pushRoute.instructionId} onNotificationHandled={pushRoute.clear}>
      {(openInstructions) => <>
      <DailyReportReplies key={`replies:${profile.uid}`} reports={scopedReports} uid={profile.uid} selectedReportId={replyReportId} onOpen={setReplyReportId} onClose={() => setReplyReportId(null)} notify={notify} />
      {section === "home" && <HomePage homeVisit={homeVisit} onSection={navigate} onAnnouncements={openInstructions} canManageAccounts={canManageAccounts} attendance={scopedAttendance} reports={scopedReports} automations={scopedDailyReportAutomations} holidayOverrides={holidayOverrides} instructions={scopedPresidentInstructions} users={announcementRecipients} onReport={() => navigate("report")} onReportDate={openReportDate} onConfirmReport={openExistingReport} notify={notify} />}
      {section === "report" && <ReportPage reports={scopedReports} categories={categories} attendance={scopedAttendance} editing={editingReport} initialDate={initialReportDate} onDone={() => navigate("records")} notify={notify} />}
      {section === "records" && <RecordsPage onOpenReplies={setReplyReportId} attendance={scopedAttendance} reports={scopedReports} categories={categories} onEditReport={openExistingReport} notify={notify} />}
      {section === "products" && <ProductsPage products={scopedProducts} observations={scopedObservations} revisions={scopedProductRevisions} users={sortedUsers} notify={notify} />}
      {section === "weeklyTodo" && <WeeklyTodoPage key={profile.uid} profile={profile} onOpenReport={openReportDate} />}
      {section === "workflow" && <WorkflowPage users={sortedUsers} attendance={scopedAttendance} reports={scopedReports} dutyDefinitions={dutyDefinitions} employmentBases={employmentBases} sourceDocuments={sourceDocuments} weeklyPlans={scopedWeeklyPlans} weeklyReports={scopedWeeklyReports} weeklyMeetings={scopedWeeklyMeetings} nonWorkingReasons={scopedNonWorkingReasons} evidenceReferences={scopedEvidenceReferences} monthlyPackages={scopedMonthlyPackages} renewalChecklists={renewalChecklists} notify={notify} />}
      {section === "business" && businessFeatureAvailable && businessUid && <BusinessFeatureEntry key={profile.uid} profile={profile} onCreateAnnouncement={businessEntry.createAnnouncement} initialInitiativeId={businessEntry.initialInitiativeId} />}
      {section === "admin" && <AdminPage attendance={scopedAttendance} reports={scopedReports} automations={scopedDailyReportAutomations} users={sortedUsers} categories={categories} holidayOverrides={holidayOverrides} products={scopedProducts} productObservations={scopedObservations} notify={notify} />}
      {section === "help" && <HelpPage />}
      {section === "updates" && <UpdatesPage />}
      {section === "accounts" && canManageAccounts && <AccountManagementPage key={user.uid} />}
      {section === "settings" && <SettingsPage />}
      <Toast toast={toast} onClose={() => setToast(null)} />
      </>}
    </Shell>
  );
}
