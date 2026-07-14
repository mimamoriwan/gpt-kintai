import { useEffect, useMemo, useState } from "react";
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
import { watchAttendance, watchCategories, watchReports, watchUsers } from "./services/api";
import type { AttendanceRecord, Category, DailyReport, NavSection, UserProfile } from "./types";

export default function App() {
  const { user, profile, loading } = useAuth();
  const [section, setSection] = useState<NavSection>("home");
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingReport, setEditingReport] = useState<DailyReport | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const canViewAll = profile?.role === "employee_manager" || profile?.role === "president_viewer";

  useEffect(() => {
    if (!profile) return;
    if (profile.role === "president_viewer") setSection("admin");
    const unsubs = [
      watchAttendance(profile.uid, canViewAll, setAttendance, (error) => notify("error", error.message)),
      watchReports(profile.uid, canViewAll, setReports, (error) => notify("error", error.message)),
      watchCategories(setCategories)
    ];
    if (canViewAll) unsubs.push(watchUsers(setUsers)); else setUsers([profile]);
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [canViewAll, profile]);

  const sortedUsers = useMemo(() => users.length ? users : profile ? [profile] : [], [profile, users]);

  function notify(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 5000);
  }

  if (loading) return <div className="full-loader"><LoaderCircle className="spin" size={34} /><span>GyoumuLog</span></div>;
  if (!user || !profile || !profile.active) return <LoginPage />;

  function navigate(next: NavSection) { setEditingReport(null); setSection(next); window.scrollTo({ top: 0, behavior: "smooth" }); }

  return (
    <Shell section={section} onSection={navigate}>
      {section === "home" && <HomePage attendance={attendance} reports={reports} onReport={() => navigate("report")} notify={notify} />}
      {section === "report" && <ReportPage reports={reports} categories={categories} editing={editingReport} onDone={() => navigate("records")} notify={notify} />}
      {section === "records" && <RecordsPage attendance={attendance} reports={reports} categories={categories} onEditReport={(report) => { setEditingReport(report); setSection("report"); }} notify={notify} />}
      {section === "admin" && <AdminPage attendance={attendance} reports={reports} users={sortedUsers} categories={categories} notify={notify} />}
      {section === "settings" && <SettingsPage />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </Shell>
  );
}
