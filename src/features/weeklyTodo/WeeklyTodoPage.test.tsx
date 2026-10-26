import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale, UserProfile } from "../../types";
import { WeeklyTodoPage } from "./WeeklyTodoPage";
import { mondayOf } from "./calendar";
import { todayJst } from "../../lib/format";
import type { TodoItem, TodoSnapshot, TodoWorkspace } from "./types";

const state = vi.hoisted(() => ({ locale: "ja" as Locale }));
const api = vi.hoisted(() => ({ getWeeklyTodoWorkspace: vi.fn(), saveWeeklyTodoDraft: vi.fn(), shareWeeklyTodo: vi.fn(), shareWeeklyTodoReview: vi.fn(), getWeeklyTodoHistory: vi.fn(), translateWeeklyTodoContent: vi.fn(), addWeeklyTodoToDailyReport: vi.fn() }));
vi.mock("../../i18n", () => ({ useI18n: () => state }));
vi.mock("./api", () => ({ ...api, todoError: () => "入力は残しています。最新内容をご確認ください。" }));
const profile: UserProfile = { uid: "owner", displayName: "担当者A", email: "a@example.test", active: true, locale: "ja", role: "employee" };
const president: UserProfile = { ...profile, uid: "president", displayName: "社長", role: "president_viewer" };
const writers = [profile, president];
const item = (patch: Partial<TodoItem> = {}): TodoItem => ({ id: "item-a", title: "資料を作成", goal: "初稿を完成", progress: 0, memo: "", withdrawn: false, sourceLocale: "ja", memoLocale: "ja", ...patch });
const snapshot = (items = [item()], revision = 1): TodoSnapshot => ({ items, revision, at: 1792368000000, contentVersion: `hash-${revision}` });
const shared = (content = snapshot()) => ({ userId: "owner", weekStart: mondayOf(), shared: content, initial: snapshot(), review: null, reviewRevision: null });
const workspace = (patch: Partial<TodoWorkspace> = {}): TodoWorkspace => ({ weekStart: mondayOf(), weekEnd: "2026-10-25", targetDate: "2026-10-23", fetchedAt: 1,
  members: [{ uid: "owner", displayName: "担当者A", role: "employee" }, { uid: "other", displayName: "担当者B", role: "employee_manager" }, { uid: "president", displayName: "社長", role: "president_viewer" }],
  weeks: [], ownDraft: { items: [], version: 0 }, carryover: [], reportLink: { reportDate: todayJst(), items: [] }, ...patch });
