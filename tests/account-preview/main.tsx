import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountManagementPage } from "../../src/pages/AccountManagementPage";
import { PasswordRecoveryPage } from "../../src/pages/PasswordRecoveryPage";
import { I18nProvider, useI18n } from "../../src/i18n";
import "../../src/styles.css";

function Preview() {
  const [recovery, setRecovery] = useState(false);
  const { locale, setLocale } = useI18n();
  return <>
    <div style={{ padding: "16px 24px", background: "#eaf1ff", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <strong>確認用・架空アカウント</strong>
      <span>本番への接続・変更はありません</span>
      <button className="button secondary" onClick={() => setRecovery(false)}>管理画面</button>
      <button className="button secondary" onClick={() => setRecovery(true)}>本人の再設定画面</button>
      <button className="button secondary" onClick={() => setLocale(locale === "ja" ? "zh-CN" : "ja")}>{locale === "ja" ? "中文" : "日本語"}</button>
    </div>
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: 24 }}>
      {recovery ? <PasswordRecoveryPage token={"p".repeat(43)} onDone={() => setRecovery(false)} /> : <AccountManagementPage />}
    </main>
  </>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Preview /></I18nProvider>);
