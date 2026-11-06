import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { useI18n } from "../../i18n";
import { getWeeklyTodoWorkspace, todoError } from "../weeklyTodo/api";
import { mondayOf } from "../weeklyTodo/calendar";
import type { TodoWeek } from "../weeklyTodo/types";
import { businessCopy } from "./presentation";
import type { BusinessInitiative, BusinessWorkspace } from "./types";
import { useBusinessTranslation } from "./useBusinessTranslation";

export function BusinessWeeklyAssignments({ workspace, assigneeId, openWeek, openInitiative }: {
  workspace: BusinessWorkspace;
  assigneeId: string;
  openWeek: (memberId?: string) => void;
  openInitiative: (id: string) => void;
}) {
  const { locale } = useI18n();
  const c = businessCopy(locale);
  const weekStart = mondayOf();
  const [result, setResult] = useState<{ weekStart: string; sharedWeeks?: TodoWeek[]; error?: unknown }>();
  const members = workspace.members.filter(member => member.active && workspace.settings.memberIds.includes(member.uid));

  useEffect(() => {
    let current = true;
    // Only retain the server-filtered shared snapshots in the company overview.
    void getWeeklyTodoWorkspace(weekStart).then(next => {
      if (current) setResult({ weekStart, sharedWeeks: next.weeks.filter(row => row.weekStart === weekStart) });
    }).catch(error => {
      if (current) setResult({ weekStart, error });
    });
    return () => { current = false; };
  }, [weekStart, workspace.fetchedAt, workspace.settings.version]);

  const current = result?.weekStart === weekStart ? result : undefined;
  return <aside className="business-weekly-assignments" aria-labelledby="business-weekly-assignments-title">
    <h2 id="business-weekly-assignments-title">{c("今週の担当", "本周分工")}</h2>
    <p className="business-muted">{c("共有済みの予定", "已共享的计划")} · {weekStart}</p>
    {!current && <p role="status">{c("共有予定を読み込み中…", "正在加载共享计划…")}</p>}
    {current && "error" in current && <p role="status">{todoError(current.error, locale)}</p>}
    {current?.sharedWeeks && <ul className="business-weekly-members">
      {members.map(member => {
        const tasks = (current.sharedWeeks?.find(row => row.userId === member.uid)?.shared.items ?? [])
          .filter(item => !item.withdrawn && item.title.trim())
          .sort((a, b) => Number(a.progress === 100) - Number(b.progress === 100));
        return <li key={member.uid} className={member.uid === assigneeId ? "business-weekly-member selected" : "business-weekly-member"}>
          <button type="button" className="business-weekly-member-name" onClick={() => openWeek(member.uid)} aria-label={c(`${member.displayName}の今週の作業を開く`, `打开${member.displayName}的本周工作`)}>{member.displayName}</button>
          {tasks.length === 0 ? <p className="business-muted">{c("共有済みの作業はありません", "暂无已共享的任务")}</p> : <ul className="business-weekly-tasks">
            {tasks.slice(0, 2).map(task => {
              const initiative = workspace.initiatives.find(row => row.id === task.businessLink?.initiativeId);
              return <li key={task.id}>
                <strong lang={task.sourceLocale}>{task.title}</strong>
                <small className={task.progress === 100 ? "business-weekly-done" : "business-muted"}>{task.progress === 100 ? c("完了", "已完成") : `${task.progress}%`}</small>
                {initiative && <LinkedInitiativeButton initiative={initiative} onOpen={() => openInitiative(initiative.id)} />}
              </li>;
            })}
          </ul>}
          {tasks.length > 2 && <small className="business-muted">{c(`ほか${tasks.length - 2}件`, `另有${tasks.length - 2}项`)}</small>}
        </li>;
      })}
    </ul>}
    <button type="button" className="business-weekly-open" onClick={() => openWeek()}>{c("今週の作業を開く", "打开本周工作")}</button>
  </aside>;
}

function LinkedInitiativeButton({ initiative, onOpen }: { initiative: BusinessInitiative; onOpen: () => void }) {
  const { locale } = useI18n();
  const { fields } = useBusinessTranslation("initiative", initiative);
  return <button type="button" className="business-weekly-initiative" onClick={onOpen}>
    <Link2 size={14} aria-hidden="true" /><span lang={fields?.name ? locale : initiative.sourceLocale}>{fields?.name || initiative.name}</span>
  </button>;
}
