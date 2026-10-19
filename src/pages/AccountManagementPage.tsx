import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { createRecoveryLink } from "../lib/recoveryLink";
import {
  accountErrorCode, accountErrorReason, changeAccountEmail, getAccountManagement,
  reauthenticateAccountManager, setAccountRecovery, type ManagedAccount
} from "../services/accountManagement";
import "./AccountManagementPage.css";

type Notice = "load" | "recent" | "email" | "email-used" | "processing" | "conflict" | "access" | "unknown" | "credential" | "limited";
const notices: Record<Notice, readonly [string, string]> = {
  load: ["アカウント情報を読み込めませんでした。通信環境を確認して、再読み込みしてください。", "无法读取账号信息。请检查网络后重新读取。"],
  recent: ["安全のため、あなたの現在のパスワードを確認してください。確認後、操作をもう一度実行してください。", "为了安全，请验证您当前的密码。验证后请再次执行操作。"],
  email: ["有効なメールアドレスを入力してください。", "请输入有效的邮箱地址。"],
  "email-used": ["このメールアドレスは既に使用されています。別のメールアドレスを指定してください。", "此邮箱地址已被使用。请指定其他邮箱地址。"],
  processing: ["変更処理が進行中です。しばらく待ってから状態を再読み込みしてください。", "变更正在处理中。请稍候重新读取状态。"],
  conflict: ["前のメールアドレス変更を確認する必要があります。同じ変更先メールアドレスで再試行してください。", "需要确认上一次邮箱变更。请使用相同的新邮箱地址重试。"],
  access: ["この操作を行う権限がありません。画面を再読み込みしてください。", "您没有执行此操作的权限。请重新读取页面。"],
  unknown: ["操作の結果を確認できませんでした。状態を再読み込みしてください。メールアドレス変更の場合は、同じ変更先で再試行してください。", "无法确认操作结果。请重新读取状态。如正在修改邮箱，请使用相同的新邮箱重试。"],
  credential: ["パスワードを確認できませんでした。あなたの現在のパスワードを確認して、もう一度お試しください。", "无法验证密码。请确认您当前的密码后重试。"],
  limited: ["試行が一時的に制限されています。しばらく待ってから、もう一度お試しください。", "操作暂时受到限制。请稍候重试。"]
};

function classify(error: unknown): Notice {
  switch (accountErrorReason(error)) {
    case "recent-login-required": return "recent";
    case "account-change-in-progress": case "email-change-in-progress": case "recovery-in-progress": case "password-change-in-progress": return "processing";
    case "email-change-retry-same-address": case "email-change-conflict": case "email-change-retry-same-email": return "conflict";
    case "email-already-exists": return "email-used";
    case "invalid-account-input": case "account-email-rejected": return "email";
    case "account-management-forbidden": case "managed-account-unavailable": return "access";
  }
  switch (accountErrorCode(error)) {
    case "auth/requires-recent-login": return "recent";
    case "functions/permission-denied": return "access";
    case "functions/invalid-argument": case "auth/invalid-email": return "email";
    case "functions/already-exists": case "auth/email-already-in-use": return "email-used";
    case "functions/resource-exhausted": case "auth/too-many-requests": return "limited";
    default: return "unknown";
  }
}

