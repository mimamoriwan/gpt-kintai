import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ShieldAlert } from "lucide-react";
import { useI18n } from "../i18n";
import { getAppCheckRecoveryState, subscribeToAppCheckRecovery } from "../lib/appCheckRecovery";
import "./AppCheckRecoveryNotice.css";

export function AppCheckRecoveryNotice({ onReload = () => window.location.reload() }: { onReload?: () => void }) {
  const { locale } = useI18n();
  const state = useSyncExternalStore(subscribeToAppCheckRecovery, getAppCheckRecoveryState, getAppCheckRecoveryState);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const entry = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const safetyId = useId();
  const confirmationId = useId();
  const chinese = locale === "zh-CN";

  useEffect(() => {
    if (!state) {
      setOpen(false);
      setConfirmed(false);
    }
  }, [state]);

  if (!state) return null;

  function cancel() {
    setOpen(false);
    setConfirmed(false);
    entry.current?.focus();
  }

  return <section className="app-check-notice" aria-labelledby={titleId} aria-describedby={safetyId}>
    <ShieldAlert className="app-check-icon" size={24} aria-hidden="true" />
    <div className="app-check-copy">
      <strong id={titleId}>{chinese ? "需要确认连接" : "接続の確認が必要です"}</strong>
      <p role="status">{state === "throttled"
        ? (chinese ? "应用的连接验证暂时受到限制。当前显示的数据可能不是最新的，保存或同步也可能已暂停。" : "アプリの接続確認が一時的に制限されています。表示中のデータが最新でない、または保存・同期が止まっている可能性があります。")
        : (chinese ? "应用的连接验证失败。当前显示的数据可能不是最新的，保存或同步也可能已暂停。" : "アプリの接続確認に失敗しました。表示中のデータが最新でない、または保存・同期が止まっている可能性があります。")}</p>
      {state === "throttled" && <p>{chinese ? "仅反复登录无法解除此连接验证限制。" : "ログインを繰り返すだけでは、この接続制限は解除されません。"}</p>}
      <p id={safetyId}>{chinese ? "重新加载不会保存正在输入的内容。请先将正在输入的内容复制到其他地方，再重新加载页面。如果重新加载后仍有问题，请联系管理员。" : "再読み込みでは入力中の内容は保存されません。入力中の内容を別の場所へコピーしてから、画面を再読み込みしてください。再読み込み後も続く場合は、管理担当者へ連絡してください。"}</p>
      <button ref={entry} type="button" className="app-check-secondary" aria-expanded={open} aria-controls={confirmationId} aria-describedby={safetyId} onClick={() => { if (open) cancel(); else { setConfirmed(false); setOpen(true); } }}>
        {chinese ? "确认重新加载" : "再読み込みを確認"}
      </button>
      {open && <div id={confirmationId} className="app-check-confirmation" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }}>
        <p>{chinese ? "还请确认发送和文件上传已经结束。" : "送信やファイルのアップロードが終わっていることも確認してください。"}</p>
        <label>
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>{chinese ? "已复制正在输入的内容，确认可以重新加载" : "入力中の内容をコピーし、再読み込みしてもよいことを確認しました"}</span>
        </label>
        <div className="app-check-actions">
          <button type="button" className="app-check-secondary" onClick={cancel}>{chinese ? "返回输入页面" : "入力に戻る"}</button>
          <button type="button" className="app-check-primary" disabled={!confirmed} onClick={() => { if (confirmed) onReload(); }}>{chinese ? "重新加载页面" : "再読み込みする"}</button>
        </div>
      </div>}
    </div>
  </section>;
}
