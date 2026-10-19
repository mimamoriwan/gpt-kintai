import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarRange, ClipboardList, Home, ClipboardPenLine, Flag, History } from "lucide-react";
import { I18nProvider, useI18n } from "../../src/i18n";
import { ReportPage } from "../../src/pages/ReportPage";
import { WeeklyTodoPage } from "../../src/features/weeklyTodo/WeeklyTodoPage";
import { profiles, selectProfile } from "./api";
import "../../src/styles.css";
function Preview() {
  const { locale, setLocale } = useI18n(); const zh = locale === "zh-CN";
  const [uid, setUid] = useState(() => new URLSearchParams(location.search).get("role") === "president" ? "p" : "a"); selectProfile(uid);
  const [reportDate, setReportDate] = useState<string>();
  const nav = [
    { label: zh ? "首页" : "ホーム", Icon: Home }, { label: zh ? "日报" : "日報", Icon: ClipboardPenLine },
    { label: zh ? "业务周期" : "業務サイクル", Icon: CalendarRange }, { label: zh ? "本周待办" : "今週のTo Do", Icon: ClipboardList, active: true },
    { label: zh ? "公司重点工作" : "会社の取り組み", Icon: Flag }, { label: zh ? "更新信息" : "更新情報", Icon: History }
  ];
  const language = <div className="language-toggle"><button onClick={() => setLocale("ja")}>日</button><button onClick={() => setLocale("zh-CN")}>中</button></div>;
  return <><div className="app-shell"><aside className="sidebar"><div className="brand"><strong>GyoumuLog</strong></div><nav>{nav.map(({ label, Icon, active }) => <button key={label} className={(reportDate ? label === (zh ? "日报" : "日報") : active) ? "active" : ""} onClick={() => { if (label === (zh ? "本周待办" : "今週のTo Do")) setReportDate(undefined); }}><Icon size={20} /><span>{label}</span></button>)}</nav><p style={{ marginTop: "auto", color: "#64748b" }}>{zh ? "架空数据预览" : "架空データの確認用"}</p></aside><div className="app-body"><header className="topbar"><strong>GyoumuLog</strong>{language}</header><div className="page-content"><aside style={{ margin: "16px 20px 0", background: "#eef2ff", color: "#4338ca", padding: "12px 16px", borderRadius: 12, fontSize: 13, lineHeight: 1.8 }}><strong>{zh ? "本地预览・架空数据" : "ローカル確認用・架空データ"}</strong><span style={{ marginLeft: 10 }}>{zh ? "保存仅反映在此页面，刷新后重置。" : "保存はこの画面内だけに反映されます。再読み込みで初期状態に戻ります。"}</span><label style={{ display: "block", marginTop: 8 }}>{zh ? "预览账号：" : "確認用アカウント："}<select aria-label="確認用アカウント" value={uid} onChange={event => { setUid(event.target.value); setReportDate(undefined); }}>{profiles.map(profile => <option key={profile.uid} value={profile.uid}>{profile.displayName}</option>)}</select></label></aside>{reportDate ? <ReportPage key={uid} reports={[]} attendance={[]} categories={[]} editing={null} initialDate={reportDate} onDone={() => setReportDate(undefined)} notify={() => undefined} /> : <WeeklyTodoPage key={uid} profile={profiles.find(profile => profile.uid === uid)!} onOpenReport={setReportDate} />}</div></div></div><nav className="bottom-nav" aria-label="画面メニュー">{nav.map(({ label, Icon, active }) => <button key={label} className={(reportDate ? label === (zh ? "日报" : "日報") : active) ? "active" : ""} onClick={() => { if (label === (zh ? "本周待办" : "今週のTo Do")) setReportDate(undefined); }}><Icon size={21} /><span>{label}</span></button>)}</nav></>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Preview /></I18nProvider>);