function expiryLabel(value: string | undefined, ja: boolean): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat(ja ? "ja-JP" : "zh-CN", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function AccountManagementPage() {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const ja = locale === "ja";
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Notice | null>(null);
  const [recentRequired, setRecentRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [reauthError, setReauthError] = useState<Notice | null>(null);
  const [reauthBusy, setReauthBusy] = useState(false);
  const [reauthDone, setReauthDone] = useState(false);
  const active = useRef(true);
  const loadId = useRef(0);
  const reauthLock = useRef(false);

  async function reload() {
    const request = ++loadId.current;
    setLoading(true);
    try {
      const result = await getAccountManagement();
      if (!active.current || request !== loadId.current) return;
      setCanManage(result.canManage);
      setAccounts(result.canManage ? result.accounts ?? [] : []);
      setError(null);
    } catch (cause) {
      if (!active.current || request !== loadId.current) return;
      if (classify(cause) === "access" || accountErrorCode(cause) === "functions/unauthenticated") {
        setCanManage(false);
        setAccounts([]);
      }
      setError("load");
    } finally { if (active.current && request === loadId.current) setLoading(false); }
  }

  useEffect(() => {
    active.current = true;
    void reload();
    const refreshVisible = () => { if (document.visibilityState === "visible") void reload(); };
    const timer = window.setInterval(refreshVisible, 30_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { active.current = false; ++loadId.current; window.clearInterval(timer); document.removeEventListener("visibilitychange", refreshVisible); };
  }, []);

  function requireRecent() { setRecentRequired(true); setReauthDone(false); setReauthError(null); }

  async function reauthenticate(event: FormEvent) {
    event.preventDefault();
    if (reauthLock.current || !password) return;
    reauthLock.current = true;
    setReauthBusy(true);
    setReauthError(null);
    try {
      await reauthenticateAccountManager(password, accounts.find((account) => account.uid === profile?.uid)?.email);
      if (!active.current) return;
      setRecentRequired(false);
      setReauthDone(true);
    } catch (cause) {
      if (active.current) setReauthError(classify(cause) === "limited" ? "limited" : "credential");
    } finally {
      reauthLock.current = false;
      if (active.current) { setPassword(""); setReauthBusy(false); }
    }
  }

  return <div className="page account-management-page">
    <div className="page-heading split"><div><span className="eyebrow">ACCOUNT MANAGEMENT</span><h1>{ja ? "アカウント管理" : "账号管理"}</h1><p>{ja ? "ログイン用メールアドレスと、パスワード再発行の受付を管理します。" : "管理登录邮箱与密码重设。"}</p></div><button className="button ghost" disabled={loading} onClick={() => void reload()}><RefreshCw size={17} />{ja ? "状態を再読み込み" : "重新读取状态"}</button></div>
    {error && <div className="form-error" role="alert">{notices[error][ja ? 0 : 1]}</div>}
    {canManage === null && <p role="status">{loading ? (ja ? "管理権限を確認しています…" : "正在确认管理权限…") : (ja ? "再読み込みして管理権限を確認してください。" : "请重新读取以确认管理权限。")}</p>}
    {canManage === false && <section className="card account-management-notice"><ShieldCheck size={24} /><p>{ja ? "この画面は、指定されたアカウント管理者だけが利用できます。" : "此页面仅限指定的账号管理员使用。"}</p></section>}
    {canManage && <>
      <section className="card account-management-notice"><ShieldCheck size={24} /><div><strong>{ja ? "あなた専用の管理画面" : "您的专属管理页面"}</strong><p>{ja ? "本人から連絡があったときに再発行をONにし、表示された専用リンクを本人へ伝えてください。リンクは30分間有効で、設定完了後は自動的にOFFになります。現在のパスワードは表示されません。" : "本人请求重设时，请开启密码重设，并将显示的专用链接转告本人。链接在30分钟内有效，设置完成后会自动关闭。当前密码不会显示。"}</p></div></section>
      {recentRequired && <section className="card account-reauth"><h2>{ja ? "あなたの本人確認" : "验证您的身份"}</h2><p>{notices.recent[ja ? 0 : 1]}</p><form onSubmit={reauthenticate}><label>{ja ? "あなたの現在のパスワード" : "您当前的密码"}<input type="password" autoComplete="current-password" required disabled={reauthBusy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{reauthError && <div className="form-error" role="alert">{notices[reauthError][ja ? 0 : 1]}</div>}<button className="button primary" disabled={reauthBusy || !password}>{reauthBusy ? (ja ? "確認中…" : "验证中…") : (ja ? "本人確認をする" : "验证身份")}</button></form></section>}
      {reauthDone && <p className="account-success-message" role="status">{ja ? "本人確認ができました。目的の操作をもう一度実行してください。" : "身份验证成功。请再次执行所需操作。"}</p>}
      <div className="account-management-grid">{accounts.map((account) => <AccountCard key={account.uid} account={account} self={account.uid === profile?.uid} disabled={recentRequired || reauthBusy} onRecentRequired={requireRecent} onRefresh={reload} />)}</div>
      {!loading && accounts.length === 0 && <p>{ja ? "管理対象のアカウントが設定されていません。" : "尚未设置要管理的账号。"}</p>}
    </>}
  </div>;
}

interface CardProps { account: ManagedAccount; self: boolean; disabled: boolean; onRecentRequired: () => void; onRefresh: () => Promise<void> }
function AccountCard({ account, self, disabled, onRecentRequired, onRefresh }: CardProps) {
  const { locale } = useI18n();
  const ja = locale === "ja";
  const [link, setLink] = useState<{ value: string; expiresAt?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Notice | null>(null);
  const [message, setMessage] = useState<"on" | "off" | "email" | null>(null);
  const [confirmReissue, setConfirmReissue] = useState(false);
  const [emailStage, setEmailStage] = useState<"closed" | "edit" | "confirm">("closed");
  const [email, setEmail] = useState(account.pendingEmail ?? account.email);
  const [emailRetry, setEmailRetry] = useState(false);
  const active = useRef(true);
  const lock = useRef(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const status = account.recovery.status;
  const expired = status === "expired" || (status === "enabled" && !!account.recovery.expiresAt && Date.parse(account.recovery.expiresAt) <= Date.now());
  const enabled = status === "enabled" && !expired;
  const processing = status === "processing";
  const blocked = disabled || busy || processing;
  const pendingEmail = account.emailChangePending ? account.pendingEmail : undefined;
  const targetEmail = pendingEmail ?? email;
  const visibleLink = enabled && link && (!link.expiresAt || Date.parse(link.expiresAt) > Date.now()) ? link : null;
  const role = account.role === "president_viewer" ? (ja ? "社長" : "社长") : account.role === "employee_manager" ? (ja ? "管理担当" : "管理员") : (ja ? "従業員" : "员工");
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (status !== "enabled") { setLink(null); setCopied(false); } }, [status]);

  function fail(cause: unknown) {
    const kind = classify(cause);
    setError(kind);
    if (kind === "recent") onRecentRequired();
    return kind;
  }

  async function changeRecovery(nextEnabled: boolean) {
    if (lock.current || blocked) return;
    lock.current = true;
    setBusy(true); setError(null); setMessage(null); setCopied(false); setCopyFailed(false);
    // A previous token must never be offered after a possibly successful reissue.
    setLink(null);
    try {
      const result = await setAccountRecovery(account.uid, nextEnabled);
      if (!active.current) return;
      if (nextEnabled && result.token) setLink({ value: createRecoveryLink(result.token), expiresAt: result.expiresAt });
      setMessage(nextEnabled ? "on" : "off");
      setConfirmReissue(false);
      await onRefresh();
    } catch (cause) { if (active.current) { fail(cause); await onRefresh(); } }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }

  function previewEmail(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    const normalized = targetEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) { setError("email"); return; }
    setEmail(normalized); setError(null); setEmailStage("confirm");
  }

  async function saveEmail() {
    if (lock.current || blocked) return;
    lock.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      await changeAccountEmail(account.uid, targetEmail);
      if (!active.current) return;
      setEmailStage("closed"); setEmailRetry(false); setLink(null); setMessage("email");
      await onRefresh();
    } catch (cause) {
      if (!active.current) return;
      const kind = fail(cause);
      setEmailRetry(kind === "unknown" || kind === "processing" || kind === "conflict");
      await onRefresh();
    } finally { lock.current = false; if (active.current) setBusy(false); }
  }

  async function copy() {
    if (!visibleLink) return;
    try { await navigator.clipboard.writeText(visibleLink.value); if (active.current) { setCopied(true); setCopyFailed(false); } }
    catch { if (active.current) { setCopyFailed(true); linkInput.current?.focus(); linkInput.current?.select(); } }
  }

  return <section className="card managed-account" aria-label={account.displayName}>
    <header><span className="avatar">{account.displayName.slice(0, 1)}</span><div><h2>{account.displayName}</h2><span>{role}{self ? (ja ? " · あなた" : " · 您") : ""}</span></div></header>
    <div className="account-email"><span><Mail size={16} />{ja ? "ログイン用メールアドレス" : "登录邮箱"}</span><strong>{account.email}</strong>{emailStage === "closed" && <button className="button ghost" disabled={blocked} onClick={() => { setEmail(pendingEmail ?? account.email); setEmailStage("edit"); setError(null); setEmailRetry(Boolean(account.emailChangePending)); }}>{ja ? "メールアドレスを変更" : "修改邮箱地址"}</button>}</div>
    {account.emailChangePending && <p className="account-inline-note">{ja ? "メールアドレスの変更が未完了です。最初に指定した変更先で再試行してください。" : "邮箱变更尚未完成。请使用首次指定的新邮箱重试。"}{pendingEmail && <><br />{ja ? "変更先：" : "新邮箱："}<strong>{pendingEmail}</strong></>}</p>}
    {emailStage === "edit" && <form className="account-email-form" onSubmit={previewEmail} noValidate><label>{ja ? "新しいメールアドレス" : "新邮箱地址"}<input type="email" autoComplete="off" required maxLength={254} value={targetEmail} readOnly={Boolean(pendingEmail)} disabled={blocked} onChange={(event) => setEmail(event.target.value)} /></label><div className="account-button-row"><button className="button primary" disabled={blocked || (!account.emailChangePending && targetEmail.trim() === account.email)}>{ja ? "変更内容を確認" : "确认变更内容"}</button><button type="button" className="button ghost" disabled={busy} onClick={() => { setEmailStage("closed"); setError(null); }}>{ja ? "キャンセル" : "取消"}</button></div></form>}
    {emailStage === "confirm" && <div className="account-confirmation"><strong>{ja ? "メールアドレスを変更しますか？" : "确定修改邮箱地址？"}</strong><p>{account.displayName}<br /><b>{targetEmail}</b></p><p>{ja ? "変更後は新しいメールアドレスでログインします。発行済みの再設定リンクは無効になります。" : "修改后请使用新邮箱登录。已发放的重设链接将失效。"}</p><div className="account-button-row"><button className="button primary" disabled={blocked} onClick={() => void saveEmail()}>{busy ? (ja ? "変更中…" : "修改中…") : emailRetry ? (ja ? "同じメールアドレスで再試行" : "使用相同邮箱重试") : (ja ? "このメールアドレスに変更" : "修改为此邮箱")}</button>{!emailRetry && <button className="button ghost" disabled={busy} onClick={() => setEmailStage("edit")}>{ja ? "入力に戻る" : "返回输入"}</button>}</div></div>}
    <div className="account-recovery-heading"><h3><KeyRound size={18} />{ja ? "パスワード再発行" : "密码重设"}</h3><span className={`account-recovery-status ${enabled ? "enabled" : ""}`}>{processing ? (ja ? "設定処理中" : "设置处理中") : enabled ? "ON" : "OFF"}</span></div>
    <p className="account-recovery-description">{processing ? (ja ? "本人が新しいパスワードを設定しています。完了するまでお待ちください。" : "本人正在设置新密码。请等待设置完成。") : status === "completed" ? (ja ? "再設定が完了し、自動的にOFFになりました。" : "重设已完成，已自动关闭。") : expired ? (ja ? "リンクの有効期限が切れたため、OFFになりました。" : "链接已过期，已关闭。") : enabled ? (ja ? "本人による再設定を受け付けています。" : "正在等待本人重设密码。") : (ja ? "本人から依頼があったときにONにしてください。" : "请在收到本人请求时开启。")}</p>
    {enabled && account.recovery.expiresAt && <p className="account-inline-note">{ja ? "有効期限：" : "有效期限："}{expiryLabel(account.recovery.expiresAt, ja)}{ja ? "（日本時間）" : "（日本时间）"}</p>}
    {visibleLink && <div className="account-link-box"><label>{ja ? "本人に伝える再設定リンク" : "转告本人的重设链接"}<input ref={linkInput} type="text" readOnly value={visibleLink.value} onFocus={(event) => event.target.select()} /></label><button className="button secondary" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? (ja ? "コピーしました" : "已复制") : (ja ? "リンクをコピー" : "复制链接")}</button><p>{copyFailed ? (ja ? "コピーできませんでした。上のリンクを選択してコピーしてください。" : "未能复制。请选择上方链接并复制。") : (ja ? "リンクはこの画面にいる間だけ表示されます。本人以外には渡さないでください。" : "链接仅在停留此页面期间显示。请勿提供给本人以外的人。")}</p></div>}
    {enabled && !visibleLink && <p className="account-inline-note">{ja ? "発行済みリンクは再表示できません。必要な場合は新しいリンクを発行してください。古いリンクは無効になります。" : "无法再次显示已发放的链接。如有需要，请重新发放链接。旧链接将失效。"}</p>}
    {confirmReissue ? <div className="account-confirmation"><p>{ja ? "新しいリンクを発行すると、古いリンクは使えなくなります。本人へ新しいリンクを伝えてください。" : "发放新链接后，旧链接将无法使用。请将新链接转告本人。"}</p><div className="account-button-row"><button className="button primary" disabled={blocked} onClick={() => void changeRecovery(true)}>{ja ? "古いリンクを無効にして再発行" : "使旧链接失效并重新发放"}</button><button className="button ghost" disabled={busy} onClick={() => setConfirmReissue(false)}>{ja ? "キャンセル" : "取消"}</button></div></div> : <div className="account-button-row"><button className="button primary" disabled={blocked || account.emailChangePending} onClick={() => enabled ? setConfirmReissue(true) : void changeRecovery(true)}>{enabled ? (ja ? "新しいリンクを再発行" : "重新发放链接") : (ja ? "再発行をONにする" : "开启密码重设")}</button>{enabled && <button className="button ghost" disabled={blocked} onClick={() => void changeRecovery(false)}>{ja ? "OFFにする" : "关闭"}</button>}</div>}
    {error && <div className="form-error" role="alert">{notices[error][ja ? 0 : 1]}</div>}
    {message && !error && (message !== "on" || enabled) && <p className="account-success-message" role="status">{message === "email" ? (ja ? "メールアドレスを変更しました。本人へ新しいメールアドレスを伝えてください。" : "邮箱地址已修改。请将新邮箱地址转告本人。") : message === "on" ? (ja ? "再発行をONにしました。本人へリンクを伝えてください。" : "已开启密码重设。请将链接转告本人。") : (ja ? "再発行をOFFにしました。リンクは使えなくなりました。" : "已关闭密码重设。链接已失效。")}</p>}
  </section>;
}
