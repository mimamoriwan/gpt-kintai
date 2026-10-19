import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { UserProfile } from "../../types";
import { businessErrorMessage, getBusinessInitiativeDetail, postBusinessUpdate, setBusinessMilestoneCompletion, setBusinessStatus } from "./api";
import { BusinessComparison } from "./BusinessForms";
import { businessCopy, dateLabel, memberNames, newBusinessId, safeBusinessLink, statuses, statusLabel } from "./presentation";
import { milestoneCount } from "./timeline";
import type { BusinessAnnouncementDraft, BusinessDetail, BusinessInitiative, BusinessMember, BusinessTheme } from "./types";
import { TranslatedText } from "./useBusinessTranslation";
import "./BusinessDetailPanel.css";

export function BusinessDetailPanel({ row, theme, themes, members, profile, canManage, fetchedAt, refresh, onEdit, onArchive, onCreateAnnouncement, onDirty, onAccessError, suspended = false, layout = "timeline" }: {
  suspended?: boolean; layout?: "timeline" | "list"; row: BusinessInitiative; theme?: BusinessTheme; themes: BusinessTheme[]; members: BusinessMember[]; profile: UserProfile; canManage: boolean; fetchedAt: number;
  refresh: () => Promise<void>; onEdit: (section?: "milestones") => void; onArchive: () => void; onCreateAnnouncement: (draft: BusinessAnnouncementDraft) => void;
  onDirty: (dirty: boolean) => void; onAccessError: (error: unknown) => void;
}) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  const [detail, setDetail] = useState<BusinessDetail>();
  const [loadError, setLoadError] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [body, setBody] = useState(""); const [sourceLocale, setSourceLocale] = useState(locale); const [postId, setPostId] = useState(newBusinessId);
  const bodyRef = useRef(body); bodyRef.current = body; const sourceRef = useRef(sourceLocale); sourceRef.current = sourceLocale;
  const postRef = useRef(postId); postRef.current = postId;
  const attempted = useRef<{ id: string; uncertain: boolean } | undefined>(undefined);
  const [message, setMessage] = useState(""); const active = useRef(true); const request = useRef(0); const busyRef = useRef(false);
  const canUpdate = !row.archived && !theme?.archived && (canManage || row.assigneeIds.includes(profile.uid));
  useEffect(() => { active.current = true; return () => { active.current = false; request.current += 1; }; }, []);
  const fetchDetail = useCallback(async (cursor?: { updatesCursor?: string; historyCursor?: string }) => {
    const sequence = ++request.current; setLoading(true);
    try {
      const next = await getBusinessInitiativeDetail({ initiativeId: row.id, ...cursor });
      if (!active.current || sequence !== request.current) return;
      const savedAttempt = attempted.current?.uncertain && next.updates.find(update => update.id === attempted.current?.id && update.authorId === profile.uid);
      if (savedAttempt && postRef.current === savedAttempt.id) {
        attempted.current = undefined; setPostId(newBusinessId()); setError("");
        if (bodyRef.current.trim() === savedAttempt.body && sourceRef.current === savedAttempt.sourceLocale) {
          setBody(""); onDirty(false); setMessage(c("近況は保存済みです。再投稿は不要です。", "该动态已保存，无需重复发布。"));
        } else {
          setMessage(c("前回の投稿は保存済みです。変更した入力は残しています。新しい近況として投稿できます。", "上次动态已保存。修改后的输入已保留，可作为新动态发布。"));
        }
      }
      setDetail(old => ({ ...next,
        updates: Array.from(new Map([...(old?.updates || []), ...next.updates].map(u => [u.id, u])).values()).sort((a, b) => b.createdAt - a.createdAt),
        history: Array.from(new Map([...(old?.history || []), ...next.history].map(h => [h.id, h])).values()).sort((a, b) => b.createdAt - a.createdAt),
        nextUpdatesCursor: cursor?.historyCursor ? old?.nextUpdatesCursor ?? null : next.nextUpdatesCursor,
        nextHistoryCursor: cursor?.updatesCursor ? old?.nextHistoryCursor ?? null : next.nextHistoryCursor
      })); setLoadError("");
    } catch (caught) { if (active.current && sequence === request.current) { setLoadError(businessErrorMessage(caught, locale)); onAccessError(caught); } }
    finally { if (active.current && sequence === request.current) setLoading(false); }
  }, [row.id, locale, onAccessError]);
  useEffect(() => { if (!suspended) void fetchDetail(); }, [fetchDetail, fetchedAt, suspended]);
  async function act(operation: () => Promise<unknown>, success: string) {
    if (busyRef.current) return false; busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try { await operation(); if (!active.current) return false; setMessage(success); await refresh(); await fetchDetail(); return true; }
    catch (caught) { if (active.current) { setError(businessErrorMessage(caught, locale)); onAccessError(caught); await refresh(); await fetchDetail(); } return false; }
    finally { busyRef.current = false; if (active.current) setBusy(false); }
  }
  async function post() {
    if (!body.trim()) return;
    attempted.current = { id: postId, uncertain: false };
    const success = await act(async () => {
      try {
        const result = await postBusinessUpdate({ id: postId, initiativeId: row.id, body: body.trim(), sourceLocale });
        // An acknowledged first save is not an uncertain retry. In particular, a
        // concurrent poll must not replace its success message with recovery text.
        if (attempted.current?.id === postId) attempted.current = undefined;
        return result;
      } catch (caught) {
        if (attempted.current?.id === postId) attempted.current.uncertain = true;
        throw caught;
      }
    }, c("近況を保存しました。翻訳の成否にかかわらず原文を共有しています。", "动态已保存。无论翻译是否成功，原文均已共享。"));
    if (success && active.current) { setBody(""); setPostId(newBusinessId()); onDirty(false); }
  }
  const count = milestoneCount(row);
  const latestUpdate = [...(detail?.updates || []), ...(row.latestUpdate ? [row.latestUpdate] : [])]
    .filter(update => update.initiativeId === row.id && typeof update.body === "string" && Number.isFinite(update.createdAt))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const olderUpdates = detail?.updates.filter(update => update.id !== latestUpdate?.id) || [];
  if (suspended) return body ? <section className="business-detail"><p className="business-notice">{c("停止中のため投稿できません。未保存の近況はこの画面に保持しています。", "功能暂停中，无法发布。未保存的动态保留在此页面。")}</p><label>{c("未保存の近況", "未保存的动态")}<textarea readOnly value={body} /></label></section> : null;
  return <section className={`business-detail business-detail-card business-detail-${layout}`} aria-label={c("取り組みの詳細", "工作详情")}>
    <header className="business-detail-heading"><div><small className="business-detail-theme">{theme && <TranslatedText kind="theme" resource={theme} field="name" text={theme.name} />}</small><h2><TranslatedText kind="initiative" resource={row} field="name" text={row.name} /></h2></div>{row.archived && <span className="business-status business-status-not_started">{c("アーカイブ中", "已归档")}</span>}</header>
    <div className="business-detail-meta">
      <dl className="business-facts"><div><dt>{c("担当", "负责人")}</dt><dd>{memberNames(row.assigneeIds, members, locale)} {canManage && !row.archived && !theme?.archived && <button className="business-assignee-edit" type="button" onClick={() => onEdit()}>{c("担当者を変更", "修改负责人")}</button>}</dd></div><div><dt>{c("予定期間", "计划期间")}</dt><dd>{row.plannedStartMonth && row.plannedEndMonth ? `${row.plannedStartMonth} → ${row.plannedEndMonth}` : c("期間未設定", "期间未设置")}</dd></div></dl>
      <label className="business-detail-state">{c("取り組みの状態", "工作状态")}<select disabled={!canUpdate || busy} value={row.status} onChange={e => { const status = e.target.value as BusinessInitiative["status"]; void act(() => setBusinessStatus({ initiativeId: row.id, expectedVersion: row.version, status }), c("状態を更新しました。", "状态已更新。")); }}>{statuses.map(status => <option key={status} value={status}>{statusLabel(status, locale)}</option>)}</select></label>
    </div>
    {(error || loadError) && <div className="business-error" role="alert"><p>{error || loadError}</p><button type="button" disabled={loading} onClick={() => void fetchDetail()}>{c("詳細を再取得", "重新获取详情")}</button></div>}{message && <p role="status" className="business-success">{message}</p>}
    <div className="business-detail-overview">
    <section className="business-detail-milestones"><div className="business-detail-milestone-heading"><h3>{c("節目", "里程碑")} <span className="business-detail-count">{count.total ? `${count.completed} / ${count.total}` : c("節目未設定", "里程碑未设置")}</span></h3>{canManage && !row.archived && !theme?.archived && <button type="button" disabled={busy} onClick={() => onEdit("milestones")}>{c("節目を編集", "编辑里程碑")}</button>}</div>
      {[...row.milestones].sort((a,b) => a.order-b.order).filter(m => !m.archived).map(m => <label className="business-check business-milestone" key={m.id}><input type="checkbox" disabled={!canUpdate || busy} checked={m.completed} onChange={e => { const completed = e.target.checked; void act(() => setBusinessMilestoneCompletion({ initiativeId: row.id, milestoneId: m.id, expectedVersion: row.version, completed }), c("節目を更新しました。", "里程碑已更新。")); }} /><span><TranslatedText kind="initiative" resource={row} field={`milestone:${m.id}`} text={m.name} /><small>{m.updatedAt > 0 && `${memberNames([m.updatedBy], members, locale)} · ${dateLabel(m.updatedAt, locale)}`}</small></span></label>)}
      <p className="business-detail-note business-muted">{c("完了した節目の数です。作業量の割合ではありません。", "显示已完成里程碑数量，不代表工作量百分比。")}</p>
    </section>
    <section className="business-detail-latest"><h3>{c("最新の近況", "最新动态")}</h3>
      {latestUpdate && <article className="business-update business-latest-update"><p><TranslatedText kind="update" resource={latestUpdate} field="body" text={latestUpdate.body} /></p><div className="business-muted">{latestUpdate.authorName} · {dateLabel(latestUpdate.createdAt, locale)}</div></article>}
      {loading && !detail && !latestUpdate && <p role="status" className="business-muted">{c("近況と履歴を読み込み中…", "正在加载动态和记录…")}</p>}
      {detail && !latestUpdate && <p className="business-muted">{c("近況はまだありません。", "暂无动态。")}</p>}
      {(row.archived || theme?.archived) && body && <div className="business-notice"><p>{c("アーカイブ中のため投稿できません。未保存の近況は保持しています。復元後に投稿できます。", "归档期间无法发布。未保存的动态已保留，恢复后可以发布。")}</p><label>{c("未保存の近況", "未保存的动态")}<textarea readOnly value={body} /></label></div>}
      {!row.archived && !theme?.archived && <details className="business-report-disclosure"><summary>{c("近況を記録する", "记录动态")}{body && <small>{c("入力中", "输入中")}</small>}</summary><form onSubmit={e => { e.preventDefault(); void post(); }}><p className="business-detail-note business-muted">{c("共有メンバー3人で確認できます。", "3位共享成员均可查看。")}</p><fieldset className="business-form-fields" disabled={busy}><label>{c("近況の本文", "动态正文")}<textarea required maxLength={5000} value={body} onChange={e => { setBody(e.target.value); onDirty(Boolean(e.target.value)); }} placeholder={c("いま取り組んでいること、相談したいことなど", "目前正在做的事、希望商量的事等")} rows={3} /></label><label>{c("近況の原文言語", "动态原文语言")}<select value={sourceLocale} onChange={e => setSourceLocale(e.target.value as typeof sourceLocale)}><option value="ja">日本語</option><option value="zh-CN">中文</option></select></label><button type="submit" className="business-primary" disabled={!body.trim() || busy}>{busy ? c("保存中…", "保存中…") : c("近況を投稿", "发布动态")}</button></fieldset></form></details>}
    </section>
    </div>
    <details className="business-detail-disclosure"><summary>{c("説明・目標時期・参考資料", "说明、目标时间与参考资料")}</summary><div className="business-detail-description"><p><TranslatedText kind="initiative" resource={row} field="description" text={row.description || c("説明は未登録です。", "尚未填写说明。")} /></p><dl className="business-facts"><div><dt>{c("目標時期メモ", "目标时间备注")}</dt><dd><TranslatedText kind="initiative" resource={row} field="targetMemo" text={row.targetMemo || "—"} /></dd></div></dl>{row.referenceLinks.some(safeBusinessLink) && <div className="business-links"><h3>{c("参考資料", "参考资料")}</h3>{row.referenceLinks.map(link => { const href = safeBusinessLink(link); return href && <a key={link} href={href} target="_blank" rel="noopener noreferrer">{link}</a>; })}</div>}</div></details>
    {(olderUpdates.length > 0 || detail?.nextUpdatesCursor) && <details className="business-detail-disclosure"><summary>{c("これまでの近況", "以往动态")}</summary>{olderUpdates.map(update => <article className="business-update" key={update.id}><div className="business-muted">{update.authorName} · {dateLabel(update.createdAt, locale)}</div><p><TranslatedText kind="update" resource={update} field="body" text={update.body} /></p></article>)}{detail?.nextUpdatesCursor && <button type="button" disabled={loading} onClick={() => void fetchDetail({ updatesCursor: detail.nextUpdatesCursor! })}>{c("以前の近況を表示", "显示更早动态")}</button>}</details>}
    <details className="business-detail-disclosure"><summary>{c("変更履歴", "变更记录")}</summary>{detail?.history.length === 0 && <p>{c("変更履歴はまだありません。", "暂无变更记录。")}</p>}{detail?.history.map(history => <details className="business-history" key={history.id}><summary>{history.actorName} · {dateLabel(history.createdAt, locale)} · {c("変更内容", "变更内容")}</summary><BusinessComparison before={history.before} after={history.after} members={members} themes={themes} /></details>)}{detail?.nextHistoryCursor && <button type="button" disabled={loading} onClick={() => void fetchDetail({ historyCursor: detail.nextHistoryCursor! })}>{c("以前の変更履歴を表示", "显示更早记录")}</button>}</details>
    <footer className="business-detail-footer"><div className="business-actions">{canManage && <><button type="button" disabled={busy || row.archived || theme?.archived} onClick={() => onEdit()}>{c("取り組みを編集", "编辑工作")}</button><button type="button" disabled={busy || (!row.archived && theme?.archived)} onClick={onArchive}>{row.archived ? c("取り組みを復元", "恢复工作") : c("取り組みをアーカイブ", "归档工作")}</button></>}
      <button type="button" disabled={busy || row.archived} onClick={() => onCreateAnnouncement({ key: newBusinessId(), title: `${c("会社の取り組み", "公司重点工作")}: ${row.name}`.slice(0, 120), body: `${c("関連する取り組み", "相关工作")}: ${row.name}\n${window.location.origin}/#business/${encodeURIComponent(row.id)}\n\n` })}>{c("この件のお知らせを作成", "就此事项创建通知")}</button>
    </div>{detail && <small className="business-muted">{c("詳細の取得", "详情获取时间")}: {dateLabel(detail.fetchedAt, locale)}</small>}</footer>
  </section>;
}
