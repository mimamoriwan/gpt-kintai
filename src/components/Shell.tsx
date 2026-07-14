import type { ReactNode } from "react";
import { BarChart3, ClipboardPenLine, Home, Languages, LogOut, Settings, SlidersHorizontal } from "lucide-react";
import { Logo } from "./Logo";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import type { NavSection } from "../types";

export function Shell({ section, onSection, children }: { section: NavSection; onSection: (section: NavSection) => void; children: ReactNode }) {
  const { profile, logout } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const canViewAdmin = profile?.role === "employee_manager" || profile?.role === "president_viewer";
  const items: { id: NavSection; label: string; icon: typeof Home; visible: boolean }[] = [
    { id: "home", label: t("home"), icon: Home, visible: profile?.role !== "president_viewer" },
    { id: "report", label: t("dailyReport"), icon: ClipboardPenLine, visible: profile?.role !== "president_viewer" },
    { id: "records", label: t("records"), icon: BarChart3, visible: true },
    { id: "admin", label: t("admin"), icon: SlidersHorizontal, visible: canViewAdmin },
    { id: "settings", label: t("settings"), icon: Settings, visible: true }
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <nav>
          {items.filter((item) => item.visible).map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => onSection(item.id)}><item.icon size={20} /><span>{item.label}</span></button>)}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{profile?.displayName?.slice(0, 1) || "?"}</span>
          <span><strong>{profile?.displayName}</strong><small>{profile?.email}</small></span>
          <button onClick={() => void logout()} aria-label={t("signOut")}><LogOut size={18} /></button>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <Logo compact />
          <div className="topbar-actions">
            <div className="language-toggle"><Languages size={16} /><button className={locale === "ja" ? "active" : ""} onClick={() => setLocale("ja")}>日</button><button className={locale === "zh-CN" ? "active" : ""} onClick={() => setLocale("zh-CN")}>中</button></div>
            <span className="avatar small">{profile?.displayName?.slice(0, 1) || "?"}</span>
          </div>
        </header>
        <div className="page-content">{children}</div>
        <nav className="bottom-nav">
          {items.filter((item) => item.visible).slice(0, 5).map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => onSection(item.id)}><item.icon size={21} /><span>{item.label}</span></button>)}
        </nav>
      </div>
    </div>
  );
}
