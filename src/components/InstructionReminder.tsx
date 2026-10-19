import { useEffect, useId, useMemo, useState } from "react";
import { BellRing } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { todayJst } from "../lib/format";
import { instructionReminderScope, instructionReminderWasShown, markInstructionReminderShown, nextJstReminderDelay, pendingReminderInstructions } from "../lib/instructionReminders";
import type { PresidentInstruction } from "../types";

function localizedTitle(row: PresidentInstruction, locale: string): string {
  const sourceLocale = row.sourceLocale === "zh-CN" ? "zh-CN" : "ja";
  if (row.translationStatus === "completed") {
    if (locale === "zh-CN" && sourceLocale === "ja" && row.titleZh && row.bodyZh) return row.titleZh;
    if (locale === "ja" && sourceLocale === "zh-CN" && row.titleJa && row.bodyJa) return row.titleJa;
  }
  return row.titleOriginal;
}

export function InstructionReminder({ instructions, onOpen, paused = false }: {
  instructions: PresidentInstruction[];
  onOpen: (instructionId: string) => void;
  paused?: boolean;
}) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const titleId = useId();
  const uid = profile?.uid || "";
  const scope = profile ? instructionReminderScope(profile) : "";
  const pending = useMemo(() => pendingReminderInstructions(instructions, uid), [instructions, uid]);
  const [day, setDay] = useState(todayJst);
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  const [prompt, setPrompt] = useState<{ scope: string; instructionId: string } | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    function refresh() {
      setVisible(document.visibilityState !== "hidden");
      setDay(todayJst());
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, nextJstReminderDelay());
    }
    refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    if (!scope || pending.length === 0) {
      setPrompt(null);
      return;
    }
    if (paused || !visible || document.visibilityState === "hidden") return;
    const unseen = pending.filter((row) => !instructionReminderWasShown(scope, row, uid, day));
    if (unseen.length > 0) {
      // This records only that the prompt was displayed, never acknowledgement.
      // One prompt represents the whole queue, so dismissing it is not followed
      // by another prompt for each already-pending announcement.
      pending.forEach((row) => markInstructionReminderShown(scope, row, uid, day));
      setPrompt({ scope, instructionId: unseen[0].id });
    }
  }, [day, paused, pending, scope, uid, visible]);

  const row = pending.find((item) => item.id === prompt?.instructionId) || pending[0];
  if (!row || !scope || prompt?.scope !== scope || paused || !visible) return null;

  function dismiss() {
    setPrompt(null);
  }

  return <aside className={`instruction-reminder ${row.priority === "urgent" ? "urgent" : ""}`} role="status" aria-live="polite" aria-atomic="true" aria-labelledby={titleId}>
    <BellRing className="instruction-reminder-icon" size={24} aria-hidden="true" />
    <div className="instruction-reminder-copy">
      <h2 id={titleId}>{locale === "ja" ? "未確認のお知らせがあります" : "有尚未确认的通知"}</h2>
      <p>{locale === "ja" ? `${row.authorName}からのお知らせ · ${pending.length}件未確認` : `来自${row.authorName}的通知 · ${pending.length}条未确认`}</p>
      <strong>{localizedTitle(row, locale)}</strong>
      {row.dueDate && <small>{locale === "ja" ? `期限 ${row.dueDate}` : `截止 ${row.dueDate}`}</small>}
      <p>{locale === "ja" ? "内容を開き、確認後に「内容を確認しました」を押してください。" : "请打开内容，阅读后点击“我已确认内容”。"}</p>
    </div>
    <div className="instruction-reminder-actions">
      <button type="button" onClick={() => { dismiss(); onOpen(row.id); }}>{locale === "ja" ? "内容を開く" : "打开内容"}</button>
      <button type="button" onClick={dismiss}>{locale === "ja" ? "あとで確認" : "稍后确认"}</button>
    </div>
  </aside>;
}
