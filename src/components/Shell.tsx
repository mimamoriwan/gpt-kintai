import { useEffect, useRef, useState, type ReactNode } from "react";
import { BarChart3, BookOpenCheck, CalendarRange, ClipboardPenLine, History, Home, Languages, LogOut, PackageSearch, Settings, SlidersHorizontal } from "lucide-react";
import { Logo } from "./Logo";
import { AppUpdateNotice } from "./AppUpdateNotice";
import { AppCheckRecoveryNotice } from "./AppCheckRecoveryNotice";
import { AppHeader } from "./AppHeader";
import { InstructionBanner, InstructionCenter, InstructionShortcut } from "./PresidentInstructions";
import { InstructionReminder } from "./InstructionReminder";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { getAnnouncementForNotification } from "../services/api";
import { filterDemoScope } from "../lib/demo";
import type { AnnouncementRecipient, NavSection, PresidentInstruction } from "../types";
import { businessFeatureAvailable } from "../features/business/api";
import type { BusinessAnnouncementDraft } from "../features/business/types";

export function Shell({ section, onSection, instructions, users, notify, children, announcementDraft, canManageAccounts = false, notificationInstructionId, onNotificationHandled }: { section: NavSection; onSection: (section: NavSection) => void; instructions: PresidentInstruction[]; users: AnnouncementRecipient[]; notify: (type: "success" | "error", message: string) => void; children: ReactNode | ((openInstructions: () => void) => ReactNode); announcementDraft?: BusinessAnnouncementDraft; canManageAccounts?: boolean; notificationInstructionId?: string | null; onNotificationHandled?: () => void }) {
  const { profile, logout } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const [instructionCenterOpen, setInstructionCenterOpen] = useState(false);
  const [selectedInstructionId, setSelectedInstructionId] = useState<string>();
  const [notificationInstruction, setNotificationInstruction] = useState<PresidentInstruction | null>(null);
  useEffect(() => {
    if (!notificationInstructionId || !profile?.uid) return;
    let active = true;
    void getAnnouncementForNotification(notificationInstructionId).then(row => {
      if (!active) return;
      if ((row.authorId !== profile.uid && !row.recipientIds.includes(profile.uid)) || !filterDemoScope([row], profile, false).length) throw new Error("not-authorized");
      setNotificationInstruction(row);
      setSelectedInstructionId(row.id);
      setInstructionCenterOpen(true);
      onNotificationHandled?.();
    }).catch(() => {
      if (!active) return;
      notify("error", locale === "ja" ? "対象のお知らせを開けませんでした。宛先や通信状態を確認してください。" : "无法打开此通知，请检查收件人和网络连接。");
      onNotificationHandled?.();
    });
    return () => { active = false; };
  }, [notificationInstructionId, profile?.uid, locale, notify, onNotificationHandled]);
  function openInstructions(instructionId?: string) {
    setSelectedInstructionId(instructionId);
    setInstructionCenterOpen(true);
  }
  const lastDraft = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (announcementDraft && announcementDraft.key !== lastDraft.current) {
      lastDraft.current = announcementDraft.key;
      openInstructions();
    }
  }, [announcementDraft]);
  const canViewAdmin = profile?.role === "employee_manager" || profile?.role === "president_viewer";
  const items: { id: NavSection; label: string; icon: typeof Home; visible: boolean }[] = [
    { id: "home", label: t("home"), icon: Home, visible: true },
    { id: "report", label: t("dailyReport"), icon: ClipboardPenLine, visible: profile?.role !== "president_viewer" },
    { id: "records", label: t("records"), icon: BarChart3, visible: profile?.role !== "president_viewer" },
    { id: "products", label: t("products"), icon: PackageSearch, visible: true },
    { id: "workflow", label: t("workflow"), icon: CalendarRange, visible: true },
    { id: "weeklyTodo", label: locale === "ja" ? "今週のTo Do" : "本周待办", icon: ClipboardPenLine, visible: true },
    { id: "business", label: locale === "ja" ? "会社の取り組み" : "公司重点工作", icon: CalendarRange, visible: businessFeatureAvailable },
    { id: "admin", label: t("admin"), icon: SlidersHorizontal, visible: canViewAdmin },
    { id: "accounts", label: locale === "ja" ? "ログイン管理" : "登录管理", icon: Settings, visible: canManageAccounts },
    { id: "help", label: t("help"), icon: BookOpenCheck, visible: true },
    { id: "updates", label: t("updates"), icon: History, visible: true },
    { id: "settings", label: t("settings"), icon: Settings, visible: true }
  ];
  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <Logo />
          <AppUpdateNotice placement="sidebar" />
          <nav>
            {items.filter((item) => item.visible).map((item) => <button type="button" key={item.id} className={section === item.id ? "active" : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => onSection(item.id)}><item.icon size={20} /><span>{item.label}</span></button>)}
          </nav>
          <InstructionShortcut instructions={instructions} onOpen={() => openInstructions()} />
          <div className="sidebar-user">
            <span className="avatar">{profile?.displayName?.slice(0, 1) || "?"}</span>
            <span><strong>{profile?.displayName}</strong><small>{profile?.email}</small></span>
            <button className="account-switch-button" onClick={() => void logout()} aria-label={t("switchAccount")} title={t("switchAccount")}><LogOut size={17} /><span>{t("switchAccount")}</span></button>
          </div>
        </aside>
        <div className="app-body">
          <AppHeader>
            <header className="topbar">
              <Logo compact />
              <div className="topbar-actions">
                <InstructionShortcut compact instructions={instructions} onOpen={() => openInstructions()} />
                <div className="language-toggle"><Languages size={16} /><button className={locale === "ja" ? "active" : ""} onClick={() => setLocale("ja")}>日</button><button className={locale === "zh-CN" ? "active" : ""} onClick={() => setLocale("zh-CN")}>中</button></div>
                <button className="account-switch-button compact" onClick={() => void logout()} aria-label={t("switchAccount")} title={t("switchAccount")}><LogOut size={16} /><span>{t("switchAccountShort")}</span></button>
              </div>
            </header>
            <AppUpdateNotice />
            <AppCheckRecoveryNotice />
            <InstructionBanner instructions={instructions} onOpen={openInstructions} />
          </AppHeader>
          <div className="page-content">{typeof children === "function" ? children(() => openInstructions()) : children}</div>
        </div>
      </div>
      <nav className="bottom-nav" aria-label={locale === "ja" ? "画面メニュー" : "页面菜单"}>
        {items.filter((item) => item.visible).map((item) => <button type="button" key={item.id} className={section === item.id ? "active" : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => onSection(item.id)}><item.icon size={21} /><span>{item.label}</span></button>)}
      </nav>
      <InstructionReminder key={`reminder-${profile?.uid}`} instructions={instructions} onOpen={openInstructions} paused={instructionCenterOpen} />
      <InstructionCenter key={profile?.uid} instructions={notificationInstruction && !instructions.some(row => row.id === notificationInstruction.id) ? [...instructions, notificationInstruction] : instructions} users={users} open={instructionCenterOpen} onClose={() => setInstructionCenterOpen(false)} notify={notify} initialDraft={announcementDraft} selectedInstructionId={selectedInstructionId} />
    </>
  );
}
