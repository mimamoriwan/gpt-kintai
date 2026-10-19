import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BellRing, Check, CheckCircle2, ChevronDown, Clock3, FileText, Image as ImageIcon, Megaphone, Paperclip, RefreshCw, Send, Trash2, Upload, X } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { todayJst } from "../lib/format";
import { InstructionChat } from "./InstructionChat";
import { InstructionAttachmentLink } from "./InstructionAttachmentLink";
import { announcementErrorMessage } from "../lib/announcementErrors";
import { BusinessLinkText } from "./BusinessFeatureEntry";
import {
  acknowledgePresidentInstruction,
  cancelPresidentInstruction,
  completePresidentInstruction,
  createPresidentInstruction,
  remindPresidentInstruction,
  replacePresidentInstruction,
  retryPresidentInstructionTranslation,
  uploadPresidentInstructionFiles,
  type PresidentInstructionInput
} from "../services/api";
import type { AnnouncementRecipient, Attachment, PresidentInstruction } from "../types";
import type { BusinessAnnouncementDraft } from "../features/business/types";

type Notify = (type: "success" | "error", message: string) => void;

function millis(value: PresidentInstruction["createdAt"] | undefined): number {
  return value?.toMillis?.() ?? 0;
}

export function sortPresidentInstructions(rows: PresidentInstruction[]): PresidentInstruction[] {
  return [...rows].sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
}

