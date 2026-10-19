import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { useI18n } from "../i18n";
import { applyAppUpdate, getAppUpdateState, subscribeToAppUpdate, type AppUpdateState } from "../pwaUpdate";
import "./AppUpdateNotice.css";

const AppUpdateContext = createContext<{ state: AppUpdateState; openConfirmation: () => void } | null>(null);

// One shared confirmation for the sidebar, page banner and signed-out screen.
export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const state = useSyncExternalStore(subscribeToAppUpdate, getAppUpdateState, getAppUpdateState);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const chinese = locale === "zh-CN";

  useEffect(() => {
    const element = dialog.current;
    if (open && state.available) {
      if (!element?.open) element?.showModal();
    } else if (element?.open) {
      element.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    }
  }, [open, state.available]);

  useEffect(() => {
    if (!state.available) { setOpen(false); setConfirmed(false); }
    if (state.failed) setConfirmed(false);
  }, [state.available, state.failed]);

  function closeConfirmation() {
    if (state.applying) return;
    setConfirmed(false);
    setOpen(false);
  }

  function openConfirmation() {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmed(false);
    setOpen(true);
  }

  return <AppUpdateContext.Provider value={{ state, openConfirmation }}>
    {children}
    <dialog ref={dialog} className="app-update-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); closeConfirmation(); }}
      onClose={() => { setOpen(false); setConfirmed(false); }}>
      <div className="app-update-dialog-heading">
        <span className="app-update-icon"><RefreshCw size={25} aria-hidden="true" /></span>
        <button type="button" className="app-update-close" aria-label={chinese ? "关闭更新确认" : "更新の確認を閉じる"} disabled={state.applying} onClick={closeConfirmation}><X size={22} /></button>
      </div>
      <h2 id={titleId}>{chinese ? "准备好更新了吗？" : "更新の準備はできましたか？"}</h2>
      <p id={descriptionId} className="app-update-intro">{chinese ? "更新后将重新打开页面。更新操作不会保存正在输入的内容。" : "更新すると画面が開き直されます。入力中の内容は、更新操作では保存されません。"}</p>
      <ul className="app-update-checklist">
        <li><Check size={18} aria-hidden="true" /><span>{chinese ? "保存输入内容，或复制到其他地方保留。" : "入力中の内容を保存するか、別の場所へコピーしてください。"}</span></li>
        <li><Check size={18} aria-hidden="true" /><span>{chinese ? "等待发送、附件上传和AI处理完成。" : "送信・添付のアップロード・AI処理が終わるまでお待ちください。"}</span></li>
        <li><Check size={18} aria-hidden="true" /><span>{chinese ? "关闭其他GyoumuLog标签页和已安装的应用。" : "ほかのGyoumuLogのタブと、インストール済みアプリを閉じてください。"}</span></li>
      </ul>
      <p className="app-update-note">{chinese ? "同一浏览器中的其他页面也可能重新加载。无需为了更新而正式提交日报。" : "同じブラウザのほかの画面も再読み込みされることがあります。更新のために日報を正式提出する必要はありません。"}</p>
      <label className="app-update-confirmation">
        <input type="checkbox" checked={confirmed} disabled={state.applying} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>{chinese ? "已完成准备，可以重新加载" : "準備ができたので、更新して構いません"}</span>
      </label>
      {state.failed && <p className="app-update-error" role="alert">{chinese ? "未能完成更新。请检查网络后重试。可以返回输入页面。" : "更新を完了できませんでした。通信状態を確認して、もう一度お試しください。入力画面に戻ることもできます。"}</p>}
      <div className="app-update-actions">
        <button type="button" className="app-update-secondary" disabled={state.applying} onClick={closeConfirmation}>{chinese ? "返回输入页面" : "入力に戻る"}</button>
        <button type="button" className="app-update-primary" disabled={!confirmed || state.applying} onClick={() => { if (confirmed) void applyAppUpdate(); }}>
          <RefreshCw size={18} className={state.applying ? "spin" : ""} aria-hidden="true" />
          {state.applying ? (chinese ? "正在更新…" : "更新中…") : state.failed ? (chinese ? "重试更新" : "もう一度更新する") : (chinese ? "更新并重新打开" : "更新して開き直す")}
        </button>
      </div>
      {state.applying && <p className="app-update-note" role="status">{chinese ? "正在切换到新版本，请稍候。页面将自动重新打开。" : "新しいバージョンに切り替えています。このままお待ちください。画面は自動で開き直されます。"}</p>}
    </dialog>
  </AppUpdateContext.Provider>;
}

export function AppUpdateNotice({ placement = "banner" }: { placement?: "sidebar" | "banner" }) {
  const context = useContext(AppUpdateContext);
  const { locale } = useI18n();
  const titleId = useId();
  if (!context?.state.available) return null;
  const { state, openConfirmation } = context;
  const chinese = locale === "zh-CN";
  const sidebar = placement === "sidebar";
  return <section className={`app-update-notice app-update-${placement}`} aria-labelledby={titleId}>
    <span className="app-update-icon"><RefreshCw size={22} className={state.applying ? "spin" : ""} aria-hidden="true" /><i aria-hidden="true" /></span>
    <div className="app-update-copy">
      <div className="app-update-title-row"><strong id={titleId}>{chinese ? "应用有新版本" : sidebar ? "アプリの更新" : "アプリの更新があります"}</strong><span className="app-update-badge">{chinese ? "待更新" : "未更新"}</span></div>
      <p className="app-update-message" role={sidebar ? undefined : "status"}>{state.applying
        ? (chinese ? "正在更新，请稍候。" : "更新しています。このままお待ちください。")
        : state.failed ? (chinese ? "请检查网络后重试更新。" : "通信状態を確認して、もう一度更新してください。")
        : (chinese ? "请点击“更新”后再使用。" : "「更新する」を押してからご利用ください。")}</p>
      {!sidebar && <small>{chinese ? "如正在输入，请先保存。" : "入力中の場合は、保存してから更新できます。"}</small>}
    </div>
    <button type="button" className="app-update-primary" disabled={state.applying} aria-haspopup="dialog" onClick={openConfirmation}>
      <RefreshCw size={18} aria-hidden="true" />{state.applying ? (chinese ? "正在更新…" : "更新中…") : state.failed ? (chinese ? "重试更新" : "もう一度更新する") : (chinese ? "更新" : "更新する")}
    </button>
  </section>;
}
