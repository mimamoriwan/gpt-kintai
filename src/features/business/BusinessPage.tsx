import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { UserProfile } from "../../types";
import { businessErrorCode, businessErrorMessage, businessFeatureAvailable, getBusinessWorkspace, setBusinessArchived } from "./api";
import { BusinessArchiveDialog } from "./BusinessArchiveDialog";
import { BusinessEntityHistory } from "./BusinessEntityHistory";
import { BusinessDetailPanel } from "./BusinessDetailPanel";
import { BusinessDetailDialog } from "./BusinessDetailDialog";
import { BusinessOverview } from "./BusinessOverview";
import { InitiativeEditor, MembersEditor, ThemeEditor } from "./BusinessForms";
import { businessCopy, dateLabel, safeBusinessLink, statuses, statusLabel } from "./presentation";
import type { BusinessAnnouncementDraft, BusinessInitiative, BusinessTheme, BusinessWorkspace } from "./types";
import { BusinessTranslationProvider, TranslatedText } from "./useBusinessTranslation";
import "./business.css";
import "./overview.css";

interface Props { profile: UserProfile; onCreateAnnouncement: (draft: BusinessAnnouncementDraft) => void; initialInitiativeId?: string }
type Editor = { kind: "theme"; theme?: BusinessTheme } | { kind: "initiative"; initiative?: BusinessInitiative; focusMilestones?: boolean } | { kind: "members" };

export function BusinessPage(props: Props) {
  const { locale } = useI18n();
  if (!businessFeatureAvailable || !props.profile.active) return <section className="business-page"><h1>{locale === "ja" ? "会社の取り組み" : "公司重点工作"}</h1><p>{locale === "ja" ? "この機能は現在利用できません。" : "此功能当前不可用。"}</p></section>;
  // Remount all account-scoped drafts, caches, requests and fetched content together.
  return <BusinessTranslationProvider key={props.profile.uid} uid={props.profile.uid}><BusinessPageContent {...props} /></BusinessTranslationProvider>;
}
export default BusinessPage;