function sortPendingInstructions(rows: PresidentInstruction[]): PresidentInstruction[] {
  return [...rows].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "urgent" ? -1 : 1;
    if (a.dueDate !== b.dueDate) {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    return millis(b.createdAt) - millis(a.createdAt);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function instructionCopy(row: PresidentInstruction, locale: string) {
  const sourceLocale = row.sourceLocale === "zh-CN" ? "zh-CN" : "ja";
  const translatedZh = locale === "zh-CN" && sourceLocale === "ja" && row.translationStatus === "completed" && row.titleZh && row.bodyZh;
  const translatedJa = locale === "ja" && sourceLocale === "zh-CN" && row.translationStatus === "completed" && row.titleJa && row.bodyJa;
  return {
    title: translatedZh ? row.titleZh! : translatedJa ? row.titleJa! : row.titleOriginal,
    body: translatedZh ? row.bodyZh! : translatedJa ? row.bodyJa! : row.bodyOriginal,
    translated: Boolean(translatedZh || translatedJa),
    sourceLocale
  };
}

function timestampLabel(value: PresidentInstruction["createdAt"] | undefined, locale: string): string {
  if (!value?.toDate) return "—";
  return value.toDate().toLocaleString(locale === "ja" ? "ja-JP" : "zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

function statusLabel(status: string, locale: string): string {
  const ja: Record<string, string> = { pending: "未確認", acknowledged: "確認済み", completed: "完了", active: "対応中", cancelled: "取消済み" };
  const zh: Record<string, string> = { pending: "未确认", acknowledged: "已确认", completed: "已完成", active: "处理中", cancelled: "已取消" };
  return (locale === "ja" ? ja : zh)[status] || status;
}

function viewerInstructionStatus(row: PresidentInstruction, uid: string | undefined) {
  // Senders track the whole audience; recipients track their own progress.
  if (row.status !== "active" || !uid || row.authorId === uid) return row.status;
  return row.recipientStates?.[uid]?.status ?? row.status;
}

export function pendingInstructionSummary(instructions: PresidentInstruction[], uid: string) {
  const pending = sortPendingInstructions(instructions.filter((row) => row.status === "active" && row.recipientStates?.[uid]?.status === "pending"));
  const incomplete = instructions.filter((row) => row.status === "active" && row.recipientStates?.[uid] && row.recipientStates[uid].status !== "completed");
  return { pending, incompleteCount: incomplete.length };
}

function isConfirmedInstruction(row: PresidentInstruction, uid: string) {
  const status = row.recipientStates?.[uid]?.status;
  return status === "acknowledged" || status === "completed";
}

export function InstructionBanner({ instructions, onOpen }: { instructions: PresidentInstruction[]; onOpen: (instructionId: string) => void }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  if (!profile) return null;
  const { pending } = pendingInstructionSummary(instructions, profile.uid);
  const row = pending[0];
  if (!row) return null;
  const copy = instructionCopy(row, locale);
  const overdue = Boolean(row.dueDate && row.dueDate < todayJst());
  return <section className={`instruction-global-banner ${row.priority === "urgent" ? "urgent" : ""} ${overdue ? "overdue" : ""}`} role="alert">
    <span className="instruction-banner-icon"><Megaphone size={22} /></span>
    <span className="instruction-banner-copy"><small>{locale === "ja" ? `${row.authorName}から未確認のお知らせ ${pending.length}件` : `来自${row.authorName}的未确认通知 ${pending.length}条`}</small><strong>{copy.title}</strong>{row.dueDate && <em>{locale === "ja" ? `期限 ${row.dueDate}` : `截止 ${row.dueDate}`}</em>}</span>
    <button type="button" onClick={() => onOpen(row.id)}>{locale === "ja" ? "今すぐ確認" : "立即确认"}</button>
  </section>;
}

export function InstructionShortcut({ instructions, onOpen, compact = false }: { instructions: PresidentInstruction[]; onOpen: () => void; compact?: boolean }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  if (!profile) return null;
  const count = pendingInstructionSummary(instructions, profile.uid).pending.length;
  return <button type="button" className={`instruction-shortcut ${compact ? "compact" : ""}`} onClick={onOpen} aria-label={locale === "ja" ? `お知らせ、未確認${count}件` : `通知，${count}条未确认`}>
    <Megaphone size={compact ? 18 : 20} /><span>{locale === "ja" ? "お知らせ" : "通知"}</span>{count > 0 && <b>{count > 99 ? "99+" : count}</b>}
  </button>;
}

export function InstructionCenter({ instructions, users, open, onClose, notify, initialDraft, selectedInstructionId }: { instructions: PresidentInstruction[]; users: AnnouncementRecipient[]; open: boolean; onClose: () => void; notify: Notify; initialDraft?: BusinessAnnouncementDraft; selectedInstructionId?: string }) {
  const { locale } = useI18n();
  const { profile } = useAuth();
  const [hasOpened, setHasOpened] = useState(open);
  const dialogRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog?.contains(document.activeElement)) dialog?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);
  useEffect(() => { if (open) setHasOpened(true); }, [open]);
  if (!open && !hasOpened) return null;
  return <div className="modal-backdrop instruction-center-backdrop" hidden={!open} style={open ? undefined : { display: "none" }} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onClick={(event) => {
    if (event.target instanceof Element && event.target.closest('a[data-business-link="true"]') && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onClose();
  }}>
    <section ref={dialogRef} className="instruction-center" role="dialog" aria-modal="true" aria-labelledby="instruction-center-title" onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary")).filter((element) => !element.closest("[hidden]"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header><div><span className="eyebrow">ANNOUNCEMENTS</span><h2 id="instruction-center-title">{locale === "ja" ? "お知らせ" : "通知"}</h2></div><button className="instruction-close" type="button" onClick={onClose} aria-label={locale === "ja" ? "閉じる" : "关闭"}><X size={22} /></button></header>
      <InstructionWorkspace key={profile?.uid} instructions={instructions} users={users} notify={notify} open={open} initialDraft={initialDraft} selectedInstructionId={selectedInstructionId} />
    </section>
  </div>;
}

export function InstructionHomePanel({ instructions, users, notify }: { instructions: PresidentInstruction[]; users: AnnouncementRecipient[]; notify: Notify }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const summary = profile ? pendingInstructionSummary(instructions, profile.uid) : { pending: [], incompleteCount: 0 };
  const activeCount = summary.pending.length;
  const hasActive = activeCount > 0;
  const [expanded, setExpanded] = useState(hasActive);
  const previousHasActive = useRef(hasActive);
  const contentId = useId();

  useEffect(() => {
    if (hasActive && !previousHasActive.current) setExpanded(true);
    previousHasActive.current = hasActive;
  }, [hasActive]);

  const statusText = hasActive
    ? (locale === "ja" ? `未確認のお知らせが${activeCount}件あります` : `有${activeCount}条通知尚未确认`)
    : summary.incompleteCount > 0
      ? (locale === "ja" ? `確認済み・対応中のお知らせが${summary.incompleteCount}件あります` : `有${summary.incompleteCount}条已确认的通知正在处理`)
      : (locale === "ja" ? "クリックして最新のお知らせを閲覧" : "点击查看最新通知");

  return <section className={`card instruction-home-panel ${hasActive ? "has-active" : ""} ${expanded ? "is-expanded" : ""}`}>
    <button
      type="button"
      className="instruction-accordion-toggle"
      aria-expanded={expanded}
      aria-controls={contentId}
      onClick={() => setExpanded((current) => !current)}
    >
      <span className={`instruction-accordion-icon ${hasActive ? "attention" : ""}`}><Megaphone size={21} />{hasActive && <i aria-hidden="true" />}</span>
      <span className="instruction-accordion-copy"><strong>{locale === "ja" ? "お知らせ" : "通知"}</strong><small>{statusText}</small></span>
      {hasActive && <span className="instruction-accordion-count" aria-label={locale === "ja" ? `${activeCount}件` : `${activeCount}条`}>{activeCount > 99 ? "99+" : activeCount}</span>}
      <ChevronDown className={expanded ? "is-open" : ""} size={21} aria-hidden="true" />
    </button>
    {expanded && <div className="instruction-accordion-content" id={contentId}>
      <InstructionWorkspace instructions={instructions} users={users} notify={notify} embedded />
    </div>}
  </section>;
}

function InstructionWorkspace({ instructions, users, notify, embedded = false, open = true, initialDraft, selectedInstructionId }: { instructions: PresidentInstruction[]; users: AnnouncementRecipient[]; notify: Notify; embedded?: boolean; open?: boolean; initialDraft?: BusinessAnnouncementDraft; selectedInstructionId?: string }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const [view, setView] = useState<"read" | "post">("read");
  const [filter, setFilter] = useState<"all" | "pending" | "confirmed" | "sent" | "active" | "history">("all");
  const workspaceId = useId();
  const readButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const previousSelection = useRef<string | undefined>(undefined);
  const openedDraft = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (open) {
      if (initialDraft && openedDraft.current !== initialDraft.key) {
        openedDraft.current = initialDraft.key;
        setView("post");
      } else if (!wasOpen.current || selectedInstructionId !== previousSelection.current) {
        setFilter("all");
        setView("read");
      }
    }
    wasOpen.current = open;
    previousSelection.current = selectedInstructionId;
  }, [open, initialDraft?.key, selectedInstructionId]);
  useEffect(() => {
    if (open && view === "read" && filter === "all" && selectedInstructionId) {
      workspaceRef.current?.querySelector<HTMLElement>(".instruction-card.highlighted")?.focus({ preventScroll: true });
    }
  }, [open, selectedInstructionId, view, filter]);
  const pendingCount = profile ? pendingInstructionSummary(instructions, profile.uid).pending.length : 0;
  const confirmedCount = profile ? instructions.filter((row) => isConfirmedInstruction(row, profile.uid)).length : 0;
  const visible = useMemo(() => {
    const scoped = instructions.filter((row) => Boolean(profile && (row.authorId === profile.uid || row.recipientStates?.[profile.uid])));
    const rows = sortPresidentInstructions(scoped.filter((row) => {
      if (filter === "pending") return row.status === "active" && row.recipientStates?.[profile!.uid]?.status === "pending";
      if (filter === "confirmed") return isConfirmedInstruction(row, profile!.uid);
      if (filter === "sent") return row.authorId === profile!.uid;
      const status = viewerInstructionStatus(row, profile?.uid);
      const finished = status === "completed" || status === "cancelled";
      return filter === "all" || (filter === "active" ? !finished : finished);
    }));
    if (selectedInstructionId && filter === "all") {
      const selected = rows.find((row) => row.id === selectedInstructionId);
      if (selected) return [selected, ...rows.filter((row) => row.id !== selectedInstructionId)];
    }
    return rows;
  }, [filter, instructions, profile, selectedInstructionId]);
  return <div ref={workspaceRef} className={`instruction-workspace ${embedded ? "embedded" : ""}`}>
    <div className="instruction-view-switch" role="group" aria-label={locale === "ja" ? "お知らせの表示切り替え" : "通知显示切换"}>
      <button ref={readButtonRef} type="button" className={view === "read" ? "active" : ""} aria-pressed={view === "read"} aria-controls={`${workspaceId}-read`} onClick={() => setView("read")}><Megaphone size={18} />{locale === "ja" ? "閲覧" : "浏览"}</button>
      <button type="button" className={view === "post" ? "active" : ""} aria-pressed={view === "post"} aria-controls={`${workspaceId}-post`} onClick={() => setView("post")}><Send size={18} />{locale === "ja" ? "投稿" : "发布"}</button>
    </div>
    <div className="instruction-read-panel" id={`${workspaceId}-read`} hidden={view !== "read"}>
      <div className="instruction-list-heading">
        <div className="instruction-tabs" role="group" aria-label={locale === "ja" ? "お知らせの絞り込み" : "筛选通知"}>
          <button type="button" className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{locale === "ja" ? "すべて" : "全部"}</button>
          <button type="button" className={filter === "pending" ? "active" : ""} aria-pressed={filter === "pending"} onClick={() => setFilter("pending")}>{locale === "ja" ? `未確認 ${pendingCount}` : `未确认 ${pendingCount}`}</button>
          <button type="button" className={filter === "confirmed" ? "active" : ""} aria-pressed={filter === "confirmed"} onClick={() => setFilter("confirmed")}>{locale === "ja" ? `確認済み ${confirmedCount}` : `已确认 ${confirmedCount}`}</button>
          <button type="button" className={filter === "sent" ? "active" : ""} aria-pressed={filter === "sent"} onClick={() => setFilter("sent")}>{locale === "ja" ? "発信したお知らせ" : "我发布的"}</button>
          <button type="button" className={filter === "active" ? "active" : ""} aria-pressed={filter === "active"} onClick={() => setFilter("active")}>{locale === "ja" ? "対応中" : "处理中"}</button>
          <button type="button" className={filter === "history" ? "active" : ""} aria-pressed={filter === "history"} onClick={() => setFilter("history")}>{locale === "ja" ? "履歴" : "历史"}</button>
        </div>
        <span className="instruction-list-order">{selectedInstructionId && filter === "all" ? (locale === "ja" ? "選択したお知らせを先頭に表示" : "优先显示所选通知") : (locale === "ja" ? "新しい順" : "最新优先")}<span> · {visible.length}{locale === "ja" ? "件" : "条"}</span></span>
      </div>
      <p className="instruction-list-help">{locale === "ja" ? "未確認は本文を表示し、確認済みは折りたたんでいます。件名を押すと本文・返信を開けます。" : "未确认的通知展开正文，已确认的通知收起。点击标题可查看正文或回复。"}</p>
      <div className="instruction-list">{visible.map((row) => <InstructionCard key={row.id} row={row} notify={notify} users={users} open={open} highlighted={row.id === selectedInstructionId} />)}{visible.length === 0 && <div className="instruction-empty"><CheckCircle2 size={24} />{locale === "ja" ? "該当するお知らせはありません" : "没有相关通知"}</div>}</div>
    </div>
    <div id={`${workspaceId}-post`} hidden={view !== "post"}>
      <InstructionComposer users={users} notify={notify} initialDraft={initialDraft} onInitialDraft={() => setView("post")} onDone={() => { setFilter("all"); setView("read"); readButtonRef.current?.focus(); }} />
    </div>
  </div>;
}

function emptyInstructionForm(): PresidentInstructionInput {
  return { instructionId: crypto.randomUUID(), title: "", body: "", priority: "normal", dueDate: "", recipientIds: [], attachments: [] };
}

function InstructionComposer({ users, notify, replacement, onDone, initialDraft, onInitialDraft }: { users: AnnouncementRecipient[]; notify: Notify; replacement?: PresidentInstruction; onDone?: () => void; initialDraft?: BusinessAnnouncementDraft; onInitialDraft?: () => void }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const recipients = users.filter((user) => user.active && user.uid !== profile?.uid);
  const [form, setForm] = useState<PresidentInstructionInput>(() => replacement ? { instructionId: crypto.randomUUID(), title: replacement.titleOriginal, body: replacement.bodyOriginal, priority: replacement.priority, dueDate: replacement.dueDate || "", recipientIds: [...replacement.recipientIds], attachments: [...(replacement.attachments || [])] } : emptyInstructionForm());
  const [files, setFiles] = useState<File[]>([]);
  const [reason, setReason] = useState(locale === "ja" ? "内容を訂正して再発信するため" : "因修正内容而重新发布");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [submitError, setSubmitError] = useState("");
  const appliedDraft = useRef<string | undefined>(undefined);
  const [pendingDraft, setPendingDraft] = useState<BusinessAnnouncementDraft | undefined>();
  function applyInitialDraft(draft: BusinessAnnouncementDraft) {
    setForm({ ...emptyInstructionForm(), title: draft.title.slice(0, 120), body: draft.body.slice(0, 8000) });
    setFiles([]);
    setSubmitError("");
    setPendingDraft(undefined);
  }
  useEffect(() => {
    if (!initialDraft || replacement || busy || appliedDraft.current === initialDraft.key) return;
    appliedDraft.current = initialDraft.key;
    const dirty = Boolean(form.title || form.body || form.dueDate || form.priority !== "normal" || form.recipientIds.length || form.attachments.length || files.length);
    if (dirty) setPendingDraft(initialDraft);
    else applyInitialDraft(initialDraft);
    onInitialDraft?.();
  }, [initialDraft, replacement, busy, form, files]);
  const allSelected = recipients.length > 0 && recipients.every((user) => form.recipientIds.includes(user.uid));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current || pendingDraft) return;
    busyRef.current = true;
    setBusy(true);
    setSubmitError("");
    setUploadProgress(files.length ? { current: 1, total: files.length } : null);
    try {
      if (!profile) throw new Error(locale === "ja" ? "ログイン情報を確認できません。" : "无法确认登录信息。");
      const uploaded = files.length ? await uploadPresidentInstructionFiles(profile, form.instructionId, files, form.attachments, {
        onProgress: (current, total) => setUploadProgress({ current, total }),
        onUploaded: (attachment) => {
          setForm((current) => ({ ...current, attachments: [...current.attachments, attachment] }));
          setFiles((current) => current.slice(1));
        }
      }) : [];
      const payload = { ...form, attachments: [...form.attachments, ...uploaded] };
      setFiles([]);
      setForm(payload);
      setUploadProgress(null);
      const result = replacement ? await replacePresidentInstruction(replacement.id, reason.trim(), payload) : await createPresidentInstruction(payload);
      notify("success", result.translationStatus === "failed" ? (locale === "ja" ? "お知らせを発信しました。中国語訳は後で再実行してください。" : "通知已发布，中文翻译请稍后重试。") : (locale === "ja" ? "お知らせを発信しました。" : "通知已发布。"));
      setForm(emptyInstructionForm());
      onDone?.();
    } catch (error) {
      const message = announcementErrorMessage(error, locale);
      setSubmitError(message);
      notify("error", message);
    }
    finally {
      busyRef.current = false;
      setBusy(false);
      setUploadProgress(null);
    }
  }
  function toggle(uid: string) { setForm((current) => ({ ...current, recipientIds: current.recipientIds.includes(uid) ? current.recipientIds.filter((id) => id !== uid) : [...current.recipientIds, uid] })); }
  function selectFiles(event: React.ChangeEvent<HTMLInputElement>) {
    if (busyRef.current) return;
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (form.attachments.length + files.length + selected.length > 5) {
      notify("error", locale === "ja" ? "添付資料は5件までです。" : "附件最多5个。");
      return;
    }
    setFiles((current) => [...current, ...selected]);
  }
  const progressLabel = uploadProgress
    ? (locale === "ja" ? `添付資料を送信中 (${uploadProgress.current}/${uploadProgress.total})` : `正在上传附件 (${uploadProgress.current}/${uploadProgress.total})`)
    : (locale === "ja" ? "お知らせを発信中" : "正在发布通知");
  return <form className="instruction-composer" onSubmit={submit} aria-busy={busy}>
    <div className="instruction-composer-title"><div><span className="eyebrow">NEW ANNOUNCEMENT</span><h3>{replacement ? (locale === "ja" ? "取消して再発信" : "取消并重新发布") : (locale === "ja" ? "新しいお知らせを発信" : "发布新通知")}</h3></div><Send size={22} /></div>
    {pendingDraft && <div className="instruction-translation-warning" role="alert">
      <div><p>{locale === "ja" ? "編集中のお知らせがあります。取り組みの内容に切り替えると、現在の本文・宛先・添付の選択を置き換えます。" : "有正在编辑的通知。切换到公司事项的内容将替换当前正文、收件人和附件选择。"}</p><strong>{pendingDraft.title}</strong></div>
      <button type="button" disabled={busy} onClick={() => setPendingDraft(undefined)}>{locale === "ja" ? "編集中の内容を続ける" : "继续编辑当前内容"}</button>
      <button type="button" disabled={busy} onClick={() => applyInitialDraft(pendingDraft)}>{locale === "ja" ? "取り組みの内容に切り替える" : "切换到公司事项的内容"}</button>
    </div>}
    <p className="instruction-operator-note">{locale === "ja" ? "全社員がお知らせを発信できます。発信者名は履歴に残ります。" : "所有员工都可以发布通知，发布者姓名会保留在记录中。"}</p>
    <label><span>{locale === "ja" ? "宛先" : "收件人"}</span><div className="recipient-picker"><button type="button" disabled={busy} className={allSelected ? "selected" : ""} onClick={() => setForm({ ...form, recipientIds: allSelected ? [] : recipients.map((user) => user.uid) })}>{locale === "ja" ? "自分以外の全員" : "除自己外的所有人"}</button>{recipients.map((user) => <button type="button" disabled={busy} key={user.uid} className={form.recipientIds.includes(user.uid) ? "selected" : ""} onClick={() => toggle(user.uid)}>{user.displayName}</button>)}</div></label>
    <div className="instruction-form-grid"><label><span>{locale === "ja" ? "優先度" : "优先级"}</span><select disabled={busy} value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as "normal" | "urgent" })}><option value="normal">{locale === "ja" ? "通常" : "普通"}</option><option value="urgent">{locale === "ja" ? "緊急" : "紧急"}</option></select></label><label><span>{locale === "ja" ? "期限（任意）" : "截止日期（可选）"}</span><input disabled={busy} type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label></div>
    <label><span>{locale === "ja" ? "件名" : "标题"}</span><input disabled={busy} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
    <label><span>{locale === "ja" ? "お知らせ内容" : "通知内容"}</span><textarea disabled={busy} rows={4} maxLength={8000} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} required /></label>
    <div className="instruction-attachment-picker">
      <div><span><Paperclip size={16} />{locale === "ja" ? "添付資料（任意）" : "附件资料（可选）"}</span><small>{locale === "ja" ? "最大5件・合計20MB、資料は1件10MBまで。PDF、写真、Word、Excelに対応" : "最多5个、合计20MB，文档每个最多10MB。支持PDF、照片、Word和Excel"}</small></div>
      <label className="instruction-file-button"><Upload size={16} /><span>{locale === "ja" ? "ファイルを選ぶ" : "选择文件"}</span><input disabled={busy} type="file" multiple accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif,application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx" onChange={selectFiles} /></label>
      {(form.attachments.length > 0 || files.length > 0) && <div className="instruction-pending-attachments">
        {form.attachments.map((attachment) => <div key={attachment.id}><AttachmentIcon attachment={attachment} /><span><strong>{attachment.name}</strong><small>{formatAttachmentSize(attachment.size)}{replacement ? (locale === "ja" ? "・再発信へ引継ぎ" : "・沿用至重新发布") : ""}</small></span><button type="button" disabled={busy} aria-label={locale === "ja" ? `${attachment.name}を外す` : `移除${attachment.name}`} onClick={() => setForm((current) => ({ ...current, attachments: current.attachments.filter((item) => item.id !== attachment.id) }))}><Trash2 size={16} /></button></div>)}
        {files.map((file, index) => <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`}><Paperclip size={17} /><span><strong>{file.name}</strong><small>{formatAttachmentSize(file.size)}</small></span><button type="button" disabled={busy} aria-label={locale === "ja" ? `${file.name}を外す` : `移除${file.name}`} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></button></div>)}
      </div>}
    </div>
    {replacement && <label><span>{locale === "ja" ? "取消・再発信理由" : "取消和重新发布原因"}</span><textarea disabled={busy} rows={2} minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} required /></label>}
    {submitError && <div className="form-error" role="alert">{submitError}</div>}
    <button className={`button ${form.priority === "urgent" ? "danger" : "primary"}`} disabled={busy || Boolean(pendingDraft) || form.recipientIds.length === 0}>{busy ? <span role="status">{progressLabel}</span> : replacement ? (locale === "ja" ? "旧お知らせを取消して発信" : "取消旧通知并发布") : (locale === "ja" ? "お知らせを発信" : "发布通知")}</button>
  </form>;
}

function InstructionCard({ row, notify, users, open = true, highlighted = false }: { row: PresidentInstruction; notify: Notify; users: AnnouncementRecipient[]; open?: boolean; highlighted?: boolean }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [reissuing, setReissuing] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const [lastLocalReminderAt, setLastLocalReminderAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const copy = instructionCopy(row, locale);
  const state = profile ? row.recipientStates?.[profile.uid] : undefined;
  const isPending = row.status === "active" && state?.status === "pending";
  const [expanded, setExpanded] = useState(highlighted || isPending);
  const contentId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousDisplay = useRef({ open, highlighted, uid: profile?.uid, status: row.status, recipientStatus: state?.status });
  useEffect(() => {
    const previous = previousDisplay.current;
    const newlyOpened = open && !previous.open;
    const newlySelected = highlighted && !previous.highlighted;
    const statusChanged = previous.uid !== profile?.uid || previous.status !== row.status || previous.recipientStatus !== state?.status;
    if (newlyOpened || newlySelected || statusChanged) {
      // Selection opens its target; a saved confirmation subsequently collapses it.
      const nextExpanded = newlyOpened || newlySelected ? highlighted || isPending : isPending;
      if (!nextExpanded && contentRef.current?.contains(document.activeElement)) toggleRef.current?.focus({ preventScroll: true });
      setExpanded(nextExpanded);
    }
    previousDisplay.current = { open, highlighted, uid: profile?.uid, status: row.status, recipientStatus: state?.status };
  }, [open, highlighted, profile?.uid, row.status, state?.status, isPending]);
  const isAuthor = profile?.uid === row.authorId;
  const recipients = [...new Set(row.recipientIds)].map((uid) => row.recipientStates[uid]).filter(Boolean);
  const unconfirmedCount = recipients.filter((recipient) => recipient.status === "pending").length;
  const confirmedCount = recipients.length - unconfirmedCount;
  const reminderReadyAt = Math.max(millis(row.lastReminderAt), lastLocalReminderAt) + 5 * 60 * 1000;
  const reminderCoolingDown = reminderReadyAt > now;
  useEffect(() => {
    setNow(Date.now());
    const remaining = reminderReadyAt - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => window.clearTimeout(timer);
  }, [reminderReadyAt]);
  const status = viewerInstructionStatus(row, profile?.uid);
  const needsAttention = status === "pending" || status === "active";
  const overdue = Boolean(needsAttention && row.dueDate && row.dueDate < todayJst());
  async function run(action: () => Promise<void>, success: string) { setBusy(true); try { await action(); cardRef.current?.focus({ preventScroll: true }); notify("success", success); } catch (error) { notify("error", errorMessage(error)); } finally { setBusy(false); } }
  async function remind() {
    setBusy(true);
    try {
      const result = await remindPresidentInstruction(row.id);
      setLastLocalReminderAt(Date.now());
      notify("success", locale === "ja" ? `未確認の${result.recipientCount}人に再通知しました。` : `已提醒${result.recipientCount}位未确认者。`);
    } catch (error) { notify("error", errorMessage(error)); }
    finally { setBusy(false); }
  }
  if (reissuing) return <article className="instruction-card reissue"><InstructionComposer users={users} notify={notify} replacement={row} onDone={() => setReissuing(false)} /><button className="button ghost" onClick={() => setReissuing(false)}>{locale === "ja" ? "再発信をやめる" : "取消重新发布"}</button></article>;
  return <article ref={cardRef} tabIndex={-1} className={`instruction-card ${needsAttention ? row.priority : "normal"} ${overdue ? "overdue" : ""} ${highlighted ? "highlighted" : ""} ${expanded ? "is-expanded" : "is-collapsed"} ${isPending ? "is-unconfirmed" : ""}`}>
    <div className="instruction-card-head"><div className="instruction-card-tags"><span className={`tag ${row.priority === "urgent" ? "red" : "blue"}`}>{row.priority === "urgent" ? (locale === "ja" ? "緊急" : "紧急") : (locale === "ja" ? "通常" : "普通")}</span><span className={`tag ${status === "cancelled" ? "soft" : status === "completed" ? "green" : status === "acknowledged" ? "blue" : "amber"}`}>{!isAuthor && status === "completed" ? (locale === "ja" ? "対応完了" : "处理完成") : statusLabel(status, locale)}</span>{overdue && <span className="tag red"><AlertTriangle size={13} />{locale === "ja" ? "期限超過" : "已逾期"}</span>}</div><small>{timestampLabel(row.createdAt, locale)}</small></div>
    <h3 className="instruction-card-title"><button ref={toggleRef} type="button" className="instruction-card-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((current) => !current)}><span>{copy.title}</span><span className="instruction-card-toggle-hint" aria-hidden="true">{expanded ? (locale === "ja" ? "閉じる" : "收起") : (locale === "ja" ? "開く" : "展开")}<ChevronDown size={18} /></span></button></h3>
    <div className="instruction-meta instruction-summary-meta"><span>{locale === "ja" ? `発信：${row.authorName}` : `发布：${row.authorName}`}</span><span><Clock3 size={15} />{row.dueDate ? `${locale === "ja" ? "期限" : "截止"} ${row.dueDate}` : (locale === "ja" ? "期限なし" : "无截止日期")}</span>{Boolean(row.attachments?.length) && <span><Paperclip size={15} />{locale === "ja" ? `添付 ${row.attachments!.length}件` : `附件 ${row.attachments!.length}个`}</span>}{isAuthor && <span><CheckCircle2 size={15} />{locale === "ja" ? `受信者 ${confirmedCount}/${recipients.length}人が確認` : `接收者 ${confirmedCount}/${recipients.length}人已确认`}</span>}</div>
    <div ref={contentRef} id={contentId} className="instruction-card-content" hidden={!expanded}>{expanded && <>
    <p className="instruction-body"><BusinessLinkText text={copy.body} /></p>
    {copy.translated && <details><summary>{copy.sourceLocale === "ja" ? (locale === "ja" ? "日本語原文" : "查看日语原文") : (locale === "ja" ? "中国語原文" : "查看中文原文")}</summary><strong>{row.titleOriginal}</strong><p><BusinessLinkText text={row.bodyOriginal} /></p></details>}
    {Boolean(row.attachments?.length) && <div className="instruction-saved-attachments"><strong><Paperclip size={16} />{locale === "ja" ? `添付資料 ${row.attachments?.length}件` : `附件资料 ${row.attachments?.length}个`}</strong><div>{row.attachments?.map((attachment) => <InstructionAttachmentLink key={attachment.id} attachment={attachment} locale={locale} />)}</div></div>}
    {isAuthor && <section className="instruction-confirmation" aria-label={locale === "ja" ? "受信者の確認状況" : "接收者确认情况"}>
      <div className="instruction-confirmation-heading"><strong><CheckCircle2 size={18} />{locale === "ja" ? `確認済み ${confirmedCount} / ${recipients.length}人` : `已确认 ${confirmedCount} / ${recipients.length}人`}</strong><span className={`tag ${unconfirmedCount > 0 ? "amber" : "green"}`}>{unconfirmedCount > 0 ? (locale === "ja" ? `未確認 ${unconfirmedCount}人` : `${unconfirmedCount}人未确认`) : (locale === "ja" ? "全員確認済み" : "全员已确认")}</span></div>
      <div className="recipient-progress">{recipients.map((recipient) => <div key={recipient.userId}><span className="avatar small">{recipient.displayName.slice(0, 1)}</span><span><strong>{recipient.displayName}</strong><small>{statusLabel(recipient.status, locale)}</small>{recipient.acknowledgedAt && <small>{locale === "ja" ? "内容確認" : "内容确认"} · {timestampLabel(recipient.acknowledgedAt, locale)}</small>}{recipient.completedAt && <small>{locale === "ja" ? "対応完了" : "处理完成"} · {timestampLabel(recipient.completedAt, locale)}</small>}{recipient.status === "pending" && recipient.lastRemindedAt && <small>{locale === "ja" ? "再通知" : "已提醒"} · {timestampLabel(recipient.lastRemindedAt, locale)}</small>}{recipient.completionNote && <em>{recipient.completionNote}</em>}</span></div>)}</div>
      {row.status === "active" && unconfirmedCount > 0 && <div className="instruction-remind-controls">
        <button type="button" className="button primary" disabled={busy || reminderCoolingDown} onClick={() => void remind()}><BellRing size={16} />{locale === "ja" ? `未確認の ${unconfirmedCount}人に再通知` : `提醒 ${unconfirmedCount}位未确认者`}</button>
        <small>{reminderCoolingDown ? (locale === "ja" ? "再通知しました。次の再通知は5分後から行えます。" : "已发送提醒，5分钟后可再次提醒。") : (locale === "ja" ? "未確認の人に、アプリ内で確認を促す案内を再表示します。" : "将在未确认者的应用内再次显示提醒。")}</small>
      </div>}
    </section>}
    {!isAuthor && state && <div className={`instruction-recipient-state ${state.status !== "pending" ? "confirmed" : ""}`}><strong>{state.status !== "pending" && <CheckCircle2 size={17} />}{statusLabel(state.status, locale)}</strong>{state.acknowledgedAt && <small>{locale === "ja" ? "内容確認" : "内容确认"} · {timestampLabel(state.acknowledgedAt, locale)}</small>}{state.completionNote && <p>{state.completionNote}</p>}</div>}
    {row.translationStatus === "failed" && <div className="instruction-translation-warning"><AlertTriangle size={16} /><span>{locale === "ja" ? "翻訳を作成できませんでした。原文は配信済みです。" : "未能生成翻译，原文已发布。"}</span>{isAuthor && <button disabled={busy} onClick={() => void run(() => retryPresidentInstructionTranslation(row.id), locale === "ja" ? "翻訳を再実行しました。" : "已重新翻译。") }><RefreshCw size={14} />{locale === "ja" ? "再試行" : "重试"}</button>}</div>}
    {row.status === "active" && state?.status === "pending" && <div className="instruction-acknowledge-box"><p>{locale === "ja" ? "本文・添付資料を確認したら、下のボタンを押してください。確認した日時が発信者に伝わります。" : "请阅读正文及附件后点击下方按钮，发布者将看到您的确认时间。"}</p><button className="button primary instruction-main-action" disabled={busy} onClick={() => void run(() => acknowledgePresidentInstruction(row.id), locale === "ja" ? "内容の確認を発信者に伝えました。" : "已向发布者确认您已阅读内容。") }><Check size={17} />{locale === "ja" ? "内容を確認しました" : "我已确认内容"}</button></div>}
    <InstructionChat key={`${row.id}:${profile?.uid}`} row={row} active={open && expanded} />
    {row.status === "active" && state?.status === "acknowledged" && <div className="instruction-complete-box"><label><span>{locale === "ja" ? "完了メモ（任意）" : "完成备注（可选）"}</span><textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="button success" disabled={busy} onClick={() => void run(() => completePresidentInstruction(row.id, note.trim()), locale === "ja" ? "お知らせへの対応を完了しました。" : "通知已处理完成。") }><CheckCircle2 size={17} />{locale === "ja" ? "対応を完了" : "完成处理"}</button></div>}
    {isAuthor && row.status === "active" && <div className="instruction-president-actions"><button className="button ghost" onClick={() => setReissuing(true)}><RefreshCw size={15} />{locale === "ja" ? "取消して再発信" : "取消并重新发布"}</button><button className="button ghost danger-text" onClick={() => setCancelling((value) => !value)}>{locale === "ja" ? "取り消す" : "取消"}</button></div>}
    {cancelling && <div className="instruction-cancel-box"><label><span>{locale === "ja" ? "取消理由" : "取消原因"}</span><textarea rows={2} minLength={3} maxLength={500} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label><div><button className="button ghost" onClick={() => setCancelling(false)}>{locale === "ja" ? "戻る" : "返回"}</button><button className="button danger" disabled={busy || cancelReason.trim().length < 3} onClick={() => void run(() => cancelPresidentInstruction(row.id, cancelReason.trim()), locale === "ja" ? "お知らせを取り消しました。" : "通知已取消。")}>{locale === "ja" ? "取消を確定" : "确认取消"}</button></div></div>}
    {row.status === "cancelled" && row.cancellationReason && <p className="instruction-cancelled-reason">{locale === "ja" ? "取消理由" : "取消原因"}：{row.cancellationReason}</p>}
    </>}</div>
  </article>;
}

function AttachmentIcon({ attachment }: { attachment: Attachment }) {
  return attachment.contentType.startsWith("image/") ? <ImageIcon size={17} /> : <FileText size={17} />;
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