beforeEach(() => {
  vi.resetAllMocks(); state.locale = "ja";
  api.getWeeklyTodoWorkspace.mockResolvedValue(workspace()); api.saveWeeklyTodoDraft.mockResolvedValue({ version: 1 }); api.shareWeeklyTodo.mockResolvedValue({ version: 1 }); api.shareWeeklyTodoReview.mockResolvedValue({ version: 1 }); api.getWeeklyTodoHistory.mockResolvedValue({ history: [], cursor: null });
  api.addWeeklyTodoToDailyReport.mockResolvedValue({ reportDate: todayJst(), addedCount: 1, alreadyAdded: false });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const show = (user = profile) => render(<WeeklyTodoPage key={user.uid} profile={user} />);
async function ready() { await screen.findByRole("heading", { name: "みんなの予定・進捗" }); }
function fill() {
  fireEvent.click(screen.getByRole("button", { name: "業務を追加" })); fireEvent.change(screen.getByLabelText("取り組む業務"), { target: { value: "比較資料" } }); fireEvent.change(screen.getByLabelText("金曜日までの到達目標"), { target: { value: "比較表の初稿" } });
}
describe("weekly To Do workspace", () => {
  it("orders the member picker by role and shows only the selected member's plan", async () => {
    const people = workspace().members;
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ members: [people[1], people[0], people[2]], weeks: [
      { ...shared(snapshot([item({ title: "社長の予定" })])), userId: "president" },
      { ...shared(snapshot([item({ title: "管理担当者の予定" })])), userId: "other" },
      shared(snapshot([item({ title: "担当者の予定" })]))
    ] }));
    show(); await ready();
    const picker = within(screen.getByRole("group", { name: "予定を見るメンバー" }));
    expect(picker.getAllByRole("button").map(button => button.textContent)).toEqual(["社長共有済み", "担当者B共有済み", "担当者A共有済み"]);
    expect(picker.getByRole("button", { name: /社長/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("heading", { name: "社長の予定" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "担当者の予定" })).not.toBeInTheDocument();
    fireEvent.click(picker.getByRole("button", { name: /担当者A/ }));
    expect(screen.queryByRole("heading", { name: "社長の予定" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "担当者の予定" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    await waitFor(() => expect(api.getWeeklyTodoWorkspace).toHaveBeenCalledTimes(2));
    expect(picker.getByRole("button", { name: /担当者A/ })).toHaveAttribute("aria-pressed", "true");
  });
  it("adds directly from the shared view, focuses the new task, and preserves input when changing views", async () => {
    const items = Array.from({ length: 20 }, (_, index) => item({ id: `existing-${index}`, title: `業務 ${index}` }));
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ ownDraft: { items, version: 1 } }));
    show(); await ready();
    fireEvent.click(screen.getByRole("button", { name: "業務を追加" }));
    const added = screen.getAllByLabelText("取り組む業務").at(-1)!;
    expect(added).toHaveFocus(); expect(added).toHaveValue("");
    fireEvent.change(added, { target: { value: "追加した予定" } });
    fireEvent.click(screen.getByRole("button", { name: "みんなの予定" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("未保存の入力があります")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "自分の入力へ" }));
    expect(screen.getAllByLabelText("取り組む業務").at(-1)).toHaveValue("追加した予定");
    fireEvent.click(screen.getByRole("button", { name: "下書き保存" }));
    await waitFor(() => expect(api.saveWeeklyTodoDraft).toHaveBeenCalled());
    expect(api.saveWeeklyTodoDraft.mock.calls[0][0].items).toHaveLength(21);
    expect(api.saveWeeklyTodoDraft.mock.calls[0][0].items[0].id).toBe("existing-0");
  });
  it("keeps the limit of 30 tasks and blocks additions during a conflicting save", async () => {
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ ownDraft: { items: Array.from({ length: 30 }, (_, index) => item({ id: `task-${index}` })), version: 1 } }));
    show(); await ready();
    expect(screen.getByRole("button", { name: /業務を追加/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "自分の入力へ" }));
    expect(screen.getByRole("button", { name: /業務を追加/ })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    expect(screen.getByRole("button", { name: "業務を追加" })).toBeEnabled();
    api.saveWeeklyTodoDraft.mockRejectedValueOnce({ code: "functions/aborted" });
    fireEvent.click(screen.getByRole("button", { name: "下書き保存" }));
    await screen.findByText("最新の下書きと入力内容を比較してください");
    expect(screen.getByRole("button", { name: "業務を追加" })).toBeDisabled();
  });
  it("starts with the current JST week and shows unshared members", async () => {
    show(); await ready(); expect(api.getWeeklyTodoWorkspace).toHaveBeenCalledWith(mondayOf()); expect(screen.getAllByText("予定未共有")).toHaveLength(4);
    expect(screen.getByRole("heading", { name: "社長" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "自分の予定・進捗を入力" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "自分の入力" }));
    expect(screen.getByRole("heading", { name: "自分の予定・進捗を入力" })).toBeInTheDocument();
  });
  it.each(writers)("saves $role's private draft without publishing and sends a stable item ID", async user => {
    show(user); await ready(); fill(); fireEvent.click(screen.getByRole("button", { name: "下書き保存" }));
    await screen.findByText("下書きを保存しました。本人だけが閲覧できます。"); expect(api.shareWeeklyTodo).not.toHaveBeenCalled();
    expect(api.saveWeeklyTodoDraft.mock.calls[0][0]).toMatchObject({ expectedVersion: 0, items: [{ title: "比較資料", goal: "比較表の初稿", progress: 0, memo: "" }] });
    expect(api.saveWeeklyTodoDraft.mock.calls[0][0].items[0].id).toBeTruthy();
  });
  it.each(writers)("publishes $role's tasks only on explicit share, with validation and per-item percentage", async user => {
    show(user); await ready(); fireEvent.click(screen.getByRole("button", { name: "業務を追加" })); fireEvent.click(screen.getByRole("button", { name: "共有する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("各項目の業務"); expect(api.shareWeeklyTodo).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("取り組む業務"), { target: { value: "比較資料" } }); fireEvent.change(screen.getByLabelText("金曜日までの到達目標"), { target: { value: "初稿" } }); fireEvent.change(screen.getByLabelText("進捗率（％）"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "共有する" })); await waitFor(() => expect(api.shareWeeklyTodo).toHaveBeenCalled()); expect(api.shareWeeklyTodo.mock.calls[0][0].items[0].progress).toBe(50);
  });
  it.each(writers)("requires $role's reflection memos and supports 100 percent completion", async user => {
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ ownDraft: { items: [item()], version: 1 }, weeks: [{ ...shared(), userId: user.uid }] }));
    show(user); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" })); fireEvent.click(screen.getByRole("button", { name: "今週の振り返りを共有" })); expect(await screen.findByRole("alert")).toHaveTextContent("実績・残ったこと");
    fireEvent.change(screen.getByLabelText("実績・残ったこと"), { target: { value: "初稿を完成した" } }); fireEvent.change(screen.getByLabelText("進捗率（％）"), { target: { value: "100" } }); fireEvent.click(screen.getByRole("button", { name: "今週の振り返りを共有" }));
    await waitFor(() => expect(api.shareWeeklyTodoReview).toHaveBeenCalled()); expect(api.shareWeeklyTodoReview.mock.calls[0][0].items[0]).toMatchObject({ progress: 100, memo: "初稿を完成した" });
  });
  it("keeps local changes on refresh while showing the prior shared snapshot", async () => {
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ ownDraft: { items: [item()], version: 1 }, weeks: [shared()] })); show(); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" }));
    fireEvent.change(screen.getByLabelText("取り組む業務"), { target: { value: "未共有の変更" } });
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" })); await waitFor(() => expect(api.getWeeklyTodoWorkspace).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("取り組む業務")).toHaveValue("未共有の変更"); fireEvent.click(screen.getByRole("button", { name: "みんなの予定" })); fireEvent.click(screen.getByRole("button", { name: /担当者A/ })); expect(screen.getAllByRole("heading", { name: "資料を作成" }).length).toBeGreaterThan(0);
  });
  it.each(writers)("preserves $role's input on network errors and requires comparing a conflicting draft", async user => {
    api.saveWeeklyTodoDraft.mockRejectedValueOnce({ code: "functions/unavailable" }).mockRejectedValueOnce({ code: "functions/aborted" });
    show(user); await ready(); fill(); fireEvent.click(screen.getByRole("button", { name: "下書き保存" })); await screen.findByRole("alert");
    expect(screen.getByLabelText("取り組む業務")).toHaveValue("比較資料");
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ ownDraft: { items: [item({ title: "他の画面の更新" })], version: 2 } }));
    fireEvent.click(screen.getByRole("button", { name: "下書き保存" })); await screen.findByText("最新の下書きと入力内容を比較してください");
    expect(screen.getByRole("button", { name: "下書き保存" })).toBeDisabled(); expect(screen.getByText(/他の画面の更新/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "比較したので、この入力を保持して編集を続ける" })); expect(screen.getByLabelText("取り組む業務")).toHaveValue("比較資料");
    api.saveWeeklyTodoDraft.mockResolvedValue({ version: 3 }); fireEvent.click(screen.getByRole("button", { name: "下書き保存" })); await waitFor(() => expect(api.saveWeeklyTodoDraft).toHaveBeenCalledTimes(3)); expect(api.saveWeeklyTodoDraft.mock.calls[2][0].expectedVersion).toBe(2);
  });
  it.each(writers)("shows $role's automatically carried draft with its saved progress and memo, without requiring a selection", async user => {
    const origin = item({ progress: 75, memo: "前週の実績", carriedFrom: { weekStart: "2026-10-12", itemId: "item-a" } });
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ ownDraft: { items: [origin], version: 1 } })); show(user); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" }));
    expect(screen.getByLabelText("取り組む業務")).toHaveValue("資料を作成"); expect(screen.getByLabelText("進捗率（％）")).toHaveValue(75); expect(screen.getByLabelText("実績・残ったこと")).toHaveValue("前週の実績");
    expect(screen.getByText("2026-10-12の週から引き継ぎ")).toBeInTheDocument(); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(api.saveWeeklyTodoDraft).not.toHaveBeenCalled(); expect(api.shareWeeklyTodo).not.toHaveBeenCalled();
  });
  it.each(["ja", "zh-CN"] as const)("explains pending automatic carryover in %s without exposing old task text", async locale => {
    state.locale = locale;
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ carryoverPending: [{ weekStart: "2026-10-12", itemId: "pending" }] }));
    show();
    expect(await screen.findByText(locale === "ja" ? /未完了の1件が引き継ぎ待ち/ : /1项未完成事项正在等待结转/)).toBeInTheDocument();
  });
  it("withdraws a shared task instead of deleting it", async () => {
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ ownDraft: { items: [item()], version: 1 }, weeks: [shared()] })); show(); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" }));
    fireEvent.click(screen.getByRole("button", { name: "取り下げる" })); expect(screen.getByRole("button", { name: "取り下げを戻す" })).toBeInTheDocument(); expect(screen.getByLabelText("取り組む業務")).toHaveValue("資料を作成");
  });
  it("shows the reflection-updated status and provides the original goal and history", async () => {
    const row = { ...shared(snapshot([item({ goal: "変更後" })], 3)), review: snapshot([item({ progress: 50, memo: "半分" })], 2), reviewRevision: 2 };
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ weeks: [row] })); api.getWeeklyTodoHistory.mockResolvedValue({ history: [{ kind: "share", snapshot: snapshot() }], cursor: null });
    show(); await ready(); fireEvent.click(screen.getByRole("button", { name: /担当者A/ })); expect(screen.getByText(/振り返り共有後に更新あり/)).toBeInTheDocument();
    const history = screen.getByText("予定・進捗の変更履歴").parentElement! as HTMLDetailsElement; history.open = true; fireEvent(history, new Event("toggle")); await waitFor(() => expect(api.getWeeklyTodoHistory).toHaveBeenCalled());
  });
  it("lets the president edit its own tasks with Chinese copy", async () => {
    state.locale = "zh-CN"; show(president);
    await screen.findByRole("heading", { name: "大家的计划与进度" }); expect(screen.getByRole("heading", { name: "本周待办" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加业务" })); fireEvent.change(screen.getByLabelText("开展的业务"), { target: { value: "准备资料" } }); fireEvent.change(screen.getByLabelText("周五前的目标"), { target: { value: "完成初稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" })); await waitFor(() => expect(api.saveWeeklyTodoDraft).toHaveBeenCalled());
    expect(api.saveWeeklyTodoDraft.mock.calls[0][0].items[0]).toMatchObject({ title: "准备资料", goal: "完成初稿", sourceLocale: "zh-CN" });
  });
  it("shows the president's shared plan to employees without putting it in their editor", async () => {
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ weeks: [{ ...shared(snapshot([item({ title: "社長の共有予定" })])), userId: "president" }] }));
    show(); await ready();
    const card = screen.getByRole("heading", { name: "社長" }).closest("article")!;
    expect(within(card).getAllByRole("heading", { name: "社長の共有予定" }).length).toBeGreaterThan(0);
    expect(within(card).queryByRole("textbox")).not.toBeInTheDocument(); expect(screen.queryByLabelText("取り組む業務")).not.toBeInTheDocument();
    fill(); expect(screen.getByLabelText("取り組む業務")).toHaveValue("比較資料");
    fireEvent.click(screen.getByRole("button", { name: /^みんなの予定$/ }));
    expect(within(card).getAllByRole("heading", { name: "社長の共有予定" }).length).toBeGreaterThan(0);
  });
  it("automatically translates, offers original text, and falls back on translation failure", async () => {
    const content = snapshot([item({ title: "准备资料", goal: "周五完成初稿", sourceLocale: "zh-CN" })]);
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ weeks: [shared(content)] }));
    api.translateWeeklyTodoContent.mockResolvedValue({ contentVersion: content.contentVersion, targetLocale: "ja", fields: { "item-a:title": "資料の準備", "item-a:goal": "金曜に初稿完成" } });
    const view = show(); await ready(); fireEvent.click(screen.getByRole("button", { name: /担当者A/ })); await screen.findAllByRole("heading", { name: "資料の準備" }); expect(api.translateWeeklyTodoContent).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: "原文を表示" })[0]); expect(screen.getAllByRole("heading", { name: "准备资料" }).length).toBeGreaterThan(0);
    view.unmount(); api.translateWeeklyTodoContent.mockRejectedValue(Error("offline")); show(); await ready(); fireEvent.click(screen.getByRole("button", { name: /担当者A/ })); await screen.findAllByText("翻訳できませんでした・原文を表示"); expect(screen.getAllByRole("heading", { name: "准备资料" }).length).toBeGreaterThan(0);
  });
  it("ignores an old account's delayed response after switching accounts", async () => {
    let resolve!: (value: TodoWorkspace) => void; api.getWeeklyTodoWorkspace.mockReturnValueOnce(new Promise<TodoWorkspace>(done => { resolve = done; }));
    const view = show(); view.rerender(<WeeklyTodoPage key="other" profile={{ ...profile, uid: "other" }} />); await ready();
    await act(async () => resolve(workspace({ ownDraft: { items: [item({ title: "OLD PRIVATE" })], version: 1 } })));
    expect(screen.queryByDisplayValue("OLD PRIVATE")).not.toBeInTheDocument();
  });
  it("warns before switching weeks with unsaved input", async () => {
    show(); await ready(); fill(); const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "翌週" })); expect(confirm).toHaveBeenCalled(); expect(screen.getByLabelText("取り組む業務")).toHaveValue("比較資料"); expect(api.getWeeklyTodoWorkspace).toHaveBeenCalledTimes(1);
  });
});

