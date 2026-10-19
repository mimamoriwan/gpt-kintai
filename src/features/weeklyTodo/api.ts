import { httpsCallable } from "firebase/functions";
import { auth, functions, prepareCallableSecurityContext } from "../../firebase";
import { invokeWithVerifiedSecurityContext } from "../../lib/callable";
import type { Locale } from "../../types";
import type { TodoHistory, TodoMutation, TodoTranslation, TodoWorkspace } from "./types";

async function call<I, O>(name: string, input: I): Promise<O> {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error("ログインが必要です。"), { code: "functions/unauthenticated" });
  const callable = httpsCallable<I, O>(functions, name, { timeout: 120000 });
  const result = await invokeWithVerifiedSecurityContext(prepareCallableSecurityContext, () => {
    if (auth.currentUser !== user) throw Object.assign(new Error("アカウントが切り替わりました。"), { code: "functions/unauthenticated" });
    return callable(input);
  });
  if (auth.currentUser !== user) throw Object.assign(new Error("アカウントが切り替わりました。"), { code: "functions/unauthenticated" });
  return result.data;
}
export const getWeeklyTodoWorkspace = (weekStart: string) => call<{ weekStart: string }, TodoWorkspace>("getWeeklyTodoWorkspace", { weekStart });
export const saveWeeklyTodoDraft = (input: TodoMutation) => call<TodoMutation, { version: number }>("saveWeeklyTodoDraft", input);
export const shareWeeklyTodo = (input: TodoMutation) => call<TodoMutation, { version: number }>("shareWeeklyTodo", input);
export const shareWeeklyTodoReview = (input: TodoMutation) => call<TodoMutation, { version: number }>("shareWeeklyTodoReview", input);
export const addWeeklyTodoToDailyReport = (input: { weekStart: string; itemId: string; expectedVersion: number; reportDate: string }) => call<typeof input, { reportDate: string; addedCount: number; alreadyAdded: boolean }>("addWeeklyTodoToDailyReport", input);
export const getWeeklyTodoHistory = (input: { weekStart: string; userId: string; cursor?: string }) => call<typeof input, { history: TodoHistory[]; cursor: string | null }>("getWeeklyTodoHistory", input);
export const translateWeeklyTodoContent = (input: { weekStart: string; userId: string; contentVersion: string; revision: number; targetLocale: Locale }) => call<typeof input, TodoTranslation>("translateWeeklyTodoContent", input);
export function todoError(error: unknown, locale: Locale) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code).replace("functions/", "") : "";
  const zh = locale === "zh-CN";
  const reason = error && typeof error === "object" && "details" in error && error.details && typeof error.details === "object" && "reason" in error.details ? error.details.reason : "";
  if (reason === "report-date-changed") return zh ? "日期已变更。输入已保留，请刷新后添加到今天的工作记录。" : "日付が変わりました。入力は残しています。再読み込みして本日の業務メモに追加してください。";
  if (reason === "report-week-not-current") return zh ? "仅可将本周的业务添加到今天的工作记录。" : "本日の業務メモに追加できるのは今週の業務だけです。";
  if (code === "aborted") return zh ? "其他页面已更新。输入已保留，请比较最新内容后再保存。" : "他の画面で更新されています。入力は残しています。最新内容と比較してから保存してください。";
  if (code === "permission-denied" || code === "unauthenticated" || code === "failed-precondition") return zh ? "请确认登录账号和使用权限后重试。" : "ログイン中のアカウントと利用権限をご確認ください。";
  if (code === "invalid-argument") return zh ? "请检查业务、目标、进度和实绩（最多30项）。" : "業務・目標・進捗・実績をご確認ください（最大30項目）。";
  return zh ? "通信未完成。输入已保留，请刷新确认保存结果。" : "通信を完了できませんでした。入力は残しています。再読み込みで保存結果をご確認ください。";
}
