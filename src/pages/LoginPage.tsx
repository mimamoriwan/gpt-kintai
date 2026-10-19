import { useState, type FormEvent } from "react";
import { Languages, LockKeyhole, Mail } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { Logo } from "../components/Logo";
import { getAppCheckErrorKind, getAppCheckRecoveryState, recordAppCheckError } from "../lib/appCheckRecovery";

const loginErrors = {
  credentials: {
    ja: "メールアドレスまたはパスワードを確認してください。解決しない場合は、管理担当者へ連絡してください。",
    "zh-CN": "请检查邮箱地址或密码。如仍无法登录，请联系管理员。"
  },
  network: {
    ja: "ログインの通信に失敗しました。インターネット接続を確認して、もう一度お試しください。",
    "zh-CN": "登录时网络连接失败。请检查网络连接后重试。"
  },
  connection: {
    ja: "アプリの接続確認に失敗したか、一時的な制限が残っています。再ログインを繰り返さず、入力中の内容を控えてから画面を再読み込みしてください。解決しない場合は管理担当者へ連絡してください。",
    "zh-CN": "应用的连接验证失败或仍受到临时限制。请勿反复登录，请先备份正在输入的内容，再重新加载页面。如仍未解决，请联系管理员。"
  },
  throttled: {
    ja: "ログインの試行が一時的に制限されています。しばらく待ってから、もう一度お試しください。解決しない場合は、管理担当者へ連絡してください。",
    "zh-CN": "登录尝试暂时受到限制。请稍候再试。如仍无法登录，请联系管理员。"
  },
  disabled: {
    ja: "このアカウントは無効になっています。管理担当者へ連絡してください。",
    "zh-CN": "此账号已被停用。请联系管理员。"
  },
  configuration: {
    ja: "アプリのログイン設定に問題があります。管理担当者へこの画面の表示内容を伝えてください。",
    "zh-CN": "应用的登录设置有问题。请将此页面显示的内容告知管理员。"
  },
  unknown: {
    ja: "ログインできませんでした。もう一度お試しください。解決しない場合は、管理担当者へこの画面の表示内容を伝えてください。",
    "zh-CN": "登录失败。请重试。如仍无法登录，请将此页面显示的内容告知管理员。"
  }
} as const;

function loginErrorKind(error: unknown): keyof typeof loginErrors {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  // Auth can replace an App Check failure with a generic credential error.
  // A known provider lockout needs page recovery, not repeated password entry.
  if (code !== "auth/user-disabled" && (getAppCheckErrorKind(error) || getAppCheckRecoveryState() === "throttled")) return "connection";
  switch (code) {
    case "auth/captcha-check-failed":
      return "connection";
    case "auth/invalid-credential":
    case "auth/invalid-email":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "credentials";
    case "auth/network-request-failed":
    case "auth/timeout":
      return "network";
    case "auth/too-many-requests":
      return "throttled";
    case "auth/user-disabled":
      return "disabled";
    case "auth/operation-not-allowed":
    case "auth/invalid-api-key":
    case "auth/app-not-authorized":
    case "auth/unauthorized-domain":
    case "auth/configuration-not-found":
      return "configuration";
    default:
      return "unknown";
  }
}

export function LoginPage() {
  const { login } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof loginErrors | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try { await login(email, password); }
    catch (cause) { recordAppCheckError(cause); setError(loginErrorKind(cause)); }
    finally { setBusy(false); }
  }

  return (
    <main className="login-page">
      <section className="login-intro">
        <Logo />
        <div className="login-message">
          <span className="eyebrow">WORK RECORDS, MADE SIMPLE</span>
          <h1>{locale === "ja" ? "毎日の仕事を、\n会社の信頼へ。" : "让每天的工作，\n成为公司的信任。"}</h1>
          <p>{locale === "ja" ? "勤怠と日報を、スマートフォンから簡単に記録できます。" : "使用手机轻松记录考勤和工作日报。"}</p>
        </div>
        <div className="login-features">
          <span>✓ {locale === "ja" ? "かんたん打刻" : "一键打卡"}</span>
          <span>✓ {locale === "ja" ? "中文入力対応" : "支持中文输入"}</span>
          <span>✓ {locale === "ja" ? "記録を安全に保存" : "安全保存记录"}</span>
        </div>
      </section>
      <section className="login-panel-wrap">
        <div className="language-toggle login-language">
          <Languages size={17} />
          <button className={locale === "ja" ? "active" : ""} onClick={() => setLocale("ja")}>日本語</button>
          <button className={locale === "zh-CN" ? "active" : ""} onClick={() => setLocale("zh-CN")}>中文</button>
        </div>
        <form className="login-panel" onSubmit={submit}>
          <h2>{t("login")}</h2>
          <p>{t("loginHelp")}</p>
          <label>
            <span>{t("email")}</span>
            <div className="input-with-icon"><Mail size={18} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></div>
          </label>
          <label>
            <span>{t("password")}</span>
            <div className="input-with-icon"><LockKeyhole size={18} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
          </label>
          {error && <div className="form-error" role="alert">{loginErrors[error][locale]}</div>}
          <button className="button primary large full" disabled={busy}>{busy ? "…" : t("login")}</button>
          <p className="login-footnote">{locale === "ja" ? "パスワードを忘れた場合は管理担当者へ連絡し、専用の再設定リンクを受け取ってください。" : "忘记密码时，请联系管理员领取专用重设链接。"}</p>
          <small className="login-footnote">{t("noPublicSignup")}</small>
        </form>
      </section>
    </main>
  );
}
