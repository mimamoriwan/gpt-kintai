import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarRange, Home, ClipboardPenLine, BarChart3, PackageSearch, Settings, History } from "lucide-react";
import { BusinessPage } from "../../../account-recovery/src/features/business/BusinessPage";
import { AppHeader } from "../../src/components/AppHeader";
import { I18nProvider, useI18n } from "../../src/i18n";
import { previewManager } from "./api";
import "../../src/styles.css";

function Preview() {
  const { locale, setLocale } = useI18n();
  const [announcement, setAnnouncement] = useState("");
  const nav = [
    { label: "ホーム", Icon: Home }, { label: "日報", Icon: ClipboardPenLine },
    { label: "記録", Icon: BarChart3 }, { label: "商品候補", Icon: PackageSearch },
    { label: "業務サイクル", Icon: CalendarRange }, { label: "会社の取り組み", Icon: CalendarRange, active: true },
    { label: "管理", Icon: Settings }, { label: "更新情報", Icon: History }
  ];
  const languageToggle = <div className="language-toggle"><button type="button" className={locale === "ja" ? "active" : ""} onClick={() => setLocale("ja")}>日</button><button type="button" className={locale === "zh-CN" ? "active" : ""} onClick={() => setLocale("zh-CN")}>中</button></div>;
  return <>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><strong>GyoumuLog 確認用</strong></div>
        <nav>{nav.map(({ label, Icon, active }) => <button type="button" key={label} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><Icon size={20} /><span>{label}</span></button>)}</nav>
        <div style={{ marginTop: "auto", paddingTop: 20 }}>{languageToggle}<p>管理者（架空データ）</p></div>
      </aside>
      <div className="app-body">
        <AppHeader><header className="topbar"><strong>GyoumuLog 確認用</strong>{languageToggle}</header></AppHeader>
        <div className="page-content">
          <aside style={{ padding: "12px 16px", marginBottom: 18, border: "1px solid #c8d8f8", borderRadius: 10, background: "#edf4ff" }}>
            <strong>ローカル確認用・架空データ</strong><p style={{ margin: "4px 0 0" }}>保存はこの画面のメモリー内だけに反映されます。ページの再読み込みで初期状態に戻ります。</p>
          </aside>
          {announcement && <p role="status">確認用のお知らせ下書きを受け取りました: {announcement}</p>}
          <BusinessPage profile={previewManager} onCreateAnnouncement={draft => setAnnouncement(draft.title)} />
        </div>
      </div>
    </div>
    <nav className="bottom-nav" aria-label="画面メニュー">{nav.map(({ label, Icon, active }) => <button type="button" key={label} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><Icon size={21} /><span>{label}</span></button>)}</nav>
  </>;
}

createRoot(document.getElementById("root")!).render(<I18nProvider><Preview /></I18nProvider>);
