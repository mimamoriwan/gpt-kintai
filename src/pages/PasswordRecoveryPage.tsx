import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Languages, LockKeyhole } from "lucide-react";
import { Logo } from "../components/Logo";
import { useI18n } from "../i18n";
import { isValidRecoveryToken } from "../lib/recoveryLink";
import { accountErrorCode, accountErrorReason, completeAccountRecovery } from "../services/accountManagement";
import "./AccountManagementPage.css";

const messages = {
  length: ["新しいパスワードは12〜128文字で入力してください。", "新密码请输入12至128个字符。"],
  mismatch: ["確認用のパスワードが一致しません。", "两次输入的密码不一致。"],
  invalid: ["この再設定リンクは無効、使用済み、または期限切れです。管理担当者に新しいリンクの発行を依頼してください。", "此重设链接无效、已使用或已过期。请联系管理员获取新链接。"],
  policy: ["このパスワードは設定条件を満たしていません。別の新しいパスワードを入力してください。", "此密码不符合设置要求。请输入其他新密码。"],
  progress: ["パスワードの変更を確認しています。少し待ってから、同じパスワードで再試行してください。", "正在确认密码变更。请稍候使用相同的密码重试。"],
  conflict: ["前の変更処理を確認する必要があります。最初に設定を試みた新しいパスワードを入力してください。", "需要确认上一次变更。请输入首次尝试设置的新密码。"],
  uncertain: ["変更結果を確認できませんでした。入力したパスワードを保持しています。通信環境を確認して、同じパスワードで再試行してください。", "无法确认变更结果。已保留输入的密码。请检查网络，并使用相同的密码重试。"],
  limited: ["試行が一時的に制限されています。少し待ってから、同じパスワードで再試行してください。", "操作暂时受到限制。请稍候使用相同的密码重试。"],
  logout: ["ログイン画面に戻れませんでした。通信環境を確認して、もう一度お試しください。パスワードの変更は完了しています。", "无法返回登录页面。请检查网络后重试。密码已修改完成。"],
  back: ["ログイン画面に戻れませんでした。通信環境を確認して、もう一度お試しください。", "无法返回登录页面。请检查网络后重试。"]
} as const;
type ErrorKind = keyof typeof messages;

function classify(error: unknown): ErrorKind {
  switch (accountErrorReason(error)) {
    case "password-too-short": case "password-too-long": return "length";
    case "password-policy": return "policy";
    case "recovery-link-unavailable": case "recovery-invalid": case "recovery-expired": case "recovery-unavailable": case "recovery-token-invalid": case "recovery-link-invalid": case "recovery-completed": return "invalid";
    case "account-change-in-progress": case "password-change-in-progress": case "recovery-in-progress": return "progress";
    case "recovery-retry-same-password": return "uncertain";
    case "password-change-conflict": case "password-change-retry-same-password": case "recovery-password-mismatch": return "conflict";
  }
  switch (accountErrorCode(error)) {
    case "auth/weak-password": return "policy";
    case "functions/invalid-argument": return "length";
    case "functions/not-found": case "functions/permission-denied": return "invalid";
    case "functions/resource-exhausted": case "auth/too-many-requests": case "appCheck/throttled": case "app-check/throttled": case "appCheck/initial-throttle": case "app-check/initial-throttle": return "limited";
    default: return "uncertain";
  }
}

interface Props { token: string; onDone: () => Promise<void> | void }

export function PasswordRecoveryPage(props: Props) {
  return <PasswordRecoveryForm key={props.token} {...props} />;
}

function PasswordRecoveryForm({ token, onDone }: Props) {
  const { locale, setLocale } = useI18n();
  const ja = locale === "ja";
  const valid = isValidRecoveryToken(token);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<ErrorKind | null>(valid ? null : "invalid");
  const [busy, setBusy] = useState(false);
  const [retrySame, setRetrySame] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [linkUnavailable, setLinkUnavailable] = useState(!valid);
  const lock = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || linkUnavailable || email !== null) return;
    if (password.length < 12 || password.length > 128) { setError("length"); return; }
    if (password !== confirmation) { setError("mismatch"); return; }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await completeAccountRecovery(token, password);
      if (!active.current) return;
      setEmail(result.email);
      setPassword("");
      setConfirmation("");
      setRetrySame(false);
    } catch (cause) {
      if (!active.current) return;
      const kind = classify(cause);
      setError(kind);
      if (kind === "invalid") setLinkUnavailable(true);
      setRetrySame(kind === "uncertain" || kind === "progress" || kind === "limited");
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }

  async function returnToLogin() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try { await onDone(); }
    catch { if (active.current) setError(email !== null ? "logout" : "back"); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }

  const unusable = linkUnavailable;
  return <main className="auth-recovery-page">
    <section className="auth-recovery-card" aria-labelledby="password-recovery-title">
      <Logo />
      <div className="language-toggle">
        <Languages size={17} />
        <button className={ja ? "active" : ""} onClick={() => setLocale("ja")}>日本語</button>
        <button className={!ja ? "active" : ""} onClick={() => setLocale("zh-CN")}>中文</button>
      </div>
      <h1 id="password-recovery-title">{email !== null ? (ja ? "パスワードを再設定しました" : "密码已重新设置") : (ja ? "パスワードの再設定" : "重新设置密码")}</h1>
      {email !== null ? <div className="account-recovery-success" role="status">
        <CheckCircle2 size={28} />
        <p>{ja ? "次のメールアドレスと新しいパスワードで、ログインし直してください。" : "请使用以下邮箱地址和新密码重新登录。"}</p>
        <strong>{email}</strong>
        <p>{ja ? "再発行は自動的にOFFになりました。" : "密码重设已自动关闭。"}</p>
      </div> : !unusable && <p>{ja ? "ご自身だけが知っている12〜128文字の新しいパスワードを設定してください。リンクは発行から30分間、1回だけ利用できます。" : "请设置仅自己知道的12至128个字符的新密码。链接在发放后30分钟内有效，且仅可使用一次。"}</p>}
      {email === null && !unusable && <form className="initial-password-form" onSubmit={submit} noValidate>
        <label><span>{ja ? "新しいパスワード" : "新密码"}</span><div className="input-with-icon"><LockKeyhole size={18} /><input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} disabled={busy || retrySame} onChange={(event) => setPassword(event.target.value)} /></div></label>
        <label><span>{ja ? "新しいパスワード（確認）" : "确认新密码"}</span><div className="input-with-icon"><LockKeyhole size={18} /><input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} disabled={busy || retrySame} onChange={(event) => setConfirmation(event.target.value)} /></div></label>
        {error && <div className="form-error" role="alert">{messages[error][ja ? 0 : 1]}</div>}
        <button className="button primary large" disabled={busy}>{busy ? (ja ? "処理中…" : "处理中…") : retrySame ? (ja ? "同じパスワードで再試行" : "使用相同密码重试") : (ja ? "新しいパスワードを設定" : "设置新密码")}</button>
      </form>}
      {(email !== null || unusable) && error && <div className="form-error" role="alert">{messages[error][ja ? 0 : 1]}</div>}
      <div className="auth-recovery-actions"><button className={`button ${email !== null ? "primary" : "ghost"} large`} disabled={busy} onClick={() => void returnToLogin()}>{ja ? "ログイン画面に戻る" : "返回登录页面"}</button></div>
    </section>
  </main>;
}
