import { Languages, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

export function SettingsPage() {
  const { profile, logout } = useAuth();
  const { locale, setLocale, t } = useI18n();
  return <div className="page settings-page"><div className="page-heading"><div><span className="eyebrow">PREFERENCES</span><h1>{t("settings")}</h1></div></div><div className="settings-grid"><section className="card profile-card"><span className="avatar large">{profile?.displayName?.slice(0, 1)}</span><h2>{profile?.displayName}</h2><p>{profile?.email}</p><span className="tag blue">{profile?.role === "employee_manager" ? t("manager") : profile?.role === "president_viewer" ? t("president") : t("employee")}</span></section><section className="card setting-list"><div><span className="setting-icon"><Languages size={21} /></span><span><strong>{t("language")}</strong><small>{locale === "ja" ? "表示する言語を選択" : "选择界面显示语言"}</small></span><div className="language-toggle"><button className={locale === "ja" ? "active" : ""} onClick={() => setLocale("ja")}>日本語</button><button className={locale === "zh-CN" ? "active" : ""} onClick={() => setLocale("zh-CN")}>中文</button></div></div><div><span className="setting-icon"><ShieldCheck size={21} /></span><span><strong>{locale === "ja" ? "記録の保存" : "记录保存"}</strong><small>{locale === "ja" ? "勤怠・日報・修正履歴を最低5年間保持" : "考勤、日报和修改记录至少保存5年"}</small></span></div><button className="setting-logout" onClick={() => void logout()}><LogOut size={20} />{t("signOut")}</button></section></div><div className="disclaimer"><ShieldCheck size={19} /><p>{locale === "ja" ? "本システムは勤務実態の社内記録を目的とします。在留資格更新の許可や提出資料としての採用を保証するものではありません。" : "本系统用于公司内部记录工作情况，不保证在留资格更新获批或被作为提交材料采用。"}</p></div></div>;
}
