import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CheckCheck, CircleCheck, ChevronDown, ClipboardList, FilePlus2, Plus, RefreshCw, Save, Send } from "lucide-react";
import { useI18n } from "../../i18n";
import type { Locale, UserProfile } from "../../types";
import { addDays, mondayOf } from "./calendar";
import { addWeeklyTodoToDailyReport, getWeeklyTodoHistory, getWeeklyTodoWorkspace, saveWeeklyTodoDraft, shareWeeklyTodo, shareWeeklyTodoReview, todoError, translateWeeklyTodoContent } from "./api";
import type { TodoHistory, TodoItem, TodoSnapshot, TodoTranslation, TodoWeek, TodoWorkspace } from "./types";
import "./weeklyTodo.css";

type TranslationCache = Map<string, Promise<TodoTranslation>>;
const TranslationContext = createContext<TranslationCache>(new Map());
const copy = (locale: Locale) => (ja: string, zh: string) => locale === "ja" ? ja : zh;
const dateTime = (at: number, locale: Locale) => new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "zh-CN", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(at);
const sourceKey = (item: TodoItem) => item.carriedFrom ? `${item.carriedFrom.weekStart}:${item.carriedFrom.itemId}` : "";
const newItem = (locale: Locale): TodoItem => ({ id: crypto.randomUUID(), title: "", goal: "", progress: 0, memo: "", sourceLocale: locale, memoLocale: locale, withdrawn: false });
const reportContent = (item: TodoItem) => JSON.stringify([item.title.trim(), item.goal.trim(), item.progress, item.memo.trim()]);