describe("add updated work to today's report", () => {
  const saved = (progress = 0, added = false) => workspace({ ownDraft: { items: [item({ progress })], version: progress ? 2 : 1 }, reportLink: { reportDate: todayJst(), items: progress ? [{ itemId: "item-a", added }] : [] } });
  it("offers the button only after updating progress or content and saves a private draft before adding", async () => {
    api.getWeeklyTodoWorkspace.mockResolvedValueOnce(saved()).mockResolvedValue(saved(50, true)); api.saveWeeklyTodoDraft.mockResolvedValue({ version: 2 });
    const open = vi.fn(); render(<WeeklyTodoPage profile={profile} onOpenReport={open} />); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" }));
    expect(screen.queryByRole("button", { name: "本日の日報に追加" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("進捗率（％）"), { target: { value: "50" } });
    expect(api.addWeeklyTodoToDailyReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "本日の日報に追加" }));
    await screen.findByText(/「今日の業務メモ」に追加しました/);
    expect(api.saveWeeklyTodoDraft).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 1, items: [expect.objectContaining({ progress: 50 })] }));
    expect(api.addWeeklyTodoToDailyReport).toHaveBeenCalledWith({ weekStart: mondayOf(), itemId: "item-a", expectedVersion: 2, reportDate: todayJst() });
    expect(api.shareWeeklyTodo).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "本日の日報に追加済み" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: `${todayJst()}の日報を開く` })); expect(open).toHaveBeenCalledWith(todayJst());
  });
  it("offers the action for memo changes and removes it when the edit is undone", async () => {
    api.getWeeklyTodoWorkspace.mockResolvedValue(saved()); show(); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" }));
    fireEvent.change(screen.getByLabelText("実績・残ったこと"), { target: { value: "内容を追記" } }); expect(screen.getByRole("button", { name: "本日の日報に追加" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("実績・残ったこと"), { target: { value: "" } }); expect(screen.queryByRole("button", { name: "本日の日報に追加" })).not.toBeInTheDocument();
  });
  it("retains the saved update after a failed addition and retries without another draft save", async () => {
    api.getWeeklyTodoWorkspace.mockResolvedValueOnce(saved()).mockResolvedValue(saved(50)); api.saveWeeklyTodoDraft.mockResolvedValue({ version: 2 });
    api.addWeeklyTodoToDailyReport.mockRejectedValueOnce({ code: "functions/unavailable" }).mockResolvedValue({ reportDate: todayJst(), addedCount: 0, alreadyAdded: true });
    show(); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" })); fireEvent.change(screen.getByLabelText("進捗率（％）"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "本日の日報に追加" })); await screen.findByRole("alert");
    expect(screen.getByLabelText("進捗率（％）")).toHaveValue(50);
    fireEvent.click(screen.getByRole("button", { name: "本日の日報に追加" })); await screen.findByText(/「今日の業務メモ」に追加済みです/);
    expect(api.saveWeeklyTodoDraft).toHaveBeenCalledTimes(1); expect(api.addWeeklyTodoToDailyReport).toHaveBeenCalledTimes(2);
  });
  it("does not add on a draft conflict and preserves the local input", async () => {
    api.getWeeklyTodoWorkspace.mockResolvedValue(saved()); api.saveWeeklyTodoDraft.mockRejectedValue({ code: "functions/aborted" }); show(); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" }));
    fireEvent.change(screen.getByLabelText("進捗率（％）"), { target: { value: "50" } }); fireEvent.click(screen.getByRole("button", { name: "本日の日報に追加" }));
    await screen.findByText("最新の下書きと入力内容を比較してください"); expect(screen.getByLabelText("進捗率（％）")).toHaveValue(50); expect(api.addWeeklyTodoToDailyReport).not.toHaveBeenCalled();
  });
  it("offers another addition after an already added task changes again", async () => {
    api.getWeeklyTodoWorkspace.mockResolvedValue(saved(50, true)); show(); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" }));
    expect(screen.getByRole("button", { name: "本日の日報に追加済み" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("進捗率（％）"), { target: { value: "100" } });
    fireEvent.click(document.querySelector(".todo-item-editor.todo-completed > summary")!);
    expect(screen.getByRole("button", { name: "本日の日報に追加" })).toBeEnabled();
  });
  it("hides report actions for presidents, withdrawals and another week", async () => {
    api.getWeeklyTodoWorkspace.mockResolvedValue(saved(50)); const view = show(president); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" })); expect(screen.queryByRole("button", { name: "本日の日報に追加" })).not.toBeInTheDocument();
    view.unmount(); api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ ownDraft: { items: [item({ progress: 50, withdrawn: true })], version: 1 } })); const withdrawn = show(); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" })); expect(screen.queryByRole("button", { name: "本日の日報に追加" })).not.toBeInTheDocument();
    withdrawn.unmount(); api.getWeeklyTodoWorkspace.mockResolvedValue(saved(50)); show(); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" })); fireEvent.click(screen.getByRole("button", { name: "前週" })); await waitFor(() => expect(screen.queryByRole("button", { name: "本日の日報に追加" })).not.toBeInTheDocument());
  });
  it("does not continue adding for the old account after an account switch", async () => {
    let finish!: (value: { version: number }) => void; api.getWeeklyTodoWorkspace.mockResolvedValue(saved()); api.saveWeeklyTodoDraft.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = show(); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" })); fireEvent.change(screen.getByLabelText("進捗率（％）"), { target: { value: "50" } }); fireEvent.click(screen.getByRole("button", { name: "本日の日報に追加" }));
    view.rerender(<WeeklyTodoPage key="president" profile={president} />); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" })); await act(async () => finish({ version: 2 })); expect(api.addWeeklyTodoToDailyReport).not.toHaveBeenCalled();
  });
  it("renders the daily report action in Chinese", async () => {
    state.locale = "zh-CN"; api.getWeeklyTodoWorkspace.mockResolvedValue(saved(50)); show();
    fireEvent.click(within(await screen.findByRole("group", { name: "切换显示" })).getByRole("button", { name: "填写我的计划" }));
    expect(await screen.findByRole("button", { name: "添加到今日日报" })).toBeEnabled();
  });
});

