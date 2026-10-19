import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { businessCopy } from "./presentation";

export function BusinessDetailDialog({ children, editing, archiveOpen, onClose }: {
  children: ReactNode; editing: boolean; archiveOpen: boolean; onClose: () => void;
}) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  const titleId = useId(); const panel = useRef<HTMLElement>(null); const close = useRef<HTMLButtonElement>(null);
  const current = useRef({ archiveOpen, onClose }); current.current = { archiveOpen, onClose };
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    close.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (current.current.archiveOpen) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); current.current.onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') || []);
      if (!controls.length) { event.preventDefault(); panel.current?.focus(); return; }
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => { document.removeEventListener("keydown", onKeyDown, true); document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="business-page business-detail-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !archiveOpen) onClose(); }}>
    <section ref={panel} className="business-detail-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="business-detail-dialog-bar"><h2 id={titleId}>{editing ? c("取り組みを編集", "编辑工作") : c("取り組みの詳細", "工作详情")}</h2><button ref={close} type="button" onClick={onClose} aria-label={c("詳細を閉じる", "关闭详情")}>×</button></div>
      <div className="business-detail-dialog-content">{children}</div>
    </section>
  </div>, document.body);
}
