import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { BusinessEntityHistory } from "./BusinessEntityHistory";
import { useI18n } from "../../i18n";
import type { Locale } from "../../types";
import { businessErrorCode, businessErrorMessage, saveBusinessInitiative, saveBusinessSettings, saveBusinessTheme } from "./api";
import { businessCopy, memberNames, newBusinessId, safeBusinessLink, statuses, statusLabel } from "./presentation";
import type { BusinessInitiative, BusinessInitiativeInput, BusinessMember, BusinessSettings, BusinessTheme, BusinessThemeInput } from "./types";

type Common = { onSaved: (id?: string) => void; onCancel: () => void; onDirty: (dirty: boolean) => void; refresh: () => Promise<void>; onAccessError: (error: unknown) => void };
function LocaleInput({ value, onChange }: { value: Locale; onChange: (value: Locale) => void }) {
  const { locale } = useI18n();
  return <label>{locale === "ja" ? "原文の言語" : "原文语言"}<select value={value} onChange={e => onChange(e.target.value as Locale)}><option value="ja">日本語</option><option value="zh-CN">中文</option></select></label>;
}
function useEditor<T extends { expectedVersion: number }>(initial: T, save: (draft: T) => Promise<unknown>, props: Common) {
  const { locale } = useI18n();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const active = useRef(true);
  const busyRef = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  function change(patch: Partial<T>) { setDraft(value => ({ ...value, ...patch })); props.onDirty(true); }
  async function submit(next = draft) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await save(next);
      if (!active.current) return;
      props.onDirty(false); props.onSaved("id" in next ? String(next.id) : undefined);
    } catch (caught) {
      if (!active.current) return;
      setError(businessErrorMessage(caught, locale)); setConflict(businessErrorCode(caught) === "aborted");
      props.onAccessError(caught); await props.refresh();
    } finally { busyRef.current = false; if (active.current) setBusy(false); }
  }
  return { draft, change, busy, error, setError, conflict, submit };
}
export function BusinessComparison({ before, after, members = [], themes = [] }: { before: unknown; after: unknown; members?: BusinessMember[]; themes?: BusinessTheme[] }) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  const left = before && typeof before === "object" ? before as Record<string, unknown> : {};
  const right = after && typeof after === "object" ? after as Record<string, unknown> : {};
  const labels: Record<string, string> = {
    name: c("名称", "名称"), description: c("説明", "说明"), themeId: c("所属テーマ", "所属主题"), assigneeIds: c("担当", "负责人"),
    status: c("状態", "状态"), plannedStartMonth: c("予定開始月", "计划开始月"), plannedEndMonth: c("予定終了月", "计划结束月"), targetMemo: c("目標時期メモ", "目标时间备注"),
    order: c("表示順", "显示顺序"), referenceLinks: c("参考資料", "参考资料"), milestones: c("節目", "里程碑"), archived: c("アーカイブ", "归档"),
    enabled: c("利用可能", "启用"), memberIds: c("共有メンバー", "共享成员"), sourceLocale: c("原文の言語", "原文语言")
  };
  function display(key: string, value: unknown): string {
    if (value === undefined || value === null || value === "") return "—";
    if (key === "themeId" && typeof value === "string") return themes.find(t => t.id === value)?.name || c("以前のテーマ", "之前的主题");
    if (key === "sourceLocale") return value === "ja" ? "日本語" : "中文";
    if (key === "status" && statuses.includes(value as never)) return statusLabel(value as BusinessInitiative["status"], locale);
    if ((key === "assigneeIds" || key === "memberIds") && Array.isArray(value)) return memberNames(value as string[], members, locale);
    if (key === "milestones" && Array.isArray(value)) return value.map(m => `${m.archived ? c("（保管）", "（归档）") : ""}${m.completed ? "✓ " : "○ "}${m.name}`).join(" / ") || "—";
    if (typeof value === "boolean") return value ? c("はい", "是") : c("いいえ", "否");
    if (Array.isArray(value)) return value.join(" / ") || "—";
    return String(value);
  }
  const keys = Object.keys(labels).filter(key => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
  return <dl className="business-comparison">{keys.map(key => <div key={key}><dt>{labels[key]}</dt><dd><span>{display(key, left[key])}</span><span aria-hidden="true"> → </span><strong>{display(key, right[key])}</strong></dd></div>)}</dl>;
}
function Conflict({ latest, draft, onSave, busy, members, themes }: { latest?: { version: number }; draft: { expectedVersion: number }; onSave: (version: number) => void; busy: boolean; members?: BusinessMember[]; themes?: BusinessTheme[] }) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  return <aside className="business-conflict" role="alert"><h3>{c("最新の内容と入力を確認", "核对最新内容与您的输入")}</h3>
    <p>{c("左が最新の保存内容、右が今回保存する内容です。確認してから再保存してください。", "左侧为最新保存内容，右侧为您将保存的内容。请核对后重新保存。")}</p>
    {latest && <BusinessComparison before={latest} after={draft} members={members} themes={themes} />}
    <button type="button" disabled={busy || !latest || ("archived" in latest && Boolean(latest.archived)) || latest.version <= draft.expectedVersion} onClick={() => latest && onSave(latest.version)}>{c("最新の版を基準に、この入力を保存", "基于最新版保存这些输入")}</button>
  </aside>;
}
function FormFooter({ busy, onCancel, label }: { busy: boolean; onCancel: () => void; label?: string }) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  return <div className="business-actions business-editor-footer"><button type="submit" className="business-primary" disabled={busy}>{busy ? c("保存中…", "保存中…") : label || c("保存", "保存")}</button><button type="button" disabled={busy} onClick={onCancel}>{c("キャンセル", "取消")}</button></div>;
}
function EditorForm({ title, label, busy, error, onSubmit, onCancel, children }: { title: string; label: string; busy: boolean; error: string; onSubmit: (event: FormEvent) => void; onCancel: () => void; children: ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  const showError = () => form.current?.querySelector<HTMLElement>("[role=alert]")?.scrollIntoView?.({ block: "nearest" });
  useEffect(() => {
    const element = form.current;
    if (!element) return;
    const viewport = window.visualViewport;
    const page = element.closest<HTMLElement>(".business-page");
    let first = true;
    let previousKeyboardSpace = 0;
    let previousWidth = window.innerWidth;
    const resize = () => {
      // Let pinch zoom keep its own pan position.
      if (viewport && viewport.scale !== 1) return;
      // Mobile keyboards can shrink the visual viewport without changing 100dvh.
      element.style.setProperty("--business-editor-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
      // Leave enough document space to bring the shorter editor above the keyboard.
      const keyboardSpace = Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight));
      page?.style.setProperty("--business-editor-keyboard-space", `${keyboardSpace}px`);
      // Ordinary browser toolbar height changes should not jump back to the editor.
      if (first || keyboardSpace !== previousKeyboardSpace || window.innerWidth !== previousWidth) element.scrollIntoView?.({ block: "start" });
      first = false; previousKeyboardSpace = keyboardSpace; previousWidth = window.innerWidth;
    };
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => { viewport?.removeEventListener("resize", resize); window.removeEventListener("resize", resize); page?.style.removeProperty("--business-editor-keyboard-space"); };
  }, []);
  useEffect(() => {
    if (error) showError();
  }, [error]);
  return <form ref={form} className="business-editor" onSubmit={event => { onSubmit(event); requestAnimationFrame(showError); }} aria-label={label}>
    <h2>{title}</h2>
    <div className="business-editor-scroll"><fieldset className="business-form-fields" disabled={busy}>{children}</fieldset></div>
    <FormFooter busy={busy} onCancel={onCancel} />
  </form>;
}
function linksFromText(text: string) { return text.split("\n").map(x => x.trim()).filter(Boolean); }
function validLinks(links: string[]) { return links.length <= 10 && links.every(link => safeBusinessLink(link)); }
function normalizeMilestoneOrders(rows: BusinessInitiativeInput["milestones"], activeIds?: string[]) {
  const active = activeIds || rows.filter(m => !m.archived).sort((a, b) => a.order - b.order).map(m => m.id);
  const reserved = new Set(rows.filter(m => m.archived).map(m => m.order));
  const orders = new Map<string, number>();
  let next = 0;
  for (const id of active) { while (reserved.has(next)) next += 1; orders.set(id, next); next += 1; }
  return rows.map(m => ({ ...m, order: orders.get(m.id) ?? m.order })).sort((a, b) => a.order - b.order);
}
export function ThemeEditor(props: Common & { theme?: BusinessTheme; latest?: BusinessTheme }) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  const initial: BusinessThemeInput = props.theme ? { id: props.theme.id, expectedVersion: props.theme.version, name: props.theme.name, description: props.theme.description, sourceLocale: props.theme.sourceLocale, order: props.theme.order, referenceLinks: props.theme.referenceLinks } : { id: newBusinessId(), expectedVersion: 0, name: "", description: "", sourceLocale: locale, order: 0, referenceLinks: [] };
  const e = useEditor(initial, saveBusinessTheme, props);
  const [links, setLinks] = useState(initial.referenceLinks.join("\n"));
  function submit(event: FormEvent) { event.preventDefault(); if (!validLinks(linksFromText(links))) { e.setError(c("参考資料は http または https のURLを10件以内で入力してください。", "请填写最多10个 http 或 https 参考资料网址。")); return; } void e.submit(); }
  return <EditorForm onSubmit={submit} label={c("テーマの編集", "编辑主题")} title={props.theme ? c("テーマを編集", "编辑主题") : c("テーマを追加", "添加主题")} busy={e.busy} error={e.error} onCancel={props.onCancel}>
    <label>{c("テーマ名", "主题名称")}<input required maxLength={200} value={e.draft.name} onChange={v => e.change({ name: v.target.value })} /></label>
    <label>{c("目的・説明", "目的与说明")}<textarea maxLength={10000} value={e.draft.description} onChange={v => e.change({ description: v.target.value })} rows={4} /></label>
    <LocaleInput value={e.draft.sourceLocale} onChange={sourceLocale => e.change({ sourceLocale })} />
    <label>{c("表示順（小さい順）", "显示顺序（从小到大）")}<input type="number" required min={0} max={10000} step={1} value={e.draft.order} onChange={v => e.change({ order: Number(v.target.value) })} /></label>
    <label>{c("参考資料リンク（1行に1件）", "参考资料链接（每行一个）")}<textarea value={links} onChange={v => { setLinks(v.target.value); e.change({ referenceLinks: linksFromText(v.target.value) }); }} rows={3} /></label>
    {e.error && <p role="alert" className="business-error">{e.error}</p>}
    {e.conflict && <Conflict latest={props.latest} draft={e.draft} busy={e.busy} onSave={version => void e.submit({ ...e.draft, expectedVersion: version })} />}
    {props.theme && <BusinessEntityHistory kind="theme" id={props.theme.id} onAccessError={props.onAccessError} />}
  </EditorForm>;
}
export function InitiativeEditor(props: Common & { initiative?: BusinessInitiative; latest?: BusinessInitiative; themes: BusinessTheme[]; members: BusinessMember[]; focusMilestones?: boolean }) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  const initial: BusinessInitiativeInput = props.initiative ? { id: props.initiative.id, expectedVersion: props.initiative.version, themeId: props.initiative.themeId, name: props.initiative.name, description: props.initiative.description, sourceLocale: props.initiative.sourceLocale, referenceLinks: props.initiative.referenceLinks, assigneeIds: props.initiative.assigneeIds, status: props.initiative.status, plannedStartMonth: props.initiative.plannedStartMonth, plannedEndMonth: props.initiative.plannedEndMonth, targetMemo: props.initiative.targetMemo, milestones: [...props.initiative.milestones].sort((a,b) => a.order-b.order).map(({ id, name, order, archived }) => ({ id, name, order, archived })) } : { id: newBusinessId(), expectedVersion: 0, themeId: props.themes.find(t => !t.archived)?.id || "", name: "", description: "", sourceLocale: locale, referenceLinks: [], assigneeIds: [], status: "not_started", plannedStartMonth: "", plannedEndMonth: "", targetMemo: "", milestones: [{ id: newBusinessId(), name: "", order: 0, archived: false }] };
  const e = useEditor(initial, saveBusinessInitiative, props);
  const [links, setLinks] = useState(initial.referenceLinks.join("\n"));
  const milestoneSection = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (!props.focusMilestones) return;
    const frame = requestAnimationFrame(() => milestoneSection.current?.scrollIntoView?.({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [props.focusMilestones]);
  function valid(draft = e.draft) {
    const active = draft.milestones.filter(m => !m.archived);
    if (active.length < 1 || active.length > 3) { e.setError(c("節目は1〜3件にしてください。", "请将里程碑设为1至3项。")); return false; }
    if (active.some(m => !m.name.trim())) { e.setError(c("節目の名前を入力してください。", "请填写里程碑名称。")); return false; }
    const { plannedStartMonth: start, plannedEndMonth: end } = e.draft;
    if ((start || end) && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(start) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(end) || start > end)) { e.setError(c("予定開始月と終了月を両方設定し、開始月以降を終了月にしてください。", "请同时填写计划开始月和结束月，且结束月不能早于开始月。")); return false; }
    if (!validLinks(linksFromText(links))) { e.setError(c("参考資料は http または https のURLを10件以内で入力してください。", "请填写最多10个 http 或 https 参考资料网址。")); return false; }
    return true;
  }
  function submit(event: FormEvent) { event.preventDefault(); if (valid(e.draft)) void e.submit(); }
  const activeMilestones = e.draft.milestones.filter(m => !m.archived);
  const archivedMilestones = e.draft.milestones.filter(m => m.archived);
  function milestoneChange(id: string, patch: Partial<BusinessInitiativeInput["milestones"][number]>) { if (patch.archived === false && activeMilestones.length >= 3) return; e.change({ milestones: e.draft.milestones.map(m => m.id === id ? { ...m, ...patch } : m) }); }
  function removeMilestone(id: string) {
    if (props.initiative?.milestones.some(m => m.id === id) || props.latest?.milestones.some(m => m.id === id)) milestoneChange(id, { archived: true });
    else e.change({ milestones: e.draft.milestones.filter(m => m.id !== id) });
  }
  function move(id: string, by: number) {
    const index = activeMilestones.findIndex(m => m.id === id);
    const other = activeMilestones[index + by];
    if (index < 0 || !other) return;
    const orderedIds = activeMilestones.map(m => m.id);
    [orderedIds[index], orderedIds[index + by]] = [orderedIds[index + by], orderedIds[index]];
    e.change({ milestones: normalizeMilestoneOrders(e.draft.milestones, orderedIds) });
  }
  const addedElsewhere = (props.latest?.milestones || []).filter(m => !e.draft.milestones.some(local => local.id === m.id)).map(({ id, name, order, archived }) => ({ id, name, order, archived }));
  const conflictDraft = { ...e.draft, milestones: addedElsewhere.length ? normalizeMilestoneOrders([...e.draft.milestones, ...addedElsewhere]) : e.draft.milestones };
  return <EditorForm onSubmit={submit} label={c("取り組みの編集", "编辑工作")} title={props.initiative ? c("取り組みを編集", "编辑工作") : c("取り組みを追加", "添加工作")} busy={e.busy} error={e.error} onCancel={props.onCancel}>
    <fieldset><legend>{c("担当者（複数可・未選択は担当未定）", "负责人（可多选，未选择为待定）")}</legend>{props.members.map(m => <label className="business-check" key={m.uid}><input type="checkbox" checked={e.draft.assigneeIds.includes(m.uid)} onChange={v => e.change({ assigneeIds: v.target.checked ? [...e.draft.assigneeIds, m.uid] : e.draft.assigneeIds.filter(id => id !== m.uid) })} />{m.displayName}</label>)}</fieldset>
    <label>{c("所属テーマ", "所属主题")}<select required value={e.draft.themeId} onChange={v => e.change({ themeId: v.target.value })}><option value="">{c("テーマを選択", "选择主题")}</option>{props.themes.filter(t => !t.archived || t.id === e.draft.themeId).map(t => <option key={t.id} value={t.id}>{t.name}{t.archived ? c("（アーカイブ）", "（归档）") : ""}</option>)}</select></label>
    <label>{c("取り組み名", "工作名称")}<input required maxLength={200} value={e.draft.name} onChange={v => e.change({ name: v.target.value })} /></label>
    <label>{c("説明", "说明")}<textarea maxLength={10000} value={e.draft.description} onChange={v => e.change({ description: v.target.value })} rows={4} /></label>
    <LocaleInput value={e.draft.sourceLocale} onChange={sourceLocale => e.change({ sourceLocale })} />
    <label>{c("状態", "状态")}<select value={e.draft.status} onChange={v => e.change({ status: v.target.value as BusinessInitiative["status"] })}>{statuses.map(status => <option key={status} value={status}>{statusLabel(status, locale)}</option>)}</select></label>
    <div className="business-form-grid"><label>{c("予定開始月", "计划开始月")}<input type="month" min="1900-01" max="2199-12" value={e.draft.plannedStartMonth} onChange={v => e.change({ plannedStartMonth: v.target.value })} /></label><label>{c("予定終了月", "计划结束月")}<input type="month" min="1900-01" max="2199-12" value={e.draft.plannedEndMonth} onChange={v => e.change({ plannedEndMonth: v.target.value })} /></label></div>
    <label>{c("目標時期のメモ", "目标时间备注")}<input maxLength={1000} placeholder={c("9月末、先方回答後など", "例如9月底、收到回复后")} value={e.draft.targetMemo} onChange={v => e.change({ targetMemo: v.target.value })} /></label>
    <fieldset ref={milestoneSection}><legend>{c(`節目（1〜3件・現在${activeMilestones.length}件）`, `里程碑（1至3项，当前${activeMilestones.length}项）`)}</legend>
      <p className="business-muted">{c("節目の名前と順番を変更できます。完了のチェックと取り組みの状態は詳細画面で別々に更新します。", "可修改里程碑名称和顺序。完成勾选与工作状态可在详情中分别更新。")}</p>
      {activeMilestones.map((m, index) => <div className="business-milestone-editor" key={m.id}><label>{c("節目", "里程碑")} {index + 1}<input required maxLength={200} value={m.name} onChange={v => milestoneChange(m.id, { name: v.target.value })} /></label><div className="business-actions"><button type="button" disabled={index === 0} aria-label={c(`${m.name || "節目"}を上へ`, `${m.name || "里程碑"}上移`)} onClick={() => move(m.id, -1)}>↑</button><button type="button" disabled={index === activeMilestones.length - 1} aria-label={c(`${m.name || "節目"}を下へ`, `${m.name || "里程碑"}下移`)} onClick={() => move(m.id, 1)}>↓</button><button type="button" onClick={() => removeMilestone(m.id)}>{props.initiative?.milestones.some(saved => saved.id === m.id) || props.latest?.milestones.some(saved => saved.id === m.id) ? c("節目を外す", "移除里程碑") : c("節目を削除", "删除里程碑")}</button></div></div>)}
      <button type="button" disabled={activeMilestones.length >= 3 || e.draft.milestones.length >= 100} onClick={() => e.change({ milestones: [...e.draft.milestones, { id: newBusinessId(), name: "", order: Math.min(10000, Math.max(-1, ...e.draft.milestones.map(m => m.order)) + 1), archived: false }] })}>{c("節目を追加", "添加里程碑")}</button>
      {e.draft.milestones.length >= 100 && <p className="business-muted">{c("保管中を含め100件に達したため、新しい節目は追加できません。", "包含已归档项在内已达到100项，无法再添加新里程碑。")}</p>}
      {archivedMilestones.length > 0 && <details className="business-archived-milestones"><summary>{c(`保管中の節目（${archivedMilestones.length}件）`, `已归档里程碑（${archivedMilestones.length}项）`)}</summary><p className="business-muted">{c("外した節目は履歴として保管します。3件以内なら復元できます。", "移除的里程碑会保留在历史记录中，未满3项时可恢复。")}</p>{archivedMilestones.map(m => <div className="business-milestone-editor" key={m.id}><span>{m.name || c("名称未入力の節目", "未命名里程碑")}</span><button type="button" disabled={activeMilestones.length >= 3} onClick={() => milestoneChange(m.id, { archived: false })}>{c("節目を復元", "恢复里程碑")}</button></div>)}</details>}
    </fieldset>
    <label>{c("参考資料リンク（1行に1件）", "参考资料链接（每行一个）")}<textarea value={links} onChange={v => { setLinks(v.target.value); e.change({ referenceLinks: linksFromText(v.target.value) }); }} rows={3} /></label>
    {e.error && <p role="alert" className="business-error">{e.error}</p>}
    {e.conflict && <>{addedElsewhere.length > 0 && <div className="business-notice"><p>{c("他の方が追加した節目も保持します。合わせて3件を超える場合は、追加分を取り込んで節目を外してください。", "将保留其他成员新增的里程碑。合计超过3项时，请导入新增项并移除一项里程碑。")}</p><button type="button" onClick={() => e.change({ milestones: conflictDraft.milestones })}>{c("追加分を取り込む", "导入新增项")}</button></div>}<Conflict latest={props.latest} draft={conflictDraft} busy={e.busy} members={props.members} themes={props.themes} onSave={version => { if (valid(conflictDraft)) void e.submit({ ...conflictDraft, expectedVersion: version }); }} /></>}
  </EditorForm>;
}
export function MembersEditor(props: Common & { settings: BusinessSettings; candidates: BusinessMember[]; uid: string }) {
  const { locale } = useI18n(); const c = businessCopy(locale);
  const e = useEditor({ expectedVersion: props.settings.version, enabled: props.settings.enabled, memberIds: [...props.settings.memberIds] }, saveBusinessSettings, props);
  function submit(event: FormEvent) {
    event.preventDefault();
    const members = props.candidates.filter(m => e.draft.memberIds.includes(m.uid));
    if (members.length !== 3 || !members.some(m => m.uid === props.uid) || !members.some(m => m.role === "employee_manager") || !members.some(m => m.role === "president_viewer")) { e.setError(c("自分・管理担当者・社長を含む3人を選んでください。", "请选择包括您自己、管理员和社长在内的3位成员。")); return; }
    void e.submit();
  }
  return <EditorForm onSubmit={submit} label={c("共有メンバーの設定", "设置共享成员")} title={c("共有メンバー", "共享成员")} busy={e.busy} error={e.error} onCancel={props.onCancel}><p>{c("管理担当者と社長は、この機能で同じ管理権限を持ちます。新しいアカウントは自動で追加されません。", "管理员和社长在此功能中拥有相同的管理权限。新账号不会自动加入。")}</p>
    <fieldset><legend>{c(`共有する3人（現在${e.draft.memberIds.length}人）`, `共享的3位成员（当前${e.draft.memberIds.length}位）`)}</legend>{props.candidates.filter(m => m.active).map(m => <label className="business-check" key={m.uid}><input type="checkbox" checked={e.draft.memberIds.includes(m.uid)} onChange={v => e.change({ memberIds: v.target.checked ? [...e.draft.memberIds, m.uid] : e.draft.memberIds.filter(id => id !== m.uid) })} /><span>{m.displayName}<small>{m.role === "employee" ? c("閲覧・近況投稿・担当分の更新", "查看、发布动态、更新负责的工作") : c("この機能の管理", "管理此功能")}</small></span></label>)}</fieldset>
    <label className="business-check"><input type="checkbox" checked={e.draft.enabled} onChange={v => e.change({ enabled: v.target.checked })} />{c("この3人で「会社の取り組み」を利用する", "为这3位成员启用公司重点工作")}</label><p className="business-muted">{c("チェックを外して保存すると利用を停止します。登録内容は削除されません。", "取消勾选并保存将暂停此功能，已保存内容不会删除。")}</p>
    {e.error && <p role="alert" className="business-error">{e.error}</p>}
    {e.conflict && <Conflict latest={props.settings} draft={e.draft} busy={e.busy} members={props.candidates} onSave={version => void e.submit({ ...e.draft, expectedVersion: version })} />}
    {props.settings.version > 0 && <BusinessEntityHistory kind="settings" id="current" members={props.candidates} onAccessError={props.onAccessError} />}
  </EditorForm>;
}