describe("completed weekly To Do items", () => {
  const completed = () => item({ progress: 100, memo: "初稿を完成して共有しました。" });
  const completedPanel = () => document.querySelector<HTMLDetailsElement>("#todo-selected-member > article > .todo-snapshot > details.todo-completed")!;
  const editorPanel = () => document.querySelector<HTMLDetailsElement>(".todo-item-editor.todo-completed")!;

  it("collapses completed shared work, keeps ongoing work visible and toggles without changing data", async () => {
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ weeks: [shared(snapshot([completed(), item({ id: "ongoing", title: "次の資料", progress: 99 })]))] }));
    show(); await ready(); fireEvent.click(screen.getByRole("button", { name: /担当者A/ }));
    const panel = completedPanel(); const summary = panel.querySelector("summary")!;
    expect(summary).toHaveTextContent("資料を作成完了"); expect(panel).not.toHaveAttribute("open");
    expect(within(panel).getByText("初稿を完成して共有しました。")).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "次の資料" })).toBeVisible();
    fireEvent.click(summary);
    expect(panel).toHaveAttribute("open"); expect(within(panel).getByText("初稿を完成して共有しました。")).toBeVisible(); expect(within(panel).getByText("100％")).toBeVisible();
    fireEvent.click(summary); expect(panel).not.toHaveAttribute("open");
    expect(api.saveWeeklyTodoDraft).not.toHaveBeenCalled(); expect(api.shareWeeklyTodo).not.toHaveBeenCalled();
  });

  it("keeps completed editor items and their data when saving and sharing", async () => {
    const task = completed();
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ ownDraft: { items: [task], version: 1 }, weeks: [shared(snapshot([task]))] }));
    show(); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" }));
    expect(editorPanel()).not.toHaveAttribute("open");
    fireEvent.click(editorPanel().querySelector("summary")!);
    expect(screen.getByLabelText("実績・残ったこと")).toBeVisible(); expect(screen.getByLabelText("進捗率（％）")).toHaveValue(100);
    fireEvent.click(screen.getByRole("button", { name: "下書き保存" }));
    await waitFor(() => expect(api.saveWeeklyTodoDraft).toHaveBeenCalledWith(expect.objectContaining({ items: [task] })));
    await waitFor(() => expect(screen.getByRole("button", { name: "変更を共有" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "変更を共有" }));
    await waitFor(() => expect(api.shareWeeklyTodo).toHaveBeenCalledWith(expect.objectContaining({ items: [task] })));
    expect(task.withdrawn).toBe(false);
  });

  it("collapses at 100 percent, preserves local edits and restores the editor below 100", async () => {
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ ownDraft: { items: [item({ progress: 90, memo: "編集中の実績" })], version: 1 } }));
    show(); await ready(); fireEvent.click(screen.getByRole("button", { name: "自分の入力" }));
    fireEvent.change(screen.getByLabelText("金曜日までの到達目標"), { target: { value: "更新した到達目標" } });
    fireEvent.change(screen.getByLabelText("進捗率（％）"), { target: { value: "100" } });
    expect(editorPanel()).not.toHaveAttribute("open"); expect(screen.getByLabelText("実績・残ったこと")).not.toBeVisible();
    fireEvent.click(editorPanel().querySelector("summary")!);
    expect(screen.getByLabelText("金曜日までの到達目標")).toHaveValue("更新した到達目標"); expect(screen.getByLabelText("実績・残ったこと")).toHaveValue("編集中の実績");
    fireEvent.change(screen.getByLabelText("進捗率（％）"), { target: { value: "99" } });
    expect(editorPanel()).toBeNull(); expect(screen.getByLabelText("進捗率（％）")).toBeVisible(); expect(screen.getByLabelText("実績・残ったこと")).toHaveValue("編集中の実績");
    fireEvent.click(screen.getByRole("button", { name: "共有する" }));
    await waitFor(() => expect(api.shareWeeklyTodo).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ progress: 99, goal: "更新した到達目標", memo: "編集中の実績", withdrawn: false })] })));
  });

  it("keeps withdrawn work distinct even if its progress is 100 percent", async () => {
    const task = { ...completed(), withdrawn: true };
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ weeks: [shared(snapshot([task]))], ownDraft: { items: [task], version: 1 } }));
    show(); await ready(); fireEvent.click(screen.getByRole("button", { name: /担当者A/ }));
    expect(completedPanel()).toBeNull(); expect(screen.getByRole("heading", { name: /資料を作成.*取り下げ/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "自分の入力" })); expect(editorPanel()).toBeNull(); expect(screen.getByLabelText("進捗率（％）")).toBeVisible();
  });

  it("opens each completed task independently and retains the open state during refresh", async () => {
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ weeks: [shared(snapshot([completed(), item({ id: "second", title: "確認を完了", progress: 100 })]))] }));
    show(); await ready(); fireEvent.click(screen.getByRole("button", { name: /担当者A/ }));
    const panels = document.querySelectorAll<HTMLDetailsElement>("#todo-selected-member > article > .todo-snapshot > details.todo-completed");
    fireEvent.click(panels[0].querySelector("summary")!); expect(panels[0]).toHaveAttribute("open"); expect(panels[1]).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" })); await waitFor(() => expect(api.getWeeklyTodoWorkspace).toHaveBeenCalledTimes(2));
    expect(completedPanel()).toHaveAttribute("open"); expect(panels[1]).not.toHaveAttribute("open");
  });

  it("retains initial goals, reviews and history as expandable completed records", async () => {
    const content = snapshot([completed()]);
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ weeks: [{ ...shared(content), initial: content, review: content, reviewRevision: 1 }] }));
    api.getWeeklyTodoHistory.mockResolvedValue({ history: [{ kind: "share", snapshot: content }], cursor: null });
    show(); await ready(); fireEvent.click(screen.getByRole("button", { name: /担当者A/ }));
    for (const label of ["最初に共有した目標", "共有した振り返り", "予定・進捗の変更履歴"]) fireEvent.click(screen.getByText(label, { selector: "summary" }));
    await waitFor(() => expect(api.getWeeklyTodoHistory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelectorAll(".todo-shared-item.todo-completed")).toHaveLength(4));
    for (const panel of document.querySelectorAll(".todo-shared-item.todo-completed")) {
      expect(panel).not.toHaveAttribute("open"); fireEvent.click(panel.querySelector("summary")!); expect(within(panel as HTMLElement).getByText("初稿を完成して共有しました。")).toBeVisible();
    }
  });

  it("uses the translated task theme in the summary and retains expanded details when showing the original", async () => {
    const content = snapshot([completed()]);
    content.items[0] = { ...content.items[0], sourceLocale: "zh-CN", memoLocale: "zh-CN", title: "整理资料", goal: "完成初稿", memo: "已完成" };
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ weeks: [shared(content)] }));
    api.translateWeeklyTodoContent.mockResolvedValue({ contentVersion: content.contentVersion, targetLocale: "ja", fields: { "item-a:title": "資料の整理", "item-a:goal": "初稿の完成", "item-a:memo": "整理を完了しました。" } });
    show(); await ready(); fireEvent.click(screen.getByRole("button", { name: /担当者A/ }));
    await waitFor(() => expect(completedPanel().querySelector("summary")).toHaveTextContent("資料の整理完了"));
    fireEvent.click(completedPanel().querySelector("summary")!); expect(within(completedPanel()).getByText("整理を完了しました。")).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "原文を表示" })[0]); expect(completedPanel().querySelector("summary")).toHaveTextContent("整理资料完了"); expect(completedPanel()).toHaveAttribute("open");
  });

  it("shows the completed badge and expandable editor in Chinese", async () => {
    state.locale = "zh-CN";
    api.getWeeklyTodoWorkspace.mockResolvedValue(workspace({ ownDraft: { items: [completed()], version: 1 } }));
    show(); fireEvent.click(within(await screen.findByRole("group", { name: "切换显示" })).getByRole("button", { name: "填写我的计划" }));
    expect(editorPanel().querySelector("summary")).toHaveTextContent("已完成"); expect(editorPanel()).not.toHaveAttribute("open");
    fireEvent.click(editorPanel().querySelector("summary")!); expect(screen.getByLabelText("进度（％）")).toBeVisible(); expect(screen.getByLabelText("实绩与未完成事项")).toHaveValue("初稿を完成して共有しました。");
  });
});
