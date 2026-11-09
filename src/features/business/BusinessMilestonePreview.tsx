import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Circle, CircleCheck, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { businessCopy } from "./presentation";
import { orderedActiveMilestones } from "./timeline";
import type { BusinessInitiative } from "./types";
import { TranslatedText } from "./useBusinessTranslation";

export function BusinessMilestonePreview({ row, anchor, id, pinned, close, cancelDismiss, scheduleDismiss, openDetails }: {
  row: BusinessInitiative;
  anchor: HTMLButtonElement;
  id: string;
  pinned: boolean;
  close: () => void;
  cancelDismiss: () => void;
  scheduleDismiss: () => void;
  openDetails: () => void;
}) {
  const { locale } = useI18n();
  const c = businessCopy(locale);
  const panel = useRef<HTMLDivElement>(null);
  const details = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const milestones = orderedActiveMilestones(row);
  const completed = milestones.filter(item => item.completed).length;

  useLayoutEffect(() => {
    function place() {
      if (!panel.current) return;
      const rect = anchor.getBoundingClientRect();
      const bounds = anchor.closest(".business-overview-scroll")?.getBoundingClientRect();
      if (!anchor.isConnected || (bounds?.width && (rect.bottom < bounds.top || rect.top > bounds.bottom || rect.right < bounds.left || rect.left > bounds.right))) {
        close();
        return;
      }
      const { width, height } = panel.current.getBoundingClientRect();
      const side = rect.right + width + 16 <= window.innerWidth;
      const left = Math.max(8, Math.min(side ? rect.right + 8 : rect.left, window.innerWidth - width - 8));
      const below = rect.bottom + height + 16 <= window.innerHeight;
      const top = Math.max(8, Math.min(side ? rect.top : below ? rect.bottom + 6 : rect.top - height - 6, window.innerHeight - height - 8));
      setPosition(previous => previous?.left === left && previous.top === top ? previous : { left, top });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : undefined;
    if (panel.current) observer?.observe(panel.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer?.disconnect();
    };
  }, [anchor, close]);

  useEffect(() => {
    if (pinned) details.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.contains(event.target) && !panel.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panel.current?.contains(document.activeElement)) anchor.focus({ preventScroll: true });
      event.preventDefault();
      close();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [anchor, close, pinned]);

  const host = anchor.closest(".business-overview-chart");
  if (!host) return null;
  return createPortal(<div id={id} className="business-milestone-preview" ref={panel} role="region" aria-label={c(`${row.name}の達成項目`, `${row.name}的达成项`)}
    style={position ?? { visibility: "hidden" }} onPointerEnter={cancelDismiss} onPointerLeave={scheduleDismiss}
    onFocus={cancelDismiss} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== anchor) close(); }}>
    <div className="business-milestone-preview-heading">
      <strong>{c("達成項目", "达成项")}</strong>
      <span className="business-preview-count">{c(`${completed}/${milestones.length}件完了`, `已完成 ${completed}/${milestones.length} 项`)}</span>
      <button type="button" className="business-preview-close" aria-label={c("達成項目を閉じる", "关闭达成项")} onClick={() => { anchor.focus({ preventScroll: true }); close(); }}><X size={16} aria-hidden="true" /></button>
    </div>
    {milestones.length > 0 ? <ul tabIndex={pinned ? 0 : undefined}>{milestones.map(item => <li key={item.id}>
      <span className={item.completed ? "business-preview-done" : "business-muted"} role="img" aria-label={item.completed ? c("完了", "已完成") : c("未完了", "未完成")}>{item.completed ? <CircleCheck size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}</span>
      <TranslatedText kind="initiative" resource={row} field={`milestone:${item.id}`} text={item.name} compact />
    </li>)}</ul> : <p className="business-muted">{c("達成項目は未設定です。", "尚未设置达成项。")}</p>}
    <div className="business-milestone-preview-footer">
      <span>{c(`残り${milestones.length - completed}件`, `剩余 ${milestones.length - completed} 项`)}</span>
      <button ref={details} type="button" onClick={() => { anchor.focus({ preventScroll: true }); close(); openDetails(); }}>{c("詳細を開く", "打开详情")}</button>
    </div>
  </div>, host);
}
