import { useRef, useState, type FormEvent } from "react";
import { Languages, LockKeyhole } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { Logo } from "../components/Logo";

const errors = {
  length: ["新しいパスワードは6〜128文字で入力してください。", "新密码请输入6至128个字符。"],
  mismatch: ["確認用のパスワードが一致しません。", "两次输入的密码不一致。"],
  temporary: ["仮パスワードとは異なる新しいパスワードを入力してください。", "请输入与临时密码不同的新密码。"],
  policy: ["このパスワードは設定条件を満たしていません。別の新しいパスワードを入力してください。解決しない場合は管理担当者に確認してください。", "此密码不符合设置要求。请输入其他新密码。如仍未解决，请联系管理员确认。"],
  preparing: ["仮パスワードを準備しています。管理担当者からの案内を確認してから、もう一度お試しください。", "临时密码正在准备中。请确认管理员的通知后重试。"],
  recent: ["ログイン画面に戻り、現在有効なパスワードでログインし直してください。変更を試みた場合は、入力した新しいパスワードをお試しください。", "请返回登录页面，使用当前有效的密码重新登录。如果已经尝试修改密码，请尝试使用当时输入的新密码。"],
  expired: ["仮パスワードで設定できる期限が過ぎています。管理担当者に再発行を依頼してください。", "临时密码的设置期限已过。请联系管理员重新发放。"],
  progress: ["パスワードの変更処理が進行中です。しばらく待ち、同じ新しいパスワードでもう一度お試しください。", "密码变更正在处理中。请稍候使用相同的新密码重试。"],
  same: ["前の変更処理を確認する必要があります。最初に入力した新しいパスワードでもう一度お試しください。解決しない場合は管理担当者に連絡してください。", "需要确认上一次变更。请使用最初输入的新密码重试。如仍未解决，请联系管理员。"],
  reauth: ["パスワードの変更は完了しています。通信環境を確認し、変更した新しいパスワードでログインを再試行してください。", "密码已修改。请检查网络，并使用修改后的新密码重新登录。"],
  network: ["通信結果を確認できませんでした。接続を確認し、同じ新しいパスワードでもう一度お試しください。", "无法确认网络请求结果。请检查连接，并使用相同的新密码重试。"],
  limited: ["試行が一時的に制限されています。しばらく待ってから、もう一度お試しください。", "操作暂时受到限制。请稍候再试。"],
  unavailable: ["パスワード設定を利用できません。管理担当者に確認を依頼してください。", "无法使用密码设置。请联系管理员确认。"],
  logout: ["ログアウトできませんでした。通信環境を確認して、もう一度お試しください。", "无法退出登录。请检查网络后重试。"],
  unknown: ["パスワード設定を完了できませんでした。同じ新しいパスワードで再試行し、解決しない場合は管理担当者に連絡してください。", "未能完成密码设置。请使用相同的新密码重试。如仍未解决，请联系管理员。"]
} as const;

function errorKind(error: unknown): keyof typeof errors {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const details = typeof error === "object" && error !== null && "details" in error ? error.details : undefined;
  const reason = typeof details === "object" && details !== null && "reason" in details ? details.reason : undefined;
  switch (reason) {
    case "password-too-short": case "password-too-long": return "length";
    case "password-matches-temporary": return "temporary";
    case "password-policy": return "policy";
    case "password-setup-not-ready": return "preparing";
    case "recent-login-required": return "recent";
    case "password-setup-expired": return "expired";
    case "password-change-in-progress": return "progress";
    case "password-change-conflict": case "password-change-retry-same-password": return "same";
    case "password-setup-unavailable": return "unavailable";
  }
  switch (code) {
    case "auth/requires-recent-login": case "functions/unauthenticated": return "recent";
    case "auth/password-change-reauth-required": return "reauth";
    case "auth/password-change-in-progress": return "progress";
    case "auth/weak-password": return "policy";
    case "functions/invalid-argument": return "length";
    case "auth/network-request-failed": case "functions/unavailable": case "functions/deadline-exceeded": return "network";
    case "auth/too-many-requests": case "functions/resource-exhausted": case "appCheck/throttled": case "appCheck/initial-throttle": case "app-check/throttled": case "app-check/initial-throttle": return "limited";
    case "functions/permission-denied": return "unavailable";
    default: return "unknown";
  }
}

