import { useEffect, useId, useRef } from "react";
import { useI18n } from "../../i18n";
import { businessCopy } from "./presentation";

/** A DOM dialog keeps confirmation usable in an installed app and embedded browsers. */
export function BusinessArchiveDialog({ name, restoring, dirty, busy, onCancel, onConfirm }: {
  name: string; restoring: boolean; dirty: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  const titleId = useId(); const bodyId = useId(); const panel = useRef<HTMLElement>(null); const cancel = useRef<HTMLButtonElement>(null);
  const live = useRef({ busy, onCancel }); live.current = { busy, onCancel };
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!live.current.busy) live.current.onCancel(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]') || []);
      if (!controls.length) { event.preventDefault(); panel.current?.focus(); return; }
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap, true);
    return () => { document.removeEventListener("keydown", trap, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="business-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section ref={panel} className="business-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} aria-busy={busy} tabIndex={-1}>
      <h2 id={titleId}>{restoring ? c("復元の確認", "确认恢复") : c("アーカイブの確認", "确认归档")}</h2>
      <div id={bodyId}><p className="business-dialog-name">{name}</p><p>{restoring ? c("この項目を復元します。", "恢复此项目。") : c("この項目をアーカイブします。登録内容と変更履歴は残ります。", "将此项目归档，已登记的内容及变更记录将保留。")}</p>
        {dirty && <p className="business-notice">{c("入力中の近況は投稿されません。未保存の入力はこの画面に保持します。先に投稿する場合はキャンセルしてください。", "正在输入的动态不会发布，未保存的输入将保留在此页面。如需先发布，请取消。")}</p>}
      </div>
      {busy && <p role="status">{c("保存中です。そのままお待ちください。", "正在保存，请稍候。")}</p>}
      <div className="business-actions"><button ref={cancel} type="button" disabled={busy} onClick={onCancel}>{c("キャンセル", "取消")}</button><button type="button" className="business-primary" disabled={busy} onClick={onConfirm}>{restoring ? c("復元する", "确认恢复") : c("アーカイブする", "确认归档")}</button></div>
    </section>
  </div>;
}
