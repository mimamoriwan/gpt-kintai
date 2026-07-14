import { useState, type FormEvent } from "react";
import { Languages, LockKeyhole, Mail } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { Logo } from "../components/Logo";

export function LoginPage() {
  const { login } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try { await login(email, password); }
    catch { setError(locale === "ja" ? "メールアドレスまたはパスワードを確認してください。" : "请检查邮箱地址或密码。"); }
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
          {error && <div className="form-error">{error}</div>}
          <button className="button primary large full" disabled={busy}>{busy ? "…" : t("login")}</button>
          <small className="login-footnote">{t("noPublicSignup")}</small>
        </form>
      </section>
    </main>
  );
}
