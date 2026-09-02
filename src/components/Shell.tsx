import { useState, type ReactNode } from "react";
import { BarChart3, BookOpenCheck, CalendarRange, ClipboardPenLine, Home, Languages, LogOut, PackageSearch, Settings, SlidersHorizontal } from "lucide-react";
import { Logo } from "./Logo";
import { InstructionBanner, InstructionCenter, InstructionShortcut } from "./PresidentInstructions";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import type { AnnouncementRecipient, NavSection, PresidentInstruction } from "../types";

export function Shell({ section, onSection, instructions, users, notify, children }: { section: NavSection; onSection: (section: NavSection) => void; instructions: PresidentInstruction[]; users: AnnouncementRecipient[]; notify: (type: "success" | "error", message: string) => void; children: ReactNode }) {
  const { profile, logout } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const [instructionCenterOpen, setInstructionCenterOpen] = useState(false);
  const canViewAdmin = profile?.role === "employee_manager" || profile?.role === "president_viewer";
  const items: { id: NavSection; label: string; icon: typeof Home; visible: boolean }[] = [
    { id: "home", label: t("home"), icon: Home, visible: true },
    { id: "report", label: t("dailyReport"), icon: ClipboardPenLine, visible: profile?.role !== "president_viewer" },
    { id: "records", label: t("records"), icon: BarChart3, visible: profile?.role !== "president_viewer" },
    { id: "products", label: t("products"), icon: PackageSearch, visible: true },
    { id: "workflow", label: t("workflow"), icon: CalendarRange, visible: true },
    { id: "admin", label: t("admin"), icon: SlidersHorizontal, visible: canViewAdmin },
    { id: "help", label: t("help"), icon: BookOpenCheck, visible: true },
    { id: "settings", label: t("settings"), icon: Settings, visible: profile?.role === "employee_manager" }
  ];
  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <Logo />
          <nav>
            {items.filter((item) => item.visible).map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => onSection(item.id)}><item.icon size={20} /><span>{item.label}</span></button>)}
          </nav>
          <InstructionShortcut instructions={instructions} onOpen={() => setInstructionCenterOpen(true)} />
          <div className="sidebar-user">
            <span className="avatar">{profile?.displayName?.slice(0, 1) || "?"}</span>
            <span><strong>{profile?.displayName}</strong><small>{profile?.email}</small></span>
            <button className="account-switch-button" onClick={() => void logout()} aria-label={t("switchAccount")} title={t("switchAccount")}><LogOut size={17} /><span>{t("switchAccount")}</span></button>
          </div>
        </aside>
        <div className="app-body">
          <header className="topbar">
            <Logo compact />
            <div className="topbar-actions">
              <InstructionShortcut compact instructions={instructions} onOpen={() => setInstructionCenterOpen(true)} />
              <div className="language-toggle"><Languages size={16} /><button className={locale === "ja" ? "active" : ""} onClick={() => setLocale("ja")}>日</button><button className={locale === "zh-CN" ? "active" : ""} onClick={() => setLocale("zh-CN")}>中</button></div>
              <button className="account-switch-button compact" onClick={() => void logout()} aria-label={t("switchAccount")} title={t("switchAccount")}><LogOut size={16} /><span>{t("switchAccountShort")}</span></button>
            </div>
          </header>
          <InstructionBanner instructions={instructions} onOpen={() => setInstructionCenterOpen(true)} />
          <div className="page-content">{children}</div>
        </div>
      </div>
      <nav className="bottom-nav" aria-label={locale === "ja" ? "画面メニュー" : "页面菜单"}>
        {items.filter((item) => item.visible).map((item) => <button type="button" key={item.id} className={section === item.id ? "active" : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => onSection(item.id)}><item.icon size={21} /><span>{item.label}</span></button>)}
      </nav>
      <InstructionCenter instructions={instructions} users={users} open={instructionCenterOpen} onClose={() => setInstructionCenterOpen(false)} notify={notify} />
    </>
  );
}
