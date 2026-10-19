import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { sendInstructionMessage, watchInstructionMessages } from "../services/api";
import type { InstructionMessage, PresidentInstruction } from "../types";

const PAGE_SIZE = 50;

export function InstructionChat({ row, active = true }: { row: PresidentInstruction; active?: boolean }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  if (!profile) return null;
  const recipients = row.authorId === profile.uid ? [...new Set(row.recipientIds)] : row.recipientIds.filter((id) => id === profile.uid);
  const recipientId = recipients.includes(selected) ? selected : recipients[0];
  if (!recipientId) return null;
  return <details className="instruction-chat" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><MessageCircle size={18} />{locale === "ja" ? "返信・チャット" : "回复与聊天"}</summary>
    <p className="instruction-chat-help">{locale === "ja" ? "発信者と各受信者だけの個別チャットです。対応完了後も何度でも返信できます。" : "这是发布者与各接收者的私聊。完成处理后仍可继续回复，不限次数。"}</p>
    {recipients.length > 1 && <label className="instruction-chat-recipient"><span>{locale === "ja" ? "会話の相手" : "聊天对象"}</span><select value={recipientId} onChange={(event) => setSelected(event.target.value)}>{recipients.map((id) => <option key={id} value={id}>{row.recipientStates[id]?.displayName || id}</option>)}</select></label>}
    {recipients.map((id) => <div key={`${profile.uid}:${id}`} hidden={id !== recipientId}>
      <Conversation row={row} recipientId={id} uid={profile.uid} active={active && open && id === recipientId} />
    </div>)}
  </details>;
}

function Conversation({ row, recipientId, uid, active }: { row: PresidentInstruction; recipientId: string; uid: string; active: boolean }) {
  const { locale } = useI18n();
  const [messages, setMessages] = useState<InstructionMessage[]>([]);
  const [count, setCount] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [newMessages, setNewMessages] = useState(false);
  const inputId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const previousHeight = useRef<number | null>(null);
  const pending = useRef<{ messageId: string; body: string } | undefined>(undefined);
  const inFlight = useRef(false);
  const cancelled = row.status === "cancelled";

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    setLoadError("");
    const unsubscribe = watchInstructionMessages(row.id, recipientId, count, (rows) => {
      if (!alive) return;
      setMessages((current) => {
        const merged = new Map(current.map((item) => [item.id, item]));
        rows.forEach((item) => merged.set(item.id, item));
        return [...merged.values()].sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis() || a.id.localeCompare(b.id));
      });
      setHasMore(rows.length >= count);
      setLoading(false);
      if (!stickToBottom.current && previousHeight.current === null) setNewMessages(true);
    }, (error) => {
      if (!alive) return;
      setLoading(false);
      setLoadError(error.message);
    });
    return () => { alive = false; unsubscribe(); };
  }, [active, row.id, recipientId, count, retry]);

  const state = row.recipientStates[recipientId];
  const history = useMemo(() => {
    const legacy: InstructionMessage[] = state?.completionNote ? [{
      id: "legacy-completion", senderId: recipientId, senderName: state.displayName,
      body: state.completionNote, createdAt: state.completedAt || row.createdAt
    }] : [];
    return [...messages, ...legacy].sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis() || a.id.localeCompare(b.id));
  }, [messages, state?.completionNote, state?.completedAt, state?.displayName, recipientId, row.createdAt]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!active || !element) return;
    if (previousHeight.current !== null && !loading) {
      element.scrollTop += element.scrollHeight - previousHeight.current;
      previousHeight.current = null;
    } else if (stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [active, history, loading]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (inFlight.current || !text || cancelled) return;
    inFlight.current = true;
    setSending(true);
    setSendError("");
    if (!pending.current || pending.current.body !== text) pending.current = { messageId: crypto.randomUUID(), body: text };
    try {
      await sendInstructionMessage({ instructionId: row.id, recipientId, ...pending.current });
      pending.current = undefined;
      setBody("");
      stickToBottom.current = true;
      setNewMessages(false);
      if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
    } catch (error) { setSendError(error instanceof Error ? error.message : String(error)); }
    finally { inFlight.current = false; setSending(false); }
  }

  useEffect(() => { if (!sending && active && document.activeElement?.tagName === "BUTTON") textarea.current?.focus({ preventScroll: true }); }, [sending]);

  return <div className="instruction-conversation">
    {hasMore && <button type="button" className="button ghost" disabled={loading} onClick={() => {
      previousHeight.current = viewport.current?.scrollHeight ?? null;
      stickToBottom.current = false;
      setCount((current) => current + PAGE_SIZE);
    }}>{locale === "ja" ? "以前の返信を読み込む" : "加载更早的回复"}</button>}
    {loading && <p role="status">{locale === "ja" ? "返信を読み込み中…" : "正在加载回复…"}</p>}
    {loadError && <div role="alert"><p>{locale === "ja" ? "返信を読み込めませんでした。" : "无法加载回复。"} {loadError}</p><button type="button" className="button ghost" onClick={() => setRetry((value) => value + 1)}>{locale === "ja" ? "再読み込み" : "重新加载"}</button></div>}
    <div ref={viewport} className="instruction-chat-log" role="log" aria-label={locale === "ja" ? "返信履歴" : "回复记录"} aria-live="polite" aria-relevant="additions" tabIndex={0} onScroll={() => {
      const element = viewport.current!;
      stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
      if (stickToBottom.current) setNewMessages(false);
    }}>
      {!loading && !loadError && history.length === 0 && <p className="instruction-chat-empty">{locale === "ja" ? "まだ返信はありません。ここからやり取りを始められます。" : "暂无回复，可在这里开始聊天。"}</p>}
      {history.map((message) => <div key={message.id} className={`instruction-chat-message ${message.senderId === uid ? "own" : ""}`}>
        <div className="instruction-chat-message-meta"><strong>{message.senderName}</strong><time dateTime={message.createdAt.toDate().toISOString()}>{message.createdAt.toDate().toLocaleString(locale === "ja" ? "ja-JP" : "zh-CN", { dateStyle: "short", timeStyle: "short" })}</time></div>
        <p>{message.body}</p>
        {message.id === "legacy-completion" && <small>{locale === "ja" ? "対応完了時のコメント" : "完成处理时的备注"}</small>}
      </div>)}
    </div>
    {newMessages && <button type="button" className="button ghost" onClick={() => {
      stickToBottom.current = true;
      setNewMessages(false);
      if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
    }}>{locale === "ja" ? "最新の返信へ" : "查看最新回复"}</button>}
    {cancelled ? <p className="instruction-chat-help">{locale === "ja" ? "取り消されたお知らせのため、返信履歴のみ閲覧できます。" : "通知已取消，仅可查看回复记录。"}</p> : <form className="instruction-chat-form" onSubmit={send}>
      <label htmlFor={inputId}>{locale === "ja" ? "メッセージ" : "消息"}</label>
      <textarea ref={textarea} id={inputId} rows={3} maxLength={2000} value={body} disabled={sending} onChange={(event) => setBody(event.target.value)} placeholder={locale === "ja" ? "返信を入力してください" : "请输入回复"} />
      {sendError && <p role="alert">{locale === "ja" ? "送信できませんでした。入力内容を残しています。再度送信してください。" : "发送失败，已保留输入内容，请重试。"} {sendError}</p>}
      <div><small>{body.length} / 2000</small><button className="button primary" disabled={sending || !body.trim()}><Send size={16} />{sending ? (locale === "ja" ? "送信中…" : "发送中…") : (locale === "ja" ? "返信を送信" : "发送回复")}</button></div>
    </form>}
  </div>;
}