export function InitialPasswordChangePage() {
  const { completeInitialPasswordChange, passwordChangeNeedsReauth, logout } = useAuth();
  const { locale, setLocale } = useI18n();
  const ja = locale === "ja";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<keyof typeof errors | null>(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const lock = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    setError(null);
    if (password.length < 6 || password.length > 128) { setError("length"); return; }
    if (password !== confirmation) { setError("mismatch"); return; }
    lock.current = true;
    setBusy(true);
    try {
      await completeInitialPasswordChange(password);
      setPassword("");
      setConfirmation("");
      setCompleted(true);
    } catch (cause) { setError(errorKind(cause)); }
    finally { lock.current = false; setBusy(false); }
  }

  async function returnToLogin() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setPassword("");
    setConfirmation("");
    setError(null);
    try { await logout(); }
    catch { setError("logout"); }
    finally { lock.current = false; setBusy(false); }
  }

  return <main className="auth-recovery-page">
    <section className="auth-recovery-card" aria-labelledby="initial-password-title">
      <Logo />
      <div className="language-toggle">
        <Languages size={17} />
        <button className={ja ? "active" : ""} onClick={() => setLocale("ja")}>日本語</button>
        <button className={!ja ? "active" : ""} onClick={() => setLocale("zh-CN")}>中文</button>
      </div>
      <h1 id="initial-password-title">{passwordChangeNeedsReauth ? (ja ? "新しいパスワードでログイン" : "使用新密码登录") : (ja ? "新しいパスワードを設定" : "设置新密码")}</h1>
      <p>{passwordChangeNeedsReauth
        ? (ja ? "パスワードの変更は完了しています。変更した新しいパスワードでログインしてください。" : "密码已修改。请使用修改后的新密码登录。")
        : (ja ? "初回のご利用には、仮パスワードの変更が必要です。ご自身だけが知っている6〜128文字のパスワードを設定してください。" : "首次使用前需要修改临时密码。请设置仅自己知道的6至128个字符的密码。")}</p>
      <form className="initial-password-form" onSubmit={submit} noValidate>
        <label><span>{ja ? "新しいパスワード" : "新密码"}</span><div className="input-with-icon"><LockKeyhole size={18} /><input type="password" autoComplete="new-password" minLength={6} maxLength={128} required value={password} disabled={busy || completed} onChange={(event) => setPassword(event.target.value)} /></div></label>
        <label><span>{ja ? "新しいパスワード（確認）" : "确认新密码"}</span><div className="input-with-icon"><LockKeyhole size={18} /><input type="password" autoComplete="new-password" minLength={6} maxLength={128} required value={confirmation} disabled={busy || completed} onChange={(event) => setConfirmation(event.target.value)} /></div></label>
        {error && <div className="form-error" role="alert">{errors[error][ja ? 0 : 1]}</div>}
        {completed && <p role="status">{ja ? "設定が完了しました。画面を更新しています。" : "设置已完成。正在更新页面。"}</p>}
        <div className="auth-recovery-actions">
          <button className="button primary large" disabled={busy || completed}>{busy
            ? (ja ? "処理中…" : "处理中…")
            : passwordChangeNeedsReauth ? (ja ? "新しいパスワードでログイン" : "使用新密码登录") : (ja ? "パスワードを変更して開始" : "修改密码并开始使用")}</button>
          <button type="button" className="button ghost large" disabled={busy || completed} onClick={returnToLogin}>{ja ? "ログイン画面に戻る" : "返回登录页面"}</button>
        </div>
      </form>
    </section>
  </main>;
}