type PageProps = { profile: UserProfile; onOpenReport?: (date: string) => void };
export function WeeklyTodoPage({ profile, onOpenReport }: PageProps) {
  const cache = useMemo<TranslationCache>(() => new Map(), [profile.uid]);
  return <TranslationContext.Provider value={cache}><WeeklyTodoContent key={profile.uid} profile={profile} onOpenReport={onOpenReport} /></TranslationContext.Provider>;
}
function WeeklyTodoContent({ profile, onOpenReport }: PageProps) {
  const { locale } = useI18n(); const c = copy(locale);
  const [week, setWeek] = useState(mondayOf); const [workspace, setWorkspace] = useState<TodoWorkspace>();
  const [items, setItems] = useState<TodoItem[]>([]); const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(""); const [feedback, setFeedback] = useState(""); const [conflict, setConflict] = useState(false);
  const [selectedCarry, setSelectedCarry] = useState<string[]>([]);
  const [addedReportDate, setAddedReportDate] = useState("");
  const [view, setView] = useState<"shared" | "editor">("shared");
  const [selectedMember, setSelectedMember] = useState("");
  const [focusItem, setFocusItem] = useState("");
  const editorRef = useRef<HTMLElement>(null);
  const titleInputs = useRef(new Map<string, HTMLInputElement>());
  const active = useRef(true); const dirtyRef = useRef(false); const busyRef = useRef(false); const serial = useRef(0); const localeRef = useRef(locale); localeRef.current = locale;
  const markDirty = (value: boolean) => { dirtyRef.current = value; setDirty(value); };
  const members = useMemo(() => {
    const order = { president_viewer: 0, employee_manager: 1, employee: 2 };
    return [...(workspace?.members || [])].sort((a, b) => order[a.role] - order[b.role] || a.displayName.localeCompare(b.displayName, "ja") || a.uid.localeCompare(b.uid));
  }, [workspace?.members]);
  const member = members.find(row => row.uid === selectedMember) || members[0];
  useEffect(() => {
    if (view !== "editor" || !focusItem) return;
    const input = titleInputs.current.get(focusItem);
    if (input) { input.focus({ preventScroll: true }); input.scrollIntoView?.({ block: "center" }); }
    else if (focusItem === "@editor") editorRef.current?.scrollIntoView?.({ block: "start" });
    setFocusItem("");
  }, [view, focusItem, items]);
  function openEditor() {
    setView("editor"); setFocusItem("@editor");
  }
  function addItem() {
    if (busyRef.current || conflict || items.length >= 30) return;
    const item = newItem(locale);
    setItems(rows => [...rows, item]); setView("editor"); setFocusItem(item.id); markDirty(true); setFeedback("");
  }
  const load = useCallback(async () => {
    const sequence = ++serial.current;
    try {
      const next = await getWeeklyTodoWorkspace(week);
      if (!active.current || sequence !== serial.current) return;
      setWorkspace(next);
      if (!dirtyRef.current && !busyRef.current) { setItems(next.ownDraft?.items || []); setVersion(next.ownDraft?.version || 0); }
    } catch (caught) {
      if (!active.current || sequence !== serial.current) return;
      setError(todoError(caught, localeRef.current));
      const code = caught && typeof caught === "object" && "code" in caught ? String(caught.code) : "";
      if (/permission-denied|unauthenticated|failed-precondition/.test(code)) setWorkspace(undefined);
    } finally { if (active.current && sequence === serial.current) setLoading(false); }
  }, [week]);
  useEffect(() => {
    active.current = true; void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && !busyRef.current) void load(); }, 30000);
    const focus = () => { if (!busyRef.current) void load(); };
    const visibility = () => { if (document.visibilityState === "visible") focus(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", visibility);
    return () => { active.current = false; serial.current++; window.clearInterval(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); };
  }, [load]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current || busyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    const guard = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest(".weekly-todo-page")) return;
      const button = event.target.closest(".sidebar nav button:not(.active), .bottom-nav button:not(.active), .account-switch-button");
      if (!button) return;
      if (busyRef.current || (dirtyRef.current && !window.confirm(copy(localeRef.current)("未保存の入力があります。破棄して移動しますか？", "有未保存的输入。要放弃并离开吗？")))) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", guard, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", guard, true); };
  }, []);
  function move(next: string) {
    if (busyRef.current || (dirtyRef.current && !window.confirm(c("未保存の入力があります。破棄して週を切り替えますか？", "有未保存的输入。要放弃并切换周吗？")))) return;
    markDirty(false); setWorkspace(undefined); setItems([]); setSelectedCarry([]); setConflict(false); setError(""); setFeedback(""); setAddedReportDate(""); setLoading(true); setWeek(next);
  }
  function update(id: string, patch: Partial<TodoItem>) { setItems(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row)); markDirty(true); setFeedback(""); }
  async function save(kind: "draft" | "share" | "review") {
    if (busyRef.current || !workspace || conflict) return;
    if (kind !== "draft" && (!items.length || items.some(item => !item.title.trim() || !item.goal.trim()))) { setError(c("各項目の業務と金曜日までの目標を入力してください。", "请填写各项业务和周五前目标。")); setView("editor"); setFocusItem(items.find(item => !item.title.trim() || !item.goal.trim())?.id || ""); return; }
    if (kind === "review" && items.some(item => !item.memo.trim())) { setError(c("各項目の実績・残ったことを入力してください。", "请填写各项实绩与未完成事项。")); return; }
    busyRef.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      const operation = kind === "draft" ? saveWeeklyTodoDraft : kind === "share" ? shareWeeklyTodo : shareWeeklyTodoReview;
      const result = await operation({ weekStart: week, expectedVersion: version, operationId: crypto.randomUUID(), items });
      if (!active.current) return;
      setVersion(result.version); markDirty(false);
      setFeedback(kind === "draft" ? c("下書きを保存しました。本人だけが閲覧できます。", "草稿已保存，仅本人可见。") : kind === "review" ? c("今週の振り返りを共有しました。", "本周回顾已共享。") : c("予定・進捗を共有しました。", "计划与进度已共享。"));
    } catch (caught) {
      if (!active.current) return;
      markDirty(true); setError(todoError(caught, locale));
      const code = caught && typeof caught === "object" && "code" in caught ? String(caught.code) : "";
      if (code.includes("aborted")) setConflict(true);
    } finally {
      busyRef.current = false;
      if (active.current) { setBusy(false); await load(); }
    }
  }
  async function addToReport(item: TodoItem) {
    if (busyRef.current || conflict || !workspace?.reportLink) return;
    if (!item.title.trim() || !item.goal.trim()) { setError(c("業務と金曜日までの目標を入力してください。", "请填写业务和周五前目标。")); return; }
    busyRef.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      let expectedVersion = version;
      if (dirtyRef.current) {
        const saved = await saveWeeklyTodoDraft({ weekStart: week, expectedVersion, operationId: crypto.randomUUID(), items });
        if (!active.current) return;
        expectedVersion = saved.version; setVersion(saved.version); markDirty(false);
      }
      const result = await addWeeklyTodoToDailyReport({ weekStart: week, itemId: item.id, expectedVersion, reportDate: workspace.reportLink.reportDate });
      if (!active.current) return;
      setAddedReportDate(result.reportDate);
      setFeedback(c(`${result.reportDate}の「今日の業務メモ」に${result.alreadyAdded ? "追加済みです" : "追加しました"}。日報の作成時に利用できます。`, `已添加到${result.reportDate}的“今天的工作记录”，可用于编写日报。`));
    } catch (caught) {
      if (!active.current) return;
      setError(todoError(caught, locale));
      if (caught && typeof caught === "object" && "code" in caught && String(caught.code).includes("aborted")) { markDirty(true); setConflict(true); }
    } finally {
      busyRef.current = false;
      if (active.current) { setBusy(false); await load(); }
    }
  }
  function reportAction(item: TodoItem) {
    if (profile.role === "president_viewer" || !workspace?.reportLink || week !== mondayOf() || item.withdrawn) return null;
    const saved = workspace.ownDraft?.items.find(row => row.id === item.id);
    const changed = Boolean(saved && reportContent(saved) !== reportContent(item));
    const action = workspace.reportLink.items.find(row => row.itemId === item.id);
    if (!changed && !action && item.progress === 0 && !item.memo.trim()) return null;
    const added = action?.added && !changed;
    return <button type="button" className={`todo-report-button${added ? " added" : ""}`} disabled={busy || conflict || added} onClick={() => void addToReport(item)}><FilePlus2 size={16} />{added ? c("本日の日報に追加済み", "已添加到今日日报") : c("本日の日報に追加", "添加到今日日报")}</button>;
  }
  function carry() {
    const existing = new Set(items.map(sourceKey));
    const additions = (workspace?.carryover || []).filter(item => selectedCarry.includes(item.id) && !existing.has(sourceKey(item))).map(item => ({ ...item, id: crypto.randomUUID(), progress: 0, memo: "", memoLocale: locale, withdrawn: false }));
    if (items.length + additions.length > 30) { setError(c("項目は30件までです。", "最多可添加30项。")); return; }
    setItems(rows => [...rows, ...additions]); setSelectedCarry([]); markDirty(true);
  }
  const own = workspace?.weeks.find(row => row.userId === profile.uid);
  return <main className="page weekly-todo-page">
    <header className="todo-heading"><div><span className="eyebrow">WEEKLY TO DO</span><h1>{c("今週のTo Do", "本周待办")}</h1><p>{c("月曜に予定を共有し、金曜までの目標と進み具合を確認します。", "周一共享计划，确认周五前的目标与进度。")}</p></div><ClipboardList size={34} aria-hidden="true" /></header>
    <div className="todo-week-nav"><button type="button" disabled={busy} onClick={() => move(addDays(week, -7))}><ArrowLeft size={17} />{c("前週", "上周")}</button><div><strong>{week} 〜 {addDays(week, 6)}</strong><span>{c("目標日：", "目标日：")}{addDays(week, 4)}{c("（金）", "（周五）")}</span></div><button type="button" disabled={busy} onClick={() => move(addDays(week, 7))}>{c("翌週", "下周")}<ArrowRight size={17} /></button><button type="button" disabled={busy} onClick={() => move(mondayOf())}>{c("今週", "本周")}</button><button type="button" disabled={busy} onClick={() => { setError(""); void load(); }}><RefreshCw size={16} />{c("再読み込み", "刷新")}</button></div>
    {error && !workspace && <p className="todo-error" role="alert">{error}</p>}
    {loading && <p role="status">{c("週間予定を読み込み中…", "正在加载周计划…")}</p>}
    {workspace && <>
      <div className="todo-view-switch" role="group" aria-label={c("表示の切り替え", "切换显示")}>
        <button type="button" aria-pressed={view === "shared"} aria-controls="todo-shared-panel" onClick={() => setView("shared")}>{c("みんなの予定", "大家的计划")}</button>
        <button type="button" aria-pressed={view === "editor"} aria-controls="todo-editor-panel" onClick={() => setView("editor")}>{c("自分の入力", "填写我的计划")}{dirty && <span className="todo-draft-indicator">{c("未保存", "未保存")}</span>}</button>
      </div>
      <section id="todo-shared-panel" className="todo-shared-section" hidden={view !== "shared"} aria-labelledby="todo-shared-title"><h2 id="todo-shared-title">{c("みんなの予定・進捗", "大家的计划与进度")}</h2>
        <p className="todo-member-hint">{c("名前を選ぶと、その人の予定を一覧で確認できます。", "选择姓名，查看该成员的计划列表。")}</p>
        <div className="todo-member-picker" role="group" aria-label={c("予定を見るメンバー", "选择成员查看计划")}>{members.map(person => {
          const row = workspace.weeks.find(record => record.userId === person.uid);
          return <button type="button" key={person.uid} aria-pressed={member?.uid === person.uid} aria-controls="todo-selected-member" onClick={() => setSelectedMember(person.uid)}><strong>{person.displayName}</strong><span>{row ? c("共有済み", "已共享") : c("予定未共有", "计划尚未共享")}</span></button>;
        })}</div>
        <div id="todo-selected-member">{member && <SharedWeek key={`${week}:${member.uid}`} row={workspace.weeks.find(record => record.userId === member.uid)} userId={member.uid} week={week} name={member.displayName} />}</div>
      </section>
      <section id="todo-editor-panel" ref={editorRef} hidden={view !== "editor"} className="card todo-editor" aria-labelledby="todo-editor-title" aria-busy={busy}>
        <header><h2 id="todo-editor-title">{c("自分の予定・進捗を入力", "填写自己的计划与进度")}</h2><p>{c("下書きは自分だけに表示されます。共有ボタンを押すと全員に反映します。100％は今週の到達目標を達成した状態です。", "草稿仅本人可见，点击共享后所有成员可见。100％表示已达到本周目标。")}</p></header>
        {workspace.reportLink && <p className="todo-report-help">{c("業務を更新すると「本日の日報に追加」を使えます。追加時にTo Doを下書き保存し、日報の「今日の業務メモ」に追加します。", "更新业务后可使用“添加到今日日报”。添加时会保存待办草稿，并添加到日报的“今天的工作记录”。")}</p>}
        {conflict && <div className="todo-conflict" role="alert"><strong>{c("最新の下書きと入力内容を比較してください", "请比较最新草稿与当前输入")}</strong><ul>{workspace.ownDraft?.items.map(item => <li key={item.id}>{item.title || c("業務名未入力", "业务名称未填写")}：{item.goal} / {item.progress}％ / {item.memo}</li>)}</ul><button type="button" onClick={() => { setVersion(workspace.ownDraft?.version || 0); setConflict(false); setError(""); }}>{c("比較したので、この入力を保持して編集を続ける", "已比较，保留当前输入并继续编辑")}</button></div>}
        <fieldset disabled={busy || conflict} className="todo-fields">
          {items.length === 0 && <p className="todo-empty">{c("「業務を追加」から今週の予定を入力してください。", "请点击“添加业务”填写本周计划。")}</p>}
          {items.map((item, index) => <TodoItemPanel key={item.id} item={item} title={item.title} className="todo-item-editor">
            <div className="todo-item-top"><strong>{c("業務", "业务")} {index + 1}</strong>{item.carriedFrom && <small>{c("前週から引き継ぎ", "从上周结转")}</small>}{reportAction(item)}<button type="button" className="todo-text-button" onClick={() => {
              if (own?.shared.items.some(old => old.id === item.id)) update(item.id, { withdrawn: !item.withdrawn });
              else { setItems(rows => rows.filter(row => row.id !== item.id)); markDirty(true); }
            }}>{own?.shared.items.some(old => old.id === item.id) ? item.withdrawn ? c("取り下げを戻す", "恢复") : c("取り下げる", "撤回") : c("削除", "删除")}</button></div>
            <label>{c("取り組む業務", "开展的业务")}<input ref={input => { if (input) titleInputs.current.set(item.id, input); else titleInputs.current.delete(item.id); }} maxLength={200} value={item.title} onChange={event => update(item.id, { title: event.target.value, sourceLocale: locale })} /></label>
            <label>{c("金曜日までの到達目標", "周五前的目标")}<textarea rows={2} maxLength={2000} value={item.goal} onChange={event => update(item.id, { goal: event.target.value, sourceLocale: locale })} /></label>
            <div className="todo-progress-input"><label>{c("進捗率（％）", "进度（％）")}<input type="number" min={0} max={100} step={1} value={item.progress} onChange={event => update(item.id, { progress: Math.max(0, Math.min(100, Math.round(Number(event.target.value)))) })} /></label><progress max={100} value={item.progress} aria-label={c("進捗率", "进度")} /></div>
            <label>{c("実績・残ったこと", "实绩与未完成事项")}<textarea rows={3} maxLength={4000} value={item.memo} onChange={event => update(item.id, { memo: event.target.value, memoLocale: locale })} /></label>
            {item.withdrawn && <p>{c("この項目は取り下げとして共有されます。理由を実績欄に記入してください。", "此项将作为撤回共享，请在实绩栏填写原因。")}</p>}
          </TodoItemPanel>)}
          {(workspace.carryover.length > 0) && <details className="todo-carry"><summary>{c("前週の未完了項目から選んで追加", "选择上周未完成事项并添加")}</summary>{workspace.carryover.map(item => {
            const included = items.some(row => sourceKey(row) === sourceKey(item));
            return <label className="todo-check" key={item.id}><input type="checkbox" disabled={included} checked={included || selectedCarry.includes(item.id)} onChange={event => setSelectedCarry(rows => event.target.checked ? [...rows, item.id] : rows.filter(id => id !== item.id))} /><span>{item.title}（{item.progress}％）{included && c("・追加済み", "・已添加")}</span></label>;
          })}<button type="button" disabled={!selectedCarry.length} onClick={carry}>{c("選んだ項目を下書きへ追加", "将所选事项添加到草稿")}</button><p>{c("引き継いだ目標を今週に合わせて見直してください。", "请根据本周安排调整结转目标。")}</p></details>}
        </fieldset>
        {error && <p className="todo-error" role="alert">{error}</p>}{feedback && <p className="todo-feedback" role="status">{feedback}</p>}{addedReportDate && onOpenReport && <button type="button" disabled={busy || dirty || conflict} onClick={() => onOpenReport(addedReportDate)}>{c(`${addedReportDate}の日報を開く`, `打开${addedReportDate}的日报`)}</button>}
        <div className="todo-save-actions"><button type="button" className="todo-review-button" disabled={busy || conflict || !items.length} onClick={() => void save("review")}><CheckCheck size={17} />{c("今週の振り返りを共有", "共享本周回顾")}</button></div>
      </section>
      {view === "shared" && error && <p className="todo-error" role="alert">{error}</p>}
      {view === "shared" && feedback && <p className="todo-feedback" role="status">{feedback}</p>}
      {view === "shared" && conflict && <p className="todo-conflict" role="alert">{c("自分の入力に戻り、最新の下書きと比較してください。", "请返回我的计划，比较最新草稿。")}</p>}
      <div className="todo-action-dock" role="group" aria-label={c("予定の追加・保存", "添加与保存计划")}>
        <span className="todo-dock-status">{busy ? c("保存中…", "正在保存…") : dirty ? c("未保存の入力があります", "有未保存的输入") : view === "editor" ? c("下書きは本人のみ閲覧可能", "草稿仅本人可见") : c("自分の予定はこちらから入力", "从这里填写自己的计划")}</span>
        <button type="button" className={view === "shared" ? "todo-primary" : ""} disabled={busy || conflict || items.length >= 30} onClick={addItem}><Plus size={17} />{c("業務を追加", "添加业务")}{items.length >= 30 && c("（30件まで）", "（最多30项）")}</button>
        {view === "shared" ? <button type="button" onClick={openEditor}>{c("自分の入力へ", "填写我的计划")}</button> : <>
          <button type="button" disabled={busy || conflict} onClick={() => void save("draft")}><Save size={17} />{c("下書き保存", "保存草稿")}</button>
          <button type="button" className="todo-primary" disabled={busy || conflict || !items.length} onClick={() => void save("share")}><Send size={17} />{own ? c("変更を共有", "共享修改") : c("共有する", "共享")}</button>
        </>}
      </div>
    </>}
  </main>;
}

