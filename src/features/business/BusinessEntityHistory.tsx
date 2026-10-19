import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { businessErrorMessage, getBusinessHistory } from "./api";
import { BusinessComparison } from "./BusinessForms";
import { businessCopy, dateLabel } from "./presentation";
import type { BusinessHistory, BusinessMember } from "./types";

export function BusinessEntityHistory({ kind, id, members, onAccessError }: { kind: "theme" | "settings"; id: string; members?: BusinessMember[]; onAccessError: (error: unknown) => void }) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  const [rows, setRows] = useState<BusinessHistory[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState(false); const [loaded, setLoaded] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const active = useRef(true); const loading = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function fetchHistory(next?: string) {
    if (loading.current) return; loading.current = true; setBusy(true); setError("");
    try {
      const result = await getBusinessHistory({ kind, id, ...(next ? { cursor: next } : {}) });
      if (!active.current) return;
      setRows(previous => next ? [...previous, ...result.history] : result.history); setCursor(result.nextCursor); setLoaded(true);
    } catch (caught) { if (active.current) { setError(businessErrorMessage(caught, locale)); onAccessError(caught); } }
    finally { loading.current = false; if (active.current) setBusy(false); }
  }
  return <section className="business-section"><button type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && !loaded) void fetchHistory(); }}>{c("この設定の変更履歴", "此设置的变更记录")}</button>
    {open && <div>{busy && <p role="status">{c("履歴を読み込み中…", "正在加载记录…")}</p>}{error && <p role="alert" className="business-error">{error}</p>}{loaded && rows.length === 0 && <p>{c("変更履歴はまだありません。", "暂无变更记录。")}</p>}{rows.map(row => <details key={row.id} className="business-history"><summary>{row.actorName} · {dateLabel(row.createdAt, locale)}</summary><BusinessComparison before={row.before} after={row.after} members={members} /></details>)}<div className="business-actions"><button type="button" disabled={busy} onClick={() => void fetchHistory()}>{c("履歴を更新", "刷新记录")}</button>{cursor && <button type="button" disabled={busy} onClick={() => void fetchHistory(cursor)}>{c("以前の変更履歴を表示", "显示更早记录")}</button>}</div></div>}
  </section>;
}
