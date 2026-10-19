import { useRef, useState } from "react";
import { Logo } from "../components/Logo";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

export function LoginRenewalPage() {
  const { profile, logout } = useAuth();
  const { locale } = useI18n();
  const ja = locale === "ja";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  async function returnToLogin() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    try { await logout(); }
    catch { setError(true); }
    finally { lock.current = false; setBusy(false); }
  }
  return <main className="auth-recovery-page"><section className="auth-recovery-card">
    <Logo />
    <h1>{ja ? "ログインし直してください" : "请重新登录"}</h1>
    <p>{ja ? "ログイン情報が変更されました。次のメールアドレスと、現在有効なパスワードでログインしてください。メールアドレスだけの変更ではパスワードは変わりません。" : "登录信息已更改。请使用以下邮箱地址和当前有效的密码登录。仅修改邮箱时，密码保持不变。"}</p>
    <strong style={{ overflowWrap: "anywhere" }}>{profile?.email}</strong>
    {error && <div className="form-error" role="alert">{ja ? "ログイン画面に戻れませんでした。もう一度お試しください。" : "无法返回登录页面，请重试。"}</div>}
    <div className="auth-recovery-actions"><button className="button primary large" disabled={busy} onClick={() => void returnToLogin()}>{busy ? (ja ? "処理中…" : "处理中…") : (ja ? "ログイン画面に戻る" : "返回登录页面")}</button></div>
  </section></main>;
}