function TodoItemPanel({ item, title, className, children }: { item: TodoItem; title: string; className: string; children: ReactNode }) {
  const { locale } = useI18n(); const c = copy(locale);
  if (item.progress !== 100 || item.withdrawn) return <article className={`${className}${item.withdrawn ? " withdrawn" : ""}`}>{children}</article>;
  return <details className={`${className} todo-completed`}>
    <summary>
      <span className="todo-completed-title">{title || item.goal || c("業務名未入力", "业务名称未填写")}</span>
      <span className="todo-completed-badge"><CircleCheck size={17} aria-hidden="true" />{c("完了", "已完成")}</span>
      <ChevronDown className="todo-completed-chevron" size={18} aria-hidden="true" />
    </summary>
    <div className="todo-completed-content">{children}</div>
  </details>;
}

function SharedWeek({ row, name, userId, week }: { row?: TodoWeek; name: string; userId: string; week: string }) {
  const { locale } = useI18n(); const c = copy(locale);
  return <article className="card todo-member"><header><h3>{name}</h3><span className={`todo-status ${row ? "shared" : ""}`}>{row ? c("共有済み", "已共享") : c("予定未共有", "计划尚未共享")}</span></header>
    {!row ? <p className="todo-empty">{c("この週の予定はまだ共有されていません。", "本周计划尚未共享。")}</p> : <>
      <p className="todo-updated">{c("最終共有：", "最近共享：")}{dateTime(row.shared.at, locale)}</p>
      <p className="todo-review-status">{row.review ? row.reviewRevision === row.shared.revision ? c("振り返り共有済み", "回顾已共享") : c("振り返り共有後に更新あり", "共享回顾后有更新") : c("振り返り未共有", "回顾尚未共享")}{row.review && ` · ${dateTime(row.review.at, locale)}`}</p>
      <SnapshotView snapshot={row.shared} userId={userId} week={week} />
      <details><summary>{c("最初に共有した目標", "最初共享的目标")}</summary><SnapshotView snapshot={row.initial} userId={userId} week={week} /></details>
      {row.review && <details><summary>{c("共有した振り返り", "已共享的回顾")}</summary><SnapshotView snapshot={row.review} userId={userId} week={week} /></details>}
      <HistoryView key={row.shared.revision} week={week} userId={userId} revision={row.shared.revision} />
    </>}
  </article>;
}
function SnapshotView({ snapshot, userId, week }: { snapshot: TodoSnapshot; userId: string; week: string }) {
  const { locale } = useI18n(); const c = copy(locale); const cache = useContext(TranslationContext);
  const [translation, setTranslation] = useState<TodoTranslation>(); const [error, setError] = useState(false); const [original, setOriginal] = useState(false); const [attempt, setAttempt] = useState(0);
  const needsTranslation = snapshot.items.some(item => (item.sourceLocale !== locale && (item.title || item.goal)) || (item.memoLocale !== locale && item.memo));
  const key = JSON.stringify([week, userId, snapshot.contentVersion, locale]);
  useEffect(() => {
    let active = true; setTranslation(undefined); setError(false);
    if (!needsTranslation) return;
    let pending = cache.get(key);
    if (!pending) { pending = translateWeeklyTodoContent({ weekStart: week, userId, contentVersion: snapshot.contentVersion, revision: snapshot.revision, targetLocale: locale }); cache.set(key, pending); }
    void pending.then(result => {
      if (active && result.contentVersion === snapshot.contentVersion && result.targetLocale === locale) setTranslation(result);
      else if (active) setError(true);
    }).catch(() => { if (active) setError(true); if (cache.get(key) === pending) cache.delete(key); });
    return () => { active = false; };
  }, [key, needsTranslation, cache, week, userId, snapshot.contentVersion, snapshot.revision, locale, attempt]);
  const fields = translation?.contentVersion === snapshot.contentVersion && translation.targetLocale === locale && !original ? translation.fields : undefined;
  const text = (item: TodoItem, field: "title" | "goal" | "memo") => fields?.[`${item.id}:${field}`] ?? item[field];
  return <div className="todo-snapshot">
    {needsTranslation && <div className="todo-translation-tools">{translation ? <button type="button" onClick={() => setOriginal(value => !value)}>{original ? c("翻訳を表示", "显示译文") : c("原文を表示", "显示原文")}</button> : error ? <><small>{c("翻訳できませんでした・原文を表示", "翻译失败・显示原文")}</small><button type="button" onClick={() => { cache.delete(key); setAttempt(value => value + 1); }}>{c("翻訳を再試行", "重试翻译")}</button></> : <small>{c("翻訳中・原文を表示", "翻译中・显示原文")}</small>}</div>}
    {snapshot.items.map(item => <TodoItemPanel key={item.id} item={item} title={text(item, "title")} className="todo-shared-item"><h4>{text(item, "title")}{item.withdrawn && <span className="todo-status">{c("取り下げ", "已撤回")}</span>}</h4><p><strong>{c("金曜までの目標", "周五前目标")}</strong>{text(item, "goal")}</p><div className="todo-progress"><progress value={item.progress} max={100} aria-label={`${item.title} ${c("進捗率", "进度")}`} /><b>{item.progress}％</b></div><p><strong>{c("実績・残ったこと", "实绩与未完成事项")}</strong>{text(item, "memo") || c("実績はまだ入力されていません。", "尚未填写实绩。")}</p></TodoItemPanel>)}
  </div>;
}
function HistoryView({ week, userId, revision }: { week: string; userId: string; revision: number }) {
  const { locale } = useI18n(); const c = copy(locale); const [rows, setRows] = useState<TodoHistory[]>([]); const [cursor, setCursor] = useState<string | null>(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const active = useRef(true); const serial = useRef(0);
  useEffect(() => { active.current = true; setRows([]); setCursor(undefined); return () => { active.current = false; serial.current++; }; }, [week, userId, revision]);
  async function load(append = false) {
    const sequence = ++serial.current; setBusy(true); setError("");
    try {
      const result = await getWeeklyTodoHistory({ weekStart: week, userId, ...(append && cursor ? { cursor } : {}) });
      if (active.current && sequence === serial.current) { setRows(previous => append ? [...previous, ...result.history] : result.history); setCursor(result.cursor); }
    } catch (caught) { if (active.current && sequence === serial.current) setError(todoError(caught, locale)); }
    finally { if (active.current && sequence === serial.current) setBusy(false); }
  }
  return <details className="todo-history" onToggle={event => { if (event.currentTarget.open && cursor === undefined && !busy) void load(); }}><summary>{c("予定・進捗の変更履歴", "计划与进度的变更记录")}</summary>{error && <p role="alert">{error}</p>}{rows.map(row => <div className="todo-history-entry" key={row.snapshot.revision}><strong>{row.kind === "review" ? c("振り返り共有", "共享回顾") : c("予定・進捗の共有", "共享计划与进度")} · {dateTime(row.snapshot.at, locale)}</strong><SnapshotView snapshot={row.snapshot} userId={userId} week={week} /></div>)}{busy && <p role="status">{c("読み込み中…", "正在加载…")}</p>}{(cursor || error) && <button type="button" disabled={busy} onClick={() => void load(Boolean(cursor))}>{cursor ? c("以前の履歴を表示", "显示更早记录") : c("再試行", "重试")}</button>}</details>;
}
