import { useState } from "react";
import { Languages, RefreshCw } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { Logo } from "../components/Logo";

export function AuthRecoveryPage() {
  const { profile, profileError, retryProfile, logout } = useAuth();
  const { locale, setLocale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const ja = locale === "ja";
  const inactive = profile !== null && !profile.active;
  const missing = profileError === "missing";
  const sessionUnavailable = profileError === "session-unavailable";
  const title = inactive
    ? (ja ? "アカウントの利用が停止されています" : "账号已停用")
    : missing
      ? (ja ? "利用者情報が登録されていません" : "尚未登记用户信息")
      : sessionUnavailable
        ? (ja ? "ログイン状態を確認できませんでした" : "无法确认登录状态")
        : (ja ? "利用者情報を読み込めませんでした" : "无法读取用户信息");
  const message = inactive
    ? (ja ? "利用を再開するには、管理担当者に連絡してください。" : "请联系管理员恢复账号使用。")
    : missing
      ? (ja ? "ログインは完了しています。管理担当者に利用者登録の確認を依頼し、登録後にもう一度読み込んでください。" : "已完成登录。请联系管理员确认用户登记，登记后重新读取。")
      : sessionUnavailable
        ? (ja ? "現在のログイン状態を確認できませんでした。通信環境を確認して、もう一度読み込んでください。解決しない場合は、ログイン画面に戻り、現在有効なパスワードでログインしてください。" : "无法确认当前登录状态。请检查网络后重新读取。如仍未解决，请返回登录页面，使用当前有效的密码登录。")
        : (ja ? "ログインは完了しています。通信環境を確認して、もう一度読み込んでください。繰り返し表示される場合は、管理担当者に連絡してください。" : "已完成登录。请检查网络后重新读取。如果仍然出现此提示，请联系管理员。");

  async function switchAccount() {
    setBusy(true);
    setLogoutFailed(false);
    try { await logout(); }
    catch { setLogoutFailed(true); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-recovery-page">
      <section className="auth-recovery-card" aria-labelledby="auth-recovery-title">
        <Logo />
        <div className="language-toggle">
          <Languages size={17} />
          <button className={ja ? "active" : ""} onClick={() => setLocale("ja")}>日本語</button>
          <button className={!ja ? "active" : ""} onClick={() => setLocale("zh-CN")}>中文</button>
        </div>
        <h1 id="auth-recovery-title">{title}</h1>
        <p role="status">{message}</p>
        {logoutFailed && <div className="form-error" role="alert">{ja ? "ログアウトできませんでした。通信環境を確認して、もう一度お試しください。" : "无法退出登录。请检查网络后重试。"}</div>}
        <div className="auth-recovery-actions">
          {!inactive && <button className="button primary large" disabled={busy} onClick={retryProfile}><RefreshCw size={18} />{ja ? "もう一度読み込む" : "重新读取"}</button>}
          <button className="button ghost large" disabled={busy} onClick={switchAccount}>{sessionUnavailable ? (ja ? "ログイン画面に戻る" : "返回登录页面") : (ja ? "別のアカウントでログイン" : "使用其他账号登录")}</button>
        </div>
      </section>
    </main>
  );
}
