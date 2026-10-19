import { createRoot } from "react-dom/client";
import { AppCheckRecoveryNotice } from "../../src/components/AppCheckRecoveryNotice";
import { AppHeader } from "../../src/components/AppHeader";
import { I18nProvider, useI18n } from "../../src/i18n";
import { recordAppCheckError } from "../../src/lib/appCheckRecovery";
import "../../src/styles.css";

recordAppCheckError({ code: "appCheck/throttled" });

function Preview() {
  const { locale, setLocale } = useI18n();
  return <div style={{ maxWidth: 1100, margin: "32px auto", background: "white", borderRadius: 16, overflow: "hidden", boxShadow: "0 8px 30px #172b4d12" }}>
    <AppHeader><div style={{ padding: "16px 24px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", background: "#eaf1ff" }}>
      <strong>GyoumuLog · 接続復旧の確認画面</strong><button onClick={() => setLocale(locale === "ja" ? "zh-CN" : "ja")}>{locale === "ja" ? "中文" : "日本語"}</button>
    </div>
    <AppCheckRecoveryNotice /></AppHeader>
    <main style={{ padding: 24 }}>
      <p style={{ color: "#667085" }}>{locale === "ja" ? "動作確認用の画面です。本番への接続・保存はありません。" : "此页面仅供测试，不连接或保存到正式环境。"}</p>
      <label style={{ display: "grid", gap: 12, marginTop: 24 }}><strong>{locale === "ja" ? "未保存の入力（確認用）" : "尚未保存的输入（测试用）"}</strong><textarea aria-label="未保存の入力" rows={5} defaultValue="再読み込み前に控える内容のサンプルです。" /></label>
    </main>
  </div>;
}

createRoot(document.getElementById("root")!).render(<I18nProvider><Preview /></I18nProvider>);