function BusinessPageContent({ profile, onCreateAnnouncement, initialInitiativeId }: Props) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  const [workspace, setWorkspace] = useState<BusinessWorkspace>();
  const [archiveCandidate, setArchiveCandidate] = useState<{ kind: "theme" | "initiative"; row: BusinessTheme | BusinessInitiative }>();
  const [operationError, setOperationError] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [operationBusy, setOperationBusy] = useState(false);
  const [view, setView] = useState<"timeline" | "list">("timeline"); const [themeFilter, setThemeFilter] = useState(""); const [assigneeFilter, setAssigneeFilter] = useState(""); const [statusFilter, setStatusFilter] = useState(""); const [archive, setArchive] = useState(false);
  const [selectedId, setSelectedId] = useState(initialInitiativeId || ""); const [editor, setEditor] = useState<Editor>(); const [manageThemes, setManageThemes] = useState(false);
  const [dirty, setDirty] = useState(false); const dirtyRef = useRef(false); const [feedback, setFeedback] = useState(""); const serial = useRef(0); const active = useRef(true); const operationRef = useRef(false);
  const localeRef = useRef(locale); localeRef.current = locale;
  const markDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); }, []);
  const onAccessError = useCallback((caught: unknown) => {
    if (["permission-denied", "unauthenticated", "business/account-changed"].includes(businessErrorCode(caught))) { serial.current += 1; setWorkspace(undefined); setArchiveCandidate(undefined); setEditor(undefined); setSelectedId(""); markDirty(false); setError(businessErrorMessage(caught, localeRef.current)); }
  }, [markDirty]);
  const refresh = useCallback(async () => {
    const sequence = ++serial.current;
    if (!active.current) return;
    setLoading(true);
    try {
      const next = await getBusinessWorkspace();
      if (!active.current || sequence !== serial.current) return;
      setWorkspace(next); setError("");

    } catch (caught) {
      if (!active.current || sequence !== serial.current) return;
      setError(businessErrorMessage(caught, localeRef.current));
      if (["permission-denied", "unauthenticated", "business/account-changed", "failed-precondition"].includes(businessErrorCode(caught))) { setWorkspace(undefined); setArchiveCandidate(undefined); setEditor(undefined); setSelectedId(""); markDirty(false); }
    } finally { if (active.current && sequence === serial.current) setLoading(false); }
  }, [markDirty]);
  useEffect(() => {
    active.current = true; void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const focus = () => void refresh();
    document.addEventListener("visibilitychange", visible); window.addEventListener("focus", focus);
    return () => { active.current = false; serial.current += 1; window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", focus); };
  }, [refresh]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    // Shell navigation is a normal click. Capture before its handler changes the page.
    const guardNavigation = (event: MouseEvent) => {
      if (!dirtyRef.current || !(event.target instanceof Element)) return;
      const target = event.target.closest("button,a");
      if (!target || target.closest(".business-page") || !target.matches(".sidebar nav button:not(.active), .bottom-nav button:not(.active), .account-switch-button")) return;
      const label = localeRef.current === "ja" ? "未保存の入力があります。破棄して移動しますか？" : "有尚未保存的输入。要放弃并离开吗？";
      if (!window.confirm(label)) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", guardNavigation, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", guardNavigation, true); };
  }, []);
  function leaveDraft() { if (dirtyRef.current && !window.confirm(c("未保存の入力があります。破棄して移動しますか？", "有尚未保存的输入。要放弃并继续吗？"))) return false; markDirty(false); return true; }
  function select(id: string) { if (selectedId === id && !editor) return; if (!leaveDraft()) return; setEditor(undefined); setManageThemes(false); setSelectedId(id); }
  function closeDetail() { if (!leaveDraft()) return; setEditor(undefined); setSelectedId(""); }
  const priorLink = useRef(initialInitiativeId);
  useEffect(() => {
    if (priorLink.current === initialInitiativeId) return;
    priorLink.current = initialInitiativeId;
    if (initialInitiativeId) select(initialInitiativeId);
  }, [initialInitiativeId]);
  function openEditor(next: Editor) { if (!leaveDraft()) return; setEditor(next); setManageThemes(false); setFeedback(""); }
  const canManage = Boolean(workspace?.canManage && (profile.role === "employee_manager" || profile.role === "president_viewer"));
  const themes = useMemo(() => [...(workspace?.themes || [])].sort((a,b) => a.order-b.order || a.name.localeCompare(b.name, locale)), [workspace?.themes, locale]);
  const rows = useMemo(() => (workspace?.initiatives || []).filter(row => {
    const theme = themes.find(t => t.id === row.themeId);
    const archived = row.archived || Boolean(theme?.archived);
    return archived === archive && (!themeFilter || themeFilter === row.themeId) && (!assigneeFilter || (assigneeFilter === "unassigned" ? row.assigneeIds.length === 0 : row.assigneeIds.includes(assigneeFilter))) && (!statusFilter || statusFilter === row.status);
  }).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), [workspace?.initiatives, themes, archive, themeFilter, assigneeFilter, statusFilter]);
  const selectedSnapshot = useRef<BusinessInitiative | undefined>(undefined);
  const foundSelected = workspace?.initiatives.find(row => row.id === selectedId);
  if (foundSelected) selectedSnapshot.current = foundSelected;
  const selected = foundSelected || (workspace && !workspace.settings.enabled && selectedSnapshot.current?.id === selectedId ? selectedSnapshot.current : undefined);
  const selectedTheme = themes.find(t => t.id === selected?.themeId);
  function archiveItem(kind: "theme" | "initiative", row: BusinessTheme | BusinessInitiative) {
    if (operationRef.current || !canManage || !workspace?.settings.enabled) return;
    setArchiveCandidate({ kind, row }); setOperationError("");
  }
  async function confirmArchive() {
    if (operationRef.current || !archiveCandidate) return;
    const { kind, row } = archiveCandidate;
    operationRef.current = true; setOperationBusy(true); setFeedback(""); setOperationError("");
    try { await setBusinessArchived({ kind, id: row.id, expectedVersion: row.version, archived: !row.archived }); if (active.current) setFeedback(c("保存しました。", "已保存。")); }
    catch (caught) { if (active.current) { setOperationError(businessErrorMessage(caught, locale)); onAccessError(caught); } }
    finally {
      if (active.current) await refresh();
      operationRef.current = false;
      if (active.current) { setOperationBusy(false); setArchiveCandidate(undefined); }
    }
  }
  const formCommon = { onDirty: markDirty, refresh, onAccessError, onCancel: () => { if (leaveDraft()) setEditor(undefined); }, onSaved: (id?: string) => { markDirty(false); if (editor?.kind === "initiative" && id) setSelectedId(id); setEditor(undefined); setFeedback(c("原文を保存しました。翻訳は表示時に取得します。", "原文已保存，显示时会获取译文。")); void refresh(); } };
  return <section className="business-page" aria-label={c("会社の取り組み", "公司重点工作")}>
    <header className="business-header"><div><p className="business-eyebrow">{c("会社の課題と目標", "公司的目标与任务")}</p><h1>{c("会社の取り組み", "公司重点工作")}</h1><p className="business-muted">{c("誰が、何に取り組んでいるか。予定と節目を一緒に確認できます。", "谁正在推进什么工作，一起查看计划与里程碑。")}</p></div><div className="business-actions"><button type="button" disabled={loading} onClick={() => void refresh()}>{loading ? c("取得中…", "获取中…") : c("最新情報に更新", "刷新最新信息")}</button>{canManage && <button type="button" onClick={() => openEditor({ kind: "members" })}>{c("共有メンバー設定", "共享成员设置")}</button>}</div></header>
    {error && <div className="business-error" role="alert">{error}{workspace && <p>{c("表示は前回取得時の内容です。", "当前显示的是上次获取的内容。")}</p>}</div>}
    {operationError && <p className="business-error" role="alert">{operationError}</p>}
    {feedback && <p className="business-success" role="status">{feedback}</p>}
    {!workspace && loading && <p role="status">{c("会社の取り組みを読み込み中…", "正在加载公司重点工作…")}</p>}
    {workspace && <><div className="business-meta"><span>{c("取得", "获取时间")}: {dateLabel(workspace.fetchedAt, locale)}</span><span>{c("共有", "共享")}: {workspace.members.map(m => m.displayName).join("・") || c("未設定", "尚未设置")}</span>{dirty && <strong>{c("未保存の入力があります", "有尚未保存的输入")}</strong>}</div>
      {!workspace.settings.enabled && <div className="business-empty"><h2>{workspace.settings.memberIds.length ? c("この機能は停止中です", "此功能已暂停") : c("共有する3人を設定してください", "请设置3位共享成员")}</h2><p>{canManage ? c("共有メンバー設定から利用する3人を選び、利用を有効にできます。", "可在共享成员设置中选择3位成员并启用功能。") : c("管理担当者または社長が利用を再開できます。", "管理员或社长可以重新启用此功能。")}</p></div>}
      {workspace.settings.enabled && <>
        <div className="business-toolbar"><div className="business-views" aria-label={c("表示方法", "显示方式")}><button type="button" aria-pressed={view === "timeline"} onClick={() => setView("timeline")}>{c("工程表", "计划图")}</button><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>{c("一覧・近況", "列表与动态")}</button></div>{canManage && <div className="business-actions"><button type="button" onClick={() => { if (leaveDraft()) { setEditor(undefined); setManageThemes(v => !v); } }}>{c("テーマを管理", "管理主题")}</button><button type="button" className="business-primary" disabled={!themes.some(t => !t.archived)} onClick={() => openEditor({ kind: "initiative" })}>{c("取り組みを追加", "添加工作")}</button></div>}</div>
        <div className="business-filters"><label>{c("テーマで絞り込み", "按主题筛选")}<select value={themeFilter} onChange={e => setThemeFilter(e.target.value)}><option value="">{c("すべてのテーマ", "所有主题")}</option>{themes.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label><label>{c("担当者で絞り込み", "按负责人筛选")}<select value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}><option value="">{c("すべての担当者", "所有负责人")}</option><option value="unassigned">{c("担当未定", "负责人待定")}</option>{workspace.members.map(m => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}</select></label><label>{c("状態で絞り込み", "按状态筛选")}<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">{c("すべての状態", "所有状态")}</option>{statuses.map(status => <option key={status} value={status}>{statusLabel(status, locale)}</option>)}</select></label><label className="business-check"><input type="checkbox" checked={archive} onChange={e => setArchive(e.target.checked)} />{c("アーカイブを表示", "显示已归档")}</label></div>
        {!themes.length && <div className="business-empty"><h2>{c("まず大きなテーマから始めましょう", "从大的主题开始")}</h2><p>{c("販売基盤、商品準備・販売、販促、資金調達、月次管理など、会社に必要なテーマを登録できます。", "可添加销售基础、商品准备与销售、营销推广、资金筹措、月度管理等主题。")}</p>{canManage && <button type="button" onClick={() => openEditor({ kind: "theme" })}>{c("テーマを追加", "添加主题")}</button>}</div>}
        {themes.length > 0 && rows.length === 0 && <p className="business-empty">{c("該当する取り組みはありません。", "没有符合条件的工作。")}</p>}
      </>}
      <div className="business-workbench" data-view={view}>
        <div className="business-overview">
          {workspace.settings.enabled && rows.length > 0 && <BusinessOverview view={view} themes={themes} rows={rows} workspace={workspace} selectedId={selectedId} select={select} />}
        </div>
        <div className="business-selection">
      {manageThemes && canManage && workspace.settings.enabled && <section className="business-theme-manager"><div className="business-section-heading"><h2>{c("テーマの管理", "主题管理")}</h2><button type="button" onClick={() => openEditor({ kind: "theme" })}>{c("テーマを追加", "添加主题")}</button></div>{themes.map(theme => <article className="business-theme" key={theme.id}><h3><TranslatedText kind="theme" resource={theme} field="name" text={theme.name} /> {theme.archived && <small>{c("アーカイブ中", "已归档")}</small>}</h3><p><TranslatedText kind="theme" resource={theme} field="description" text={theme.description} /></p><p>{c("表示順", "显示顺序")}: {theme.order}</p>{theme.referenceLinks.map(link => { const href = safeBusinessLink(link); return href && <a key={link} href={href} target="_blank" rel="noopener noreferrer">{link}</a>; })}<div className="business-actions"><button type="button" disabled={theme.archived || operationBusy} onClick={() => openEditor({ kind: "theme", theme })}>{c("テーマを編集", "编辑主题")}</button><button type="button" disabled={operationBusy} onClick={() => void archiveItem("theme", theme)}>{theme.archived ? c("テーマを復元", "恢复主题") : c("テーマをアーカイブ", "归档主题")}</button></div><BusinessEntityHistory kind="theme" id={theme.id} onAccessError={onAccessError} /></article>)}</section>}
      {editor && canManage && !(editor.kind === "initiative" && editor.initiative) && <div className="business-editor-container"><fieldset className="business-form-fields" disabled={!workspace.settings.enabled && editor.kind !== "members"}>{!workspace.settings.enabled && editor.kind !== "members" && <p className="business-notice">{c("停止中のため保存できません。入力内容はこの画面に保持しています。", "此功能暂停中，无法保存。您的输入保留在此页面。")}</p>}{editor.kind === "theme" && <ThemeEditor key={`theme-${editor.theme?.id || "new"}`} {...formCommon} theme={editor.theme} latest={themes.find(t => t.id === editor.theme?.id)} />}{editor.kind === "initiative" && <InitiativeEditor key="initiative-new" {...formCommon} themes={themes} members={workspace.members} />}{editor.kind === "members" && <MembersEditor {...formCommon} settings={workspace.settings} candidates={workspace.memberCandidates} uid={profile.uid} />}</fieldset></div>}
      {!editor && !manageThemes && selectedId && !selected && workspace.settings.enabled && <p className="business-notice">{c("指定された取り組みを取得できません。共有範囲と最新の一覧をご確認ください。", "无法获取指定工作，请确认共享范围和最新列表。")}</p>}
      {!editor && !manageThemes && !selected && rows.length > 0 && <p className="business-muted business-select-hint">{c("取り組み名を選ぶと、その場で詳細を確認できます。", "选择工作名称即可直接查看详情。")}</p>}
        </div>
      </div>
      {!manageThemes && selected && (!editor || (editor.kind === "initiative" && editor.initiative)) && <BusinessDetailDialog editing={Boolean(editor)} archiveOpen={Boolean(archiveCandidate)} onClose={closeDetail}>
        {editor?.kind === "initiative" && editor.initiative && canManage ? <div className="business-editor-container"><fieldset className="business-form-fields" disabled={!workspace.settings.enabled}>{!workspace.settings.enabled && <p className="business-notice">{c("停止中のため保存できません。入力内容はこの画面に保持しています。", "此功能暂停中，无法保存。您的输入保留在此页面。")}</p>}<InitiativeEditor key={`initiative-${editor.initiative.id}`} {...formCommon} initiative={editor.initiative} latest={workspace.initiatives.find(r => r.id === editor.initiative?.id)} themes={themes} members={workspace.members} focusMilestones={editor.focusMilestones} /></fieldset></div> : <>
          {!rows.some(r => r.id === selected.id) && <p className="business-notice">{c("選択中の取り組みは、現在の絞り込み条件の対象外です。", "所选工作不在当前筛选结果中。")}</p>}
          <BusinessDetailPanel key={selected.id} layout={view} suspended={!workspace.settings.enabled} row={selected} theme={selectedTheme} themes={themes} members={workspace.members} profile={profile} canManage={canManage} fetchedAt={workspace.fetchedAt} refresh={refresh} onEdit={section => openEditor({ kind: "initiative", initiative: selected, focusMilestones: section === "milestones" })} onArchive={() => void archiveItem("initiative", selected)} onCreateAnnouncement={onCreateAnnouncement} onDirty={markDirty} onAccessError={onAccessError} />
        </>}
      </BusinessDetailDialog>}
    </>}
    {archiveCandidate && workspace && canManage && <BusinessArchiveDialog name={archiveCandidate.row.name} restoring={archiveCandidate.row.archived} dirty={dirty} busy={operationBusy} onCancel={() => { if (!operationRef.current) setArchiveCandidate(undefined); }} onConfirm={() => void confirmArchive()} />}
  </section>;
}
