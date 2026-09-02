import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Clock3, FileText, Image as ImageIcon, Megaphone, Paperclip, RefreshCw, Send, Trash2, Upload, X } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { todayJst } from "../lib/format";
import {
  acknowledgePresidentInstruction,
  cancelPresidentInstruction,
  completePresidentInstruction,
  createPresidentInstruction,
  presidentInstructionAttachmentUrl,
  replacePresidentInstruction,
  retryPresidentInstructionTranslation,
  uploadPresidentInstructionFiles,
  type PresidentInstructionInput
} from "../services/api";
import type { AnnouncementRecipient, Attachment, PresidentInstruction } from "../types";

type Notify = (type: "success" | "error", message: string) => void;

function millis(value: PresidentInstruction["createdAt"] | undefined): number {
  return value?.toMillis?.() ?? 0;
}

export function sortPresidentInstructions(rows: PresidentInstruction[]): PresidentInstruction[] {
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

export function pendingInstructionSummary(instructions: PresidentInstruction[], uid: string) {
  const pending = sortPresidentInstructions(instructions.filter((row) => row.status === "active" && row.recipientStates?.[uid]?.status === "pending"));
  const incomplete = instructions.filter((row) => row.status === "active" && row.recipientStates?.[uid] && row.recipientStates[uid].status !== "completed");
  return { pending, incompleteCount: incomplete.length };
}

export function InstructionBanner({ instructions, onOpen }: { instructions: PresidentInstruction[]; onOpen: () => void }) {
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
    <button type="button" onClick={onOpen}>{locale === "ja" ? "今すぐ確認" : "立即确认"}</button>
  </section>;
}

export function InstructionShortcut({ instructions, onOpen, compact = false }: { instructions: PresidentInstruction[]; onOpen: () => void; compact?: boolean }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  if (!profile) return null;
  const count = pendingInstructionSummary(instructions, profile.uid).incompleteCount;
  return <button type="button" className={`instruction-shortcut ${compact ? "compact" : ""}`} onClick={onOpen} aria-label={locale === "ja" ? `お知らせ、未対応${count}件` : `通知，${count}条未处理`}>
    <Megaphone size={compact ? 18 : 20} /><span>{locale === "ja" ? "お知らせ" : "通知"}</span>{count > 0 && <b>{count > 99 ? "99+" : count}</b>}
  </button>;
}

export function InstructionCenter({ instructions, users, open, onClose, notify }: { instructions: PresidentInstruction[]; users: AnnouncementRecipient[]; open: boolean; onClose: () => void; notify: Notify }) {
  const { locale } = useI18n();
  if (!open) return null;
  return <div className="modal-backdrop instruction-center-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="instruction-center" role="dialog" aria-modal="true" aria-labelledby="instruction-center-title">
      <header><div><span className="eyebrow">ANNOUNCEMENTS</span><h2 id="instruction-center-title">{locale === "ja" ? "お知らせ" : "通知"}</h2></div><button className="instruction-close" type="button" onClick={onClose} aria-label={locale === "ja" ? "閉じる" : "关闭"}><X size={22} /></button></header>
      <InstructionWorkspace instructions={instructions} users={users} notify={notify} />
    </section>
  </div>;
}

export function InstructionHomePanel({ instructions, users, notify }: { instructions: PresidentInstruction[]; users: AnnouncementRecipient[]; notify: Notify }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const activeCount = profile ? pendingInstructionSummary(instructions, profile.uid).incompleteCount : 0;
  const hasActive = activeCount > 0;
  const [expanded, setExpanded] = useState(hasActive);
  const previousHasActive = useRef(hasActive);
  const contentId = useId();

  useEffect(() => {
    if (hasActive && !previousHasActive.current) setExpanded(true);
    previousHasActive.current = hasActive;
  }, [hasActive]);

  const statusText = hasActive
    ? (locale === "ja" ? `未対応のお知らせが${activeCount}件あります` : `有${activeCount}条通知尚未处理`)
    : (locale === "ja" ? "クリックして発信・履歴を開く" : "点击展开发布栏和历史记录");

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

function InstructionWorkspace({ instructions, users, notify, embedded = false }: { instructions: PresidentInstruction[]; users: AnnouncementRecipient[]; notify: Notify; embedded?: boolean }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const [filter, setFilter] = useState<"active" | "history">("active");
  const visible = useMemo(() => {
    const scoped = instructions.filter((row) => Boolean(profile && (row.authorId === profile.uid || row.recipientStates?.[profile.uid])));
    return sortPresidentInstructions(scoped.filter((row) => filter === "active" ? row.status === "active" : row.status !== "active"));
  }, [filter, instructions, profile]);
  return <div className={`instruction-workspace ${embedded ? "embedded" : ""}`}>
    <InstructionComposer users={users} notify={notify} />
    <div className="instruction-list-heading"><div className="instruction-tabs"><button className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}>{locale === "ja" ? "対応中" : "处理中"}</button><button className={filter === "history" ? "active" : ""} onClick={() => setFilter("history")}>{locale === "ja" ? "履歴" : "历史"}</button></div><span>{visible.length}{locale === "ja" ? "件" : "条"}</span></div>
    <div className="instruction-list">{visible.map((row) => <InstructionCard key={row.id} row={row} notify={notify} users={users} />)}{visible.length === 0 && <div className="instruction-empty"><CheckCircle2 size={24} />{locale === "ja" ? "該当するお知らせはありません" : "没有相关通知"}</div>}</div>
  </div>;
}

function emptyInstructionForm(): PresidentInstructionInput {
  return { instructionId: crypto.randomUUID(), title: "", body: "", priority: "normal", dueDate: "", recipientIds: [], attachments: [] };
}

function InstructionComposer({ users, notify, replacement, onDone }: { users: AnnouncementRecipient[]; notify: Notify; replacement?: PresidentInstruction; onDone?: () => void }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const recipients = users.filter((user) => user.active && user.uid !== profile?.uid);
  const [form, setForm] = useState<PresidentInstructionInput>(() => replacement ? { instructionId: crypto.randomUUID(), title: replacement.titleOriginal, body: replacement.bodyOriginal, priority: replacement.priority, dueDate: replacement.dueDate || "", recipientIds: [...replacement.recipientIds], attachments: [...(replacement.attachments || [])] } : emptyInstructionForm());
  const [files, setFiles] = useState<File[]>([]);
  const [reason, setReason] = useState(locale === "ja" ? "内容を訂正して再発信するため" : "因修正内容而重新发布");
  const [busy, setBusy] = useState(false);
  const allSelected = recipients.length > 0 && recipients.every((user) => form.recipientIds.includes(user.uid));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (!profile) throw new Error(locale === "ja" ? "ログイン情報を確認できません。" : "无法确认登录信息。");
      const uploaded = files.length ? await uploadPresidentInstructionFiles(profile, form.instructionId, files, form.attachments) : [];
      const payload = { ...form, attachments: [...form.attachments, ...uploaded] };
      setFiles([]);
      setForm(payload);
      const result = replacement ? await replacePresidentInstruction(replacement.id, reason.trim(), payload) : await createPresidentInstruction(payload);
      notify("success", result.translationStatus === "failed" ? (locale === "ja" ? "お知らせを発信しました。中国語訳は後で再実行してください。" : "通知已发布，中文翻译请稍后重试。") : (locale === "ja" ? "お知らせを発信しました。" : "通知已发布。"));
      setForm(emptyInstructionForm());
      onDone?.();
    } catch (error) { notify("error", errorMessage(error)); }
    finally { setBusy(false); }
  }
  function toggle(uid: string) { setForm((current) => ({ ...current, recipientIds: current.recipientIds.includes(uid) ? current.recipientIds.filter((id) => id !== uid) : [...current.recipientIds, uid] })); }
  function selectFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (form.attachments.length + files.length + selected.length > 5) {
      notify("error", locale === "ja" ? "添付資料は5件までです。" : "附件最多5个。");
      return;
    }
    setFiles((current) => [...current, ...selected]);
  }
  return <form className="instruction-composer" onSubmit={submit}>
    <div className="instruction-composer-title"><div><span className="eyebrow">NEW ANNOUNCEMENT</span><h3>{replacement ? (locale === "ja" ? "取消して再発信" : "取消并重新发布") : (locale === "ja" ? "新しいお知らせを発信" : "发布新通知")}</h3></div><Send size={22} /></div>
    <p className="instruction-operator-note">{locale === "ja" ? "全社員がお知らせを発信できます。発信者名は履歴に残ります。" : "所有员工都可以发布通知，发布者姓名会保留在记录中。"}</p>
    <label><span>{locale === "ja" ? "宛先" : "收件人"}</span><div className="recipient-picker"><button type="button" className={allSelected ? "selected" : ""} onClick={() => setForm({ ...form, recipientIds: allSelected ? [] : recipients.map((user) => user.uid) })}>{locale === "ja" ? "自分以外の全員" : "除自己外的所有人"}</button>{recipients.map((user) => <button type="button" key={user.uid} className={form.recipientIds.includes(user.uid) ? "selected" : ""} onClick={() => toggle(user.uid)}>{user.displayName}</button>)}</div></label>
    <div className="instruction-form-grid"><label><span>{locale === "ja" ? "優先度" : "优先级"}</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as "normal" | "urgent" })}><option value="normal">{locale === "ja" ? "通常" : "普通"}</option><option value="urgent">{locale === "ja" ? "緊急" : "紧急"}</option></select></label><label><span>{locale === "ja" ? "期限（任意）" : "截止日期（可选）"}</span><input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label></div>
    <label><span>{locale === "ja" ? "件名" : "标题"}</span><input maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
    <label><span>{locale === "ja" ? "お知らせ内容" : "通知内容"}</span><textarea rows={4} maxLength={8000} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} required /></label>
    <div className="instruction-attachment-picker">
      <div><span><Paperclip size={16} />{locale === "ja" ? "添付資料（任意）" : "附件资料（可选）"}</span><small>{locale === "ja" ? "最大5件・合計20MB。PDF、写真、Word、Excelに対応" : "最多5个、合计20MB。支持PDF、照片、Word和Excel"}</small></div>
      <label className="instruction-file-button"><Upload size={16} /><span>{locale === "ja" ? "ファイルを選ぶ" : "选择文件"}</span><input type="file" multiple accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif,application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx" onChange={selectFiles} /></label>
      {(form.attachments.length > 0 || files.length > 0) && <div className="instruction-pending-attachments">
        {form.attachments.map((attachment) => <div key={attachment.id}><AttachmentIcon attachment={attachment} /><span><strong>{attachment.name}</strong><small>{formatAttachmentSize(attachment.size)}{replacement ? (locale === "ja" ? "・再発信へ引継ぎ" : "・沿用至重新发布") : ""}</small></span><button type="button" aria-label={locale === "ja" ? `${attachment.name}を外す` : `移除${attachment.name}`} onClick={() => setForm((current) => ({ ...current, attachments: current.attachments.filter((item) => item.id !== attachment.id) }))}><Trash2 size={16} /></button></div>)}
        {files.map((file, index) => <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`}><Paperclip size={17} /><span><strong>{file.name}</strong><small>{formatAttachmentSize(file.size)}</small></span><button type="button" aria-label={locale === "ja" ? `${file.name}を外す` : `移除${file.name}`} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></button></div>)}
      </div>}
    </div>
    {replacement && <label><span>{locale === "ja" ? "取消・再発信理由" : "取消和重新发布原因"}</span><textarea rows={2} minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} required /></label>}
    <button className={`button ${form.priority === "urgent" ? "danger" : "primary"}`} disabled={busy || form.recipientIds.length === 0}>{busy ? "…" : replacement ? (locale === "ja" ? "旧お知らせを取消して発信" : "取消旧通知并发布") : (locale === "ja" ? "お知らせを発信" : "发布通知")}</button>
  </form>;
}

function InstructionCard({ row, notify, users }: { row: PresidentInstruction; notify: Notify; users: AnnouncementRecipient[] }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [reissuing, setReissuing] = useState(false);
  const copy = instructionCopy(row, locale);
  const state = profile ? row.recipientStates?.[profile.uid] : undefined;
  const isAuthor = profile?.uid === row.authorId;
  const overdue = Boolean(row.status === "active" && row.dueDate && row.dueDate < todayJst());
  async function run(action: () => Promise<void>, success: string) { setBusy(true); try { await action(); notify("success", success); } catch (error) { notify("error", errorMessage(error)); } finally { setBusy(false); } }
  if (reissuing) return <article className="instruction-card reissue"><InstructionComposer users={users} notify={notify} replacement={row} onDone={() => setReissuing(false)} /><button className="button ghost" onClick={() => setReissuing(false)}>{locale === "ja" ? "再発信をやめる" : "取消重新发布"}</button></article>;
  return <article className={`instruction-card ${row.priority} ${overdue ? "overdue" : ""}`}>
    <div className="instruction-card-head"><div className="instruction-card-tags"><span className={`tag ${row.priority === "urgent" ? "red" : "blue"}`}>{row.priority === "urgent" ? (locale === "ja" ? "緊急" : "紧急") : (locale === "ja" ? "通常" : "普通")}</span><span className={`tag ${row.status === "cancelled" ? "soft" : row.status === "completed" ? "green" : "amber"}`}>{statusLabel(row.status, locale)}</span>{overdue && <span className="tag red"><AlertTriangle size={13} />{locale === "ja" ? "期限超過" : "已逾期"}</span>}</div><small>{timestampLabel(row.createdAt, locale)}</small></div>
    <h3>{copy.title}</h3><p className="instruction-body">{copy.body}</p>
    {copy.translated && <details><summary>{copy.sourceLocale === "ja" ? (locale === "ja" ? "日本語原文" : "查看日语原文") : (locale === "ja" ? "中国語原文" : "查看中文原文")}</summary><strong>{row.titleOriginal}</strong><p>{row.bodyOriginal}</p></details>}
    {Boolean(row.attachments?.length) && <div className="instruction-saved-attachments"><strong><Paperclip size={16} />{locale === "ja" ? `添付資料 ${row.attachments?.length}件` : `附件资料 ${row.attachments?.length}个`}</strong><div>{row.attachments?.map((attachment) => <InstructionAttachmentLink key={attachment.id} attachment={attachment} locale={locale} />)}</div></div>}
    <div className="instruction-meta"><span><Clock3 size={15} />{row.dueDate ? `${locale === "ja" ? "期限" : "截止"} ${row.dueDate}` : (locale === "ja" ? "期限なし" : "无截止日期")}</span><span>{locale === "ja" ? `発信：${row.authorName}` : `发布：${row.authorName}`}</span></div>
    {isAuthor && <div className="recipient-progress">{Object.values(row.recipientStates).map((recipient) => <div key={recipient.userId}><span className="avatar small">{recipient.displayName.slice(0, 1)}</span><span><strong>{recipient.displayName}</strong><small>{statusLabel(recipient.status, locale)}{recipient.completedAt ? ` · ${timestampLabel(recipient.completedAt, locale)}` : recipient.acknowledgedAt ? ` · ${timestampLabel(recipient.acknowledgedAt, locale)}` : ""}</small>{recipient.completionNote && <em>{recipient.completionNote}</em>}</span></div>)}</div>}
    {!isAuthor && state && <div className="instruction-recipient-state"><strong>{statusLabel(state.status, locale)}</strong>{state.completionNote && <p>{state.completionNote}</p>}</div>}
    {row.translationStatus === "failed" && <div className="instruction-translation-warning"><AlertTriangle size={16} /><span>{locale === "ja" ? "翻訳を作成できませんでした。原文は配信済みです。" : "未能生成翻译，原文已发布。"}</span>{isAuthor && <button disabled={busy} onClick={() => void run(() => retryPresidentInstructionTranslation(row.id), locale === "ja" ? "翻訳を再実行しました。" : "已重新翻译。") }><RefreshCw size={14} />{locale === "ja" ? "再試行" : "重试"}</button>}</div>}
    {row.status === "active" && state?.status === "pending" && <button className="button primary instruction-main-action" disabled={busy} onClick={() => void run(() => acknowledgePresidentInstruction(row.id), locale === "ja" ? "お知らせを確認済みにしました。" : "已确认通知。") }><Check size={17} />{locale === "ja" ? "内容を確認しました" : "我已确认内容"}</button>}
    {row.status === "active" && state?.status === "acknowledged" && <div className="instruction-complete-box"><label><span>{locale === "ja" ? "返信コメント（任意）" : "回复内容（可选）"}</span><textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="button success" disabled={busy} onClick={() => void run(() => completePresidentInstruction(row.id, note.trim()), locale === "ja" ? "お知らせへの対応を完了しました。" : "通知已处理完成。") }><CheckCircle2 size={17} />{locale === "ja" ? "対応を完了" : "完成处理"}</button></div>}
    {isAuthor && row.status === "active" && <div className="instruction-president-actions"><button className="button ghost" onClick={() => setReissuing(true)}><RefreshCw size={15} />{locale === "ja" ? "取消して再発信" : "取消并重新发布"}</button><button className="button ghost danger-text" onClick={() => setCancelling((value) => !value)}>{locale === "ja" ? "取り消す" : "取消"}</button></div>}
    {cancelling && <div className="instruction-cancel-box"><label><span>{locale === "ja" ? "取消理由" : "取消原因"}</span><textarea rows={2} minLength={3} maxLength={500} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label><div><button className="button ghost" onClick={() => setCancelling(false)}>{locale === "ja" ? "戻る" : "返回"}</button><button className="button danger" disabled={busy || cancelReason.trim().length < 3} onClick={() => void run(() => cancelPresidentInstruction(row.id, cancelReason.trim()), locale === "ja" ? "お知らせを取り消しました。" : "通知已取消。")}>{locale === "ja" ? "取消を確定" : "确认取消"}</button></div></div>}
    {row.status === "cancelled" && row.cancellationReason && <p className="instruction-cancelled-reason">{locale === "ja" ? "取消理由" : "取消原因"}：{row.cancellationReason}</p>}
  </article>;
}

function AttachmentIcon({ attachment }: { attachment: Attachment }) {
  return attachment.contentType.startsWith("image/") ? <ImageIcon size={17} /> : <FileText size={17} />;
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function InstructionAttachmentLink({ attachment, locale }: { attachment: Attachment; locale: string }) {
  const [url, setUrl] = useState(attachment.downloadUrl || "");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    if (!url && attachment.storagePath) {
      void presidentInstructionAttachmentUrl(attachment.storagePath)
        .then((value) => { if (active) setUrl(value); })
        .catch(() => { if (active) setFailed(true); });
    }
    return () => { active = false; };
  }, [attachment.storagePath, url]);
  if (!url) return <span className={`instruction-attachment-link ${failed ? "failed" : "loading"}`}><AttachmentIcon attachment={attachment} /><span><strong>{attachment.name}</strong><small>{failed ? (locale === "ja" ? "開けません" : "无法打开") : (locale === "ja" ? "読込中…" : "加载中…")}</small></span></span>;
  return <a className="instruction-attachment-link" href={url} target="_blank" rel="noreferrer"><AttachmentIcon attachment={attachment} /><span><strong>{attachment.name}</strong><small>{formatAttachmentSize(attachment.size)}</small></span></a>;
}
