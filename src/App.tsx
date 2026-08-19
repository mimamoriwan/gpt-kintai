import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "./auth";
import { Toast, type ToastState } from "./components/Toast";
import { Shell } from "./components/Shell";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { ReportPage } from "./pages/ReportPage";
import { RecordsPage } from "./pages/RecordsPage";
import { AdminPage } from "./pages/AdminPage";
import { SettingsPage } from "./pages/SettingsPage";
import { HelpPage } from "./pages/HelpPage";
import { ProductsPage } from "./pages/ProductsPage";
import { WorkflowPage } from "./pages/WorkflowPage";
import { filterDemoScope } from "./lib/demo";
import {
  watchAttendance, watchCategories, watchCompanyHolidayOverrides, watchDutyDefinitions,
  watchEmploymentBases, watchEvidenceReferences, watchMonthlyPackages, watchNonWorkingReasons,
  watchProductObservations, watchProductRevisions, watchProducts, watchRenewalChecklists,
  watchReports, watchSourceDocumentReferences, watchUsers, watchWeeklyMeetings,
  watchWeeklyPlans, watchWeeklyReports
} from "./services/api";
import type {
  AttendanceRecord, Category, CompanyHolidayOverride, DailyReport, DutyDefinition,
  EmploymentBasis, EvidenceReference, MonthlyEvidencePackage, NavSection, NonWorkingReason,
  Product, ProductObservation, ProductRevision, RenewalChecklist, SourceDocumentReference,
  UserProfile, WeeklyMeetingRecord, WeeklyPlan, WeeklyReport
} from "./types";

export default function App() {
  const { user, profile, loading } = useAuth();
  const [section, setSection] = useState<NavSection>("home");
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
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
  const [editingReport, setEditingReport] = useState<DailyReport | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const canViewAll = profile?.role === "employee_manager" || profile?.role === "president_viewer";

  const notify = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => {
    if (!profile) return;
    const unsubs = [
      watchAttendance(profile.uid, canViewAll, setAttendance, (error) => notify("error", error.message)),
      watchReports(profile.uid, canViewAll, setReports, (error) => notify("error", error.message)),
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
  }, [canViewAll, profile]);

  useEffect(() => {
    if (profile?.uid) setSection("home");
  }, [profile?.uid]);

  const scopedAttendance = useMemo(() => profile ? filterDemoScope(attendance, profile, false) : [], [attendance, profile]);
  const scopedReports = useMemo(() => profile ? filterDemoScope(reports, profile, false) : [], [profile, reports]);
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
  const sortedUsers = useMemo(() => [...scopedUsers].sort((a, b) => a.displayName.localeCompare(b.displayName, "ja")), [scopedUsers]);

  if (loading) return <div className="full-loader"><LoaderCircle className="spin" size={34} /><span>GyoumuLog</span></div>;
  if (!user || !profile || !profile.active) return <LoginPage />;

  function navigate(next: NavSection) { setEditingReport(null); setSection(next); window.scrollTo({ top: 0, behavior: "smooth" }); }

  return (
    <Shell section={section} onSection={navigate}>
      {section === "home" && <HomePage attendance={scopedAttendance} reports={scopedReports} holidayOverrides={holidayOverrides} onReport={() => navigate("report")} notify={notify} />}
      {section === "report" && <ReportPage reports={scopedReports} categories={categories} attendance={scopedAttendance} editing={editingReport} onDone={() => navigate("records")} notify={notify} />}
      {section === "records" && <RecordsPage attendance={scopedAttendance} reports={scopedReports} categories={categories} onEditReport={(report) => { setEditingReport(report); setSection("report"); }} notify={notify} />}
      {section === "products" && <ProductsPage products={scopedProducts} observations={scopedObservations} revisions={scopedProductRevisions} users={sortedUsers} notify={notify} />}
      {section === "workflow" && <WorkflowPage users={sortedUsers} attendance={scopedAttendance} reports={scopedReports} dutyDefinitions={dutyDefinitions} employmentBases={employmentBases} sourceDocuments={sourceDocuments} weeklyPlans={scopedWeeklyPlans} weeklyReports={scopedWeeklyReports} weeklyMeetings={scopedWeeklyMeetings} nonWorkingReasons={scopedNonWorkingReasons} evidenceReferences={scopedEvidenceReferences} monthlyPackages={scopedMonthlyPackages} renewalChecklists={renewalChecklists} notify={notify} />}
      {section === "admin" && <AdminPage attendance={scopedAttendance} reports={scopedReports} users={sortedUsers} categories={categories} holidayOverrides={holidayOverrides} products={scopedProducts} productObservations={scopedObservations} notify={notify} />}
      {section === "help" && <HelpPage />}
      {section === "settings" && <SettingsPage />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </Shell>
  );
}
