import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../../types";
import type { BusinessDetail, BusinessWorkspace } from "./types";
import { BusinessPage } from "./BusinessPage";

const state = vi.hoisted(() => ({ locale: "ja" }));
const api = vi.hoisted(() => ({ getBusinessWorkspace: vi.fn(), getBusinessInitiativeDetail: vi.fn(), getBusinessHistory: vi.fn(), saveBusinessTheme: vi.fn(), saveBusinessInitiative: vi.fn(), saveBusinessSettings: vi.fn(), setBusinessArchived: vi.fn(), postBusinessUpdate: vi.fn(), setBusinessStatus: vi.fn(), setBusinessMilestoneCompletion: vi.fn(), translateBusinessContent: vi.fn() }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ locale: state.locale }) }));
vi.mock("./api", () => ({ ...api, businessFeatureAvailable: true, businessErrorCode: (error: { code?: string }) => error.code?.replace("functions/", ""), businessErrorMessage: (error: { code?: string }) => error.code === "functions/aborted" ? "他の方が更新しました。入力は残しています。" : error.code === "functions/permission-denied" ? "共有メンバーの権限を確認してください。" : "通信を完了できませんでした。入力は残しています。" }));
const manager: UserProfile = { uid: "yasushi", displayName: "ヤスシ", email: "manager@example.test", role: "employee_manager", locale: "ja", active: true };
const president: UserProfile = { ...manager, uid: "president", displayName: "社長", role: "president_viewer" };
const member: UserProfile = { ...manager, uid: "fang", displayName: "方", role: "employee" };
function fixture(): BusinessWorkspace {
  const common = { sourceLocale: "ja" as const, referenceLinks: [], archived: false, version: 1, contentVersion: "v1", createdAt: 1, updatedAt: 2, updatedBy: "yasushi" };
  return { settings: { enabled: true, memberIds: ["yasushi", "president", "fang"], version: 1 }, canManage: true, members: [manager, president, member], memberCandidates: [manager, president, member], themes: [{ ...common, id: "theme-a", name: "販売基盤", description: "販売の準備", order: 0 }], initiatives: [{ ...common, id: "work-a", themeId: "theme-a", name: "倉庫の比較", description: "保管条件を調べる", assigneeIds: ["fang"], status: "in_progress", plannedStartMonth: "2026-09", plannedEndMonth: "2026-11", targetMemo: "11月末", milestones: [{ id: "step-a", name: "見積を確認", order: 0, archived: false, completed: false, updatedAt: 0, updatedBy: "yasushi" }] }], fetchedAt: 1000 };
}
const emptyDetail: BusinessDetail = { updates: [], history: [], nextUpdatesCursor: null, nextHistoryCursor: null, fetchedAt: 1000 };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
async function openDetail() { fireEvent.click(await screen.findByRole("button", { name: "倉庫の比較" })); fireEvent.click(await screen.findByText("近況を記録する", { selector: "summary" })); await screen.findByLabelText("近況の本文"); }
beforeEach(() => {
  vi.resetAllMocks(); state.locale = "ja";
  api.getBusinessWorkspace.mockResolvedValue(fixture()); api.getBusinessInitiativeDetail.mockResolvedValue(emptyDetail);
  api.getBusinessHistory.mockResolvedValue({ history: [], nextCursor: null, fetchedAt: 1000 });
  api.saveBusinessInitiative.mockResolvedValue({ id: "work-a", version: 2 }); api.saveBusinessTheme.mockResolvedValue({ id: "theme-a", version: 2 }); api.saveBusinessSettings.mockResolvedValue({ version: 2 }); api.postBusinessUpdate.mockResolvedValue({ id: "update-a" }); api.setBusinessStatus.mockResolvedValue({ id: "work-a", version: 2 }); api.setBusinessMilestoneCompletion.mockResolvedValue({ id: "work-a", version: 2 });
  api.translateBusinessContent.mockRejectedValue(new Error("translation unavailable"));
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("BusinessPage", () => {
  it("opens details in a dialog and lets a manager change assignees there", async () => {
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />);
    const trigger = await screen.findByRole("button", { name: "倉庫の比較" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "取り組みの詳細" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "担当者を変更" }));
    expect(screen.getByRole("dialog", { name: "取り組みを編集" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "ヤスシ" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "方" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.saveBusinessInitiative).toHaveBeenCalledWith(expect.objectContaining({ assigneeIds: ["yasushi"] })));
    fireEvent.click(screen.getByRole("button", { name: "詳細を閉じる" }));
    expect(screen.queryByRole("dialog", { name: "取り組みの詳細" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });
  it("keeps a draft open when closing the dialog is declined", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />);
    await openDetail();
    fireEvent.change(screen.getByLabelText("近況の本文"), { target: { value: "未保存の近況" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "取り組みの詳細" })).toBeInTheDocument();
    expect(screen.getByLabelText("近況の本文")).toHaveValue("未保存の近況");
  });
  it.each([manager, president])("gives $role the same editing rights and sends only initiative input fields", async profile => {
    render(<BusinessPage profile={profile} onCreateAnnouncement={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "テーマを管理" })).toBeEnabled();
    await openDetail(); fireEvent.click(screen.getByRole("button", { name: "取り組みを編集" }));
    fireEvent.change(screen.getByLabelText("取り組み名"), { target: { value: "倉庫を決める" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.saveBusinessInitiative).toHaveBeenCalledTimes(1));
    const payload = api.saveBusinessInitiative.mock.calls[0][0];
    expect(payload).toMatchObject({ name: "倉庫を決める", expectedVersion: 1, milestones: [{ id: "step-a", name: "見積を確認", order: 0, archived: false }] });
    expect(Object.keys(payload).sort()).toEqual(["id", "expectedVersion", "themeId", "name", "description", "sourceLocale", "referenceLinks", "assigneeIds", "status", "plannedStartMonth", "plannedEndMonth", "targetMemo", "milestones"].sort());
  });
  it("lets a manager rename a milestone and add only three active milestones", async () => {
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />);
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "取り組みを編集" }));
    const editor = screen.getByRole("dialog", { name: "取り組みを編集" });
    fireEvent.change(within(editor).getByLabelText("節目 1"), { target: { value: "見積を比較" } });
    const add = within(editor).getByRole("button", { name: "節目を追加" });
    fireEvent.click(add);
    fireEvent.change(within(editor).getByLabelText("節目 2"), { target: { value: "候補を絞る" } });
    fireEvent.click(add);
    fireEvent.change(within(editor).getByLabelText("節目 3"), { target: { value: "倉庫を決める" } });
    expect(add).toBeDisabled();
    fireEvent.click(within(editor).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(api.saveBusinessInitiative).toHaveBeenCalledTimes(1));
    const milestones = api.saveBusinessInitiative.mock.calls[0][0].milestones;
    expect(milestones).toEqual([
      { id: "step-a", name: "見積を比較", order: 0, archived: false },
      { id: expect.any(String), name: "候補を絞る", order: 1, archived: false },
      { id: expect.any(String), name: "倉庫を決める", order: 2, archived: false }
    ]);
    expect(new Set(milestones.map((milestone: { id: string }) => milestone.id)).size).toBe(3);
  });
  it("archives a milestone to free a slot and restores it only within the three-step limit", async () => {
    const workspace = fixture();
    const first = workspace.initiatives[0].milestones[0];
    workspace.initiatives[0].milestones.push(
      { ...first, id: "step-b", name: "候補を絞る", order: 1 },
      { ...first, id: "step-c", name: "倉庫を決める", order: 2 }
    );
    api.getBusinessWorkspace.mockResolvedValue(workspace);
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />);
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "取り組みを編集" }));
    const editor = screen.getByRole("dialog", { name: "取り組みを編集" });
    const milestoneRow = (name: string) => within(editor).getByDisplayValue(name).closest(".business-milestone-editor") as HTMLElement;
    const add = within(editor).getByRole("button", { name: "節目を追加" });
    expect(add).toBeDisabled();
    fireEvent.click(within(milestoneRow("見積を確認")).getByRole("button", { name: "節目を外す" }));
    const archived = within(editor).getByText(/保管中の節目/, { selector: "summary" }).closest("details") as HTMLElement;
    fireEvent.click(archived.querySelector("summary")!);
    const archivedRow = (name: string) => within(archived).getByText(name).closest(".business-milestone-editor") as HTMLElement;
    expect(within(editor).queryByDisplayValue("見積を確認")).not.toBeInTheDocument();
    expect(within(archivedRow("見積を確認")).getByRole("button", { name: "節目を復元" })).toBeEnabled();
    expect(add).toBeEnabled();
    fireEvent.click(add);
    fireEvent.change(within(editor).getByLabelText("節目 3"), { target: { value: "契約を確認" } });
    expect(within(archivedRow("見積を確認")).getByRole("button", { name: "節目を復元" })).toBeDisabled();
    fireEvent.click(within(milestoneRow("候補を絞る")).getByRole("button", { name: "節目を外す" }));
    fireEvent.click(within(archivedRow("見積を確認")).getByRole("button", { name: "節目を復元" }));
    fireEvent.click(within(editor).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(api.saveBusinessInitiative).toHaveBeenCalledTimes(1));
    const milestones = api.saveBusinessInitiative.mock.calls[0][0].milestones;
    expect(milestones.filter((milestone: { archived: boolean }) => !milestone.archived)).toHaveLength(3);
    expect(milestones).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "step-a", archived: false }),
      expect.objectContaining({ id: "step-b", archived: true }),
      expect.objectContaining({ id: "step-c", archived: false }),
      expect.objectContaining({ name: "契約を確認", archived: false })
    ]));
  });
  it("requires at least one active milestone before saving an initiative", async () => {
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />);
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "取り組みを編集" }));
    const editor = screen.getByRole("dialog", { name: "取り組みを編集" });
    fireEvent.click(within(editor).getByRole("button", { name: "節目を外す" }));
    fireEvent.click(within(editor).getByRole("button", { name: "保存" }));
    expect(within(editor).getByRole("alert")).toHaveTextContent("節目");
    expect(api.saveBusinessInitiative).not.toHaveBeenCalled();
    fireEvent.click(within(editor).getByText(/保管中の節目/, { selector: "summary" }));
    fireEvent.click(within(editor).getByRole("button", { name: "節目を復元" }));
    fireEvent.click(within(editor).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.saveBusinessInitiative).toHaveBeenCalledTimes(1));
  });
  it("updates the chart strip after a milestone checkbox is saved", async () => {
    const before = fixture();
    const after = fixture();
    after.initiatives[0].milestones[0].completed = true;
    after.initiatives[0].version = 2;
    after.fetchedAt = 2000;
    api.getBusinessWorkspace.mockResolvedValueOnce(before).mockResolvedValue(after);
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />);
    const timelineRow = (await screen.findByRole("button", { name: "倉庫の比較" })).closest("tr")!;
    const bar = () => timelineRow.querySelector<HTMLElement>(".business-overview-bar")!;
    const fill = () => bar().querySelector<HTMLElement>(".business-overview-milestone-fill")!;
    expect(fill().style.width).toBe("0%");

    await openDetail();
    fireEvent.click(screen.getByRole("checkbox", { name: "見積を確認" }));
    await waitFor(() => expect(api.setBusinessMilestoneCompletion).toHaveBeenCalledWith({
      initiativeId: "work-a", milestoneId: "step-a", expectedVersion: 1, completed: true
    }));
    await waitFor(() => expect(fill().style.width).toBe("100%"));
    expect(bar()).toHaveClass("business-overview-bar-in_progress");
  });
  it("lets an assigned member change only status and milestones and report updates", async () => {
    const ws = fixture(); ws.canManage = false; api.getBusinessWorkspace.mockResolvedValue(ws);
    render(<BusinessPage profile={member} onCreateAnnouncement={vi.fn()} />); await openDetail();
    expect(screen.queryByRole("button", { name: "テーマを管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取り組みを編集" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "見積を確認" }));
    await waitFor(() => expect(api.setBusinessMilestoneCompletion).toHaveBeenCalledWith({ initiativeId: "work-a", milestoneId: "step-a", expectedVersion: 1, completed: true }));
    await waitFor(() => expect(screen.getByLabelText("取り組みの状態")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("取り組みの状態"), { target: { value: "on_hold" } });
    await waitFor(() => expect(api.setBusinessStatus).toHaveBeenCalledWith({ initiativeId: "work-a", expectedVersion: 1, status: "on_hold" }));
  });
  it("prevents a member updating an unassigned task while retaining reporting", async () => {
    const ws = fixture(); ws.canManage = false; ws.initiatives[0].assigneeIds = []; ws.initiatives[0].plannedStartMonth = ""; ws.initiatives[0].plannedEndMonth = ""; ws.initiatives[0].milestones = []; api.getBusinessWorkspace.mockResolvedValue(ws);
    render(<BusinessPage profile={member} onCreateAnnouncement={vi.fn()} />); await openDetail();
    expect(screen.getByLabelText("取り組みの状態")).toBeDisabled(); expect(screen.getAllByText("担当未定").length).toBeGreaterThan(0); expect(screen.getAllByText("節目未設定").length).toBeGreaterThan(0); expect(screen.getAllByText("期間未設定").length).toBeGreaterThan(0); expect(screen.getByLabelText("近況の本文")).toBeEnabled();
  });
  it("retains input across external refresh and only rebases a conflict after explicit review", async () => {
    const next = fixture(); next.initiatives[0] = { ...next.initiatives[0], version: 2, description: "社長が更新した説明" }; next.fetchedAt = 2000;
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />); await openDetail(); fireEvent.click(screen.getByRole("button", { name: "取り組みを編集" }));
    fireEvent.change(screen.getByLabelText("説明"), { target: { value: "保存したい入力" } });
    api.getBusinessWorkspace.mockResolvedValue(next); fireEvent.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() => expect(api.getBusinessWorkspace).toHaveBeenCalledTimes(2)); expect(screen.getByLabelText("説明")).toHaveValue("保存したい入力");
    api.saveBusinessInitiative.mockRejectedValueOnce({ code: "functions/aborted" }); fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("最新の内容と入力を確認")).toBeInTheDocument(); expect(screen.getByText("社長が更新した説明")).toBeInTheDocument(); expect(api.saveBusinessInitiative).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "最新の版を基準に、この入力を保存" }));
    await waitFor(() => expect(api.saveBusinessInitiative).toHaveBeenCalledTimes(2)); expect(api.saveBusinessInitiative.mock.calls[1][0]).toMatchObject({ expectedVersion: 2, description: "保存したい入力" });
  });
  it("freezes an in-flight save and reports successful persistence separately from refresh failure", async () => {
    const pending = deferred<{ id: string; version: number }>(); api.saveBusinessInitiative.mockReturnValue(pending.promise);
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />); await openDetail(); fireEvent.click(screen.getByRole("button", { name: "取り組みを編集" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" })); expect(screen.getByLabelText("取り組み名")).toBeDisabled();
    api.getBusinessWorkspace.mockRejectedValue(new Error("offline")); await act(async () => pending.resolve({ id: "work-a", version: 2 }));
    expect(await screen.findByText("原文を保存しました。翻訳は表示時に取得します。")).toBeInTheDocument(); expect(await screen.findByText("表示は前回取得時の内容です。")).toBeInTheDocument();
  });
  it("distinguishes initial fetch errors from an empty successful workspace", async () => {
    api.getBusinessWorkspace.mockRejectedValue(new Error("offline")); render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("通信"); expect(screen.queryByText("該当する取り組みはありません。")).not.toBeInTheDocument();
    const ws = fixture(); ws.initiatives = []; api.getBusinessWorkspace.mockResolvedValue(ws); fireEvent.click(screen.getByRole("button", { name: "最新情報に更新" })); expect(await screen.findByText("該当する取り組みはありません。")).toBeInTheDocument();
  });
  it("does not redisplay a late response after an account switch", async () => {
    const old = deferred<BusinessWorkspace>(); api.getBusinessWorkspace.mockReturnValueOnce(old.promise);
    const view = render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />);
    const second = fixture(); second.canManage = false; second.initiatives[0].name = "別アカウントの対象"; api.getBusinessWorkspace.mockResolvedValue(second);
    view.rerender(<BusinessPage profile={member} onCreateAnnouncement={vi.fn()} />); await screen.findByRole("button", { name: "別アカウントの対象" });
    await act(async () => old.resolve(fixture())); expect(screen.queryByRole("button", { name: "倉庫の比較" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "共有メンバー設定" })).not.toBeInTheDocument();
  });
  it("clears shared content and drafts after permission is revoked", async () => {
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />); await openDetail(); fireEvent.change(screen.getByLabelText("近況の本文"), { target: { value: "未保存の本文" } });
    api.getBusinessWorkspace.mockRejectedValue({ code: "functions/permission-denied" }); fireEvent.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() => expect(screen.queryByLabelText("近況の本文")).not.toBeInTheDocument()); expect(screen.queryByText("保管条件を調べる")).not.toBeInTheDocument();
  });
  it("preserves unsaved reporting when opening an announcement and does not preselect recipients", async () => {
    const create = vi.fn(); render(<BusinessPage profile={president} onCreateAnnouncement={create} />); await openDetail(); fireEvent.change(screen.getByLabelText("近況の本文"), { target: { value: "まだ入力中" } }); fireEvent.click(screen.getByRole("button", { name: "この件のお知らせを作成" }));
    expect(create).toHaveBeenCalledWith({ key: expect.any(String), title: "会社の取り組み: 倉庫の比較", body: expect.stringContaining("/#business/work-a") }); expect(screen.getByLabelText("近況の本文")).toHaveValue("まだ入力中"); expect(screen.getByText("未保存の入力があります")).toBeInTheDocument(); expect(window.confirm).not.toHaveBeenCalled();
  });
  it("requires confirmation before changing selection but not before switching language", async () => {
    const ws = fixture(); ws.initiatives.push({ ...ws.initiatives[0], id: "work-b", name: "次の取り組み" }); api.getBusinessWorkspace.mockResolvedValue(ws); render(<><button className="language-toggle">中</button><BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} /></>); await openDetail(); fireEvent.change(screen.getByLabelText("近況の本文"), { target: { value: "書きかけ" } });
    vi.mocked(window.confirm).mockReturnValue(false); fireEvent.click(screen.getByRole("button", { name: "中" })); expect(window.confirm).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "次の取り組み" })); expect(window.confirm).toHaveBeenCalledTimes(1); expect(screen.getByLabelText("近況の本文")).toHaveValue("書きかけ");
  });
  it("preserves an editor when shared administrators suspend the feature", async () => {
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />); await openDetail(); fireEvent.click(screen.getByRole("button", { name: "取り組みを編集" })); fireEvent.change(screen.getByLabelText("取り組み名"), { target: { value: "途中の名称" } }); const ws = fixture(); ws.settings.enabled = false; ws.themes = []; ws.initiatives = []; api.getBusinessWorkspace.mockResolvedValue(ws); fireEvent.click(screen.getByRole("button", { name: "最新情報に更新" }));
    expect(await screen.findByText("この機能は停止中です")).toBeInTheDocument(); expect(screen.getByLabelText("取り組み名")).toHaveValue("途中の名称"); expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });
  it("requires an explicit three-person setup and leaves activation unchecked initially", async () => {
    const ws = fixture(); ws.settings = { enabled: false, memberIds: [], version: 0 }; ws.members = []; ws.themes = []; ws.initiatives = []; api.getBusinessWorkspace.mockResolvedValue(ws); render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "共有メンバー設定" })); const form = screen.getByRole("form", { name: "共有メンバーの設定" });
    const activate = within(form).getByRole("checkbox", { name: "この3人で「会社の取り組み」を利用する" }); expect(activate).not.toBeChecked();
    fireEvent.click(within(form).getByRole("checkbox", { name: /ヤスシ/ })); fireEvent.click(within(form).getByRole("button", { name: "保存" })); expect(api.saveBusinessSettings).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole("checkbox", { name: /社長/ })); fireEvent.click(within(form).getByRole("checkbox", { name: /方/ })); fireEvent.click(activate); fireEvent.click(within(form).getByRole("button", { name: "保存" })); await waitFor(() => expect(api.saveBusinessSettings).toHaveBeenCalledWith({ expectedVersion: 0, enabled: true, memberIds: ["yasushi", "president", "fang"] }));
  });
  it("retains original reports and a stable retry ID when posting fails", async () => {
    api.postBusinessUpdate.mockRejectedValueOnce(new Error("offline")); render(<BusinessPage profile={member} onCreateAnnouncement={vi.fn()} />); await openDetail(); fireEvent.change(screen.getByLabelText("近況の本文"), { target: { value: "回答を待っています" } }); fireEvent.click(screen.getByRole("button", { name: "近況を投稿" }));
    await waitFor(() => expect(api.postBusinessUpdate).toHaveBeenCalledTimes(1)); await waitFor(() => expect(screen.getByRole("button", { name: "近況を投稿" })).toBeEnabled()); expect(screen.getByLabelText("近況の本文")).toHaveValue("回答を待っています");
    fireEvent.click(screen.getByRole("button", { name: "近況を投稿" })); await waitFor(() => expect(api.postBusinessUpdate).toHaveBeenCalledTimes(2)); expect(api.postBusinessUpdate.mock.calls[1][0]).toEqual(api.postBusinessUpdate.mock.calls[0][0]); await waitFor(() => expect(screen.getByLabelText("近況の本文")).toHaveValue(""));
  });
  it("loads older histories without replacing already displayed rows", async () => {
    api.getBusinessInitiativeDetail.mockResolvedValueOnce({ ...emptyDetail, history: [{ id: "h1", actorName: "ヤスシ", createdAt: 200, before: { description: "旧説明" }, after: { description: "新説明" } }], nextHistoryCursor: "older" }).mockResolvedValueOnce({ ...emptyDetail, history: [{ id: "h0", actorName: "社長", createdAt: 100, before: {}, after: { name: "最初の登録" } }] });
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />); await openDetail(); fireEvent.click(screen.getByText("変更履歴", { selector: "summary" })); fireEvent.click(await screen.findByRole("button", { name: "以前の変更履歴を表示" })); await waitFor(() => expect(api.getBusinessInitiativeDetail).toHaveBeenLastCalledWith({ initiativeId: "work-a", historyCursor: "older" })); expect(await screen.findByText("最初の登録")).toBeInTheDocument(); expect(screen.getByText("新説明")).toBeInTheDocument();
  });
  it("keeps archived milestone order unchanged when reordering active milestones", async () => {
    const ws = fixture(); ws.initiatives[0].milestones.push({ ...ws.initiatives[0].milestones[0], id: "archived-step", name: "保管した節目", order: 1, archived: true }, { ...ws.initiatives[0].milestones[0], id: "next-step", name: "倉庫を決定", order: 2 }); api.getBusinessWorkspace.mockResolvedValue(ws);
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />); await openDetail(); fireEvent.click(screen.getByRole("button", { name: "取り組みを編集" }));
    fireEvent.click(screen.getByText(/保管中の節目/, { selector: "summary" })); expect(screen.getByText("保管した節目")).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "見積を確認を下へ" })); fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.saveBusinessInitiative).toHaveBeenCalledTimes(1)); expect(api.saveBusinessInitiative.mock.calls[0][0].milestones).toEqual([{ id: "next-step", name: "倉庫を決定", order: 0, archived: false }, { id: "archived-step", name: "保管した節目", order: 1, archived: true }, { id: "step-a", name: "見積を確認", order: 2, archived: false }]);
  });
  it("preserves milestones added by another administrator during conflict reconciliation", async () => {
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />); await openDetail(); fireEvent.click(screen.getByRole("button", { name: "取り組みを編集" })); fireEvent.change(screen.getByLabelText("説明"), { target: { value: "自分の説明" } });
    const next = fixture(); next.initiatives[0].version = 2; next.initiatives[0].milestones.push({ ...next.initiatives[0].milestones[0], id: "other-step", name: "社長の追加節目", order: 1 }); api.getBusinessWorkspace.mockResolvedValue(next); api.saveBusinessInitiative.mockRejectedValueOnce({ code: "functions/aborted" }); fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(/他の方が追加した節目も保持します/); fireEvent.click(screen.getByRole("button", { name: "最新の版を基準に、この入力を保存" }));
    await waitFor(() => expect(api.saveBusinessInitiative).toHaveBeenCalledTimes(2)); expect(api.saveBusinessInitiative.mock.calls[1][0]).toMatchObject({ expectedVersion: 2, description: "自分の説明", milestones: [{ id: "step-a" }, { id: "other-step", name: "社長の追加節目" }] });
  });
  it("lets a manager reconcile four active milestones after a concurrent addition without losing IDs", async () => {
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />);
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "取り組みを編集" }));
    const editor = screen.getByRole("dialog", { name: "取り組みを編集" });
    const add = within(editor).getByRole("button", { name: "節目を追加" });
    fireEvent.click(add);
    fireEvent.change(within(editor).getByLabelText("節目 2"), { target: { value: "自分の節目A" } });
    fireEvent.click(add);
    fireEvent.change(within(editor).getByLabelText("節目 3"), { target: { value: "自分の節目B" } });

    const latest = fixture();
    latest.initiatives[0].version = 2;
    latest.initiatives[0].milestones.push({
      ...latest.initiatives[0].milestones[0], id: "other-step", name: "社長の追加節目", order: 1
    });
    api.getBusinessWorkspace.mockResolvedValue(latest);
    api.saveBusinessInitiative.mockRejectedValueOnce({ code: "functions/aborted" });
    fireEvent.click(within(editor).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.saveBusinessInitiative).toHaveBeenCalledTimes(1));
    const localIds = api.saveBusinessInitiative.mock.calls[0][0].milestones.map((step: { id: string }) => step.id);

    fireEvent.click(await within(editor).findByRole("button", { name: "追加分を取り込む" }));
    expect(within(editor).getByRole("group", { name: /現在4件/ })).toBeInTheDocument();
    const remoteRow = within(editor).getByDisplayValue("社長の追加節目").closest(".business-milestone-editor") as HTMLElement;
    fireEvent.click(within(remoteRow).getByRole("button", { name: "節目を外す" }));
    expect(within(editor).getByRole("group", { name: /現在3件/ })).toBeInTheDocument();
    fireEvent.click(within(editor).getByRole("button", { name: "最新の版を基準に、この入力を保存" }));

    await waitFor(() => expect(api.saveBusinessInitiative).toHaveBeenCalledTimes(2));
    const saved = api.saveBusinessInitiative.mock.calls[1][0];
    expect(saved.expectedVersion).toBe(2);
    expect(saved.milestones).toHaveLength(4);
    expect(new Set(saved.milestones.map((step: { id: string }) => step.id))).toEqual(new Set([...localIds, "other-step"]));
    expect(saved.milestones.filter((step: { archived: boolean }) => !step.archived)).toHaveLength(3);
    expect(saved.milestones.map((step: { order: number }) => step.order).sort((a: number, b: number) => a - b)).toEqual([0, 1, 2, 3]);
    expect(saved.milestones).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "other-step", name: "社長の追加節目", archived: true })
    ]));
  });
  it("reorders concurrent additions that used the same milestone order", async () => {
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />);
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "取り組みを編集" }));
    const editor = screen.getByRole("dialog", { name: "取り組みを編集" });
    fireEvent.click(within(editor).getByRole("button", { name: "節目を追加" }));
    fireEvent.change(within(editor).getByLabelText("節目 2"), { target: { value: "自分の節目" } });

    const latest = fixture();
    latest.initiatives[0].version = 2;
    latest.initiatives[0].milestones.push({
      ...latest.initiatives[0].milestones[0], id: "other-step", name: "社長の節目", order: 1
    });
    api.getBusinessWorkspace.mockResolvedValue(latest);
    api.saveBusinessInitiative.mockRejectedValueOnce({ code: "functions/aborted" });
    fireEvent.click(within(editor).getByRole("button", { name: "保存" }));
    fireEvent.click(await within(editor).findByRole("button", { name: "追加分を取り込む" }));
    expect(within(editor).getByLabelText("節目 3")).toHaveValue("社長の節目");

    fireEvent.click(within(editor).getByRole("button", { name: "社長の節目を上へ" }));
    expect(within(editor).getByLabelText("節目 2")).toHaveValue("社長の節目");
    expect(within(editor).getByLabelText("節目 3")).toHaveValue("自分の節目");
    fireEvent.click(within(editor).getByRole("button", { name: "最新の版を基準に、この入力を保存" }));

    await waitFor(() => expect(api.saveBusinessInitiative).toHaveBeenCalledTimes(2));
    const saved = api.saveBusinessInitiative.mock.calls[1][0];
    expect(saved.expectedVersion).toBe(2);
    expect(saved.milestones.map((step: { order: number }) => step.order)).toEqual([0, 1, 2]);
    expect(saved.milestones.map((step: { name: string }) => step.name)).toEqual(["見積を確認", "社長の節目", "自分の節目"]);
  });
  it("recovers a persisted report after response loss without losing a subsequently edited draft", async () => {
    api.postBusinessUpdate.mockRejectedValueOnce(new Error("response lost")); render(<BusinessPage profile={member} onCreateAnnouncement={vi.fn()} />); await openDetail(); fireEvent.change(screen.getByLabelText("近況の本文"), { target: { value: "最初の近況" } }); fireEvent.click(screen.getByRole("button", { name: "近況を投稿" }));
    await waitFor(() => expect(api.postBusinessUpdate).toHaveBeenCalledTimes(1)); await waitFor(() => expect(screen.getByRole("button", { name: "近況を投稿" })).toBeEnabled());
    const priorId = api.postBusinessUpdate.mock.calls[0][0].id; fireEvent.change(screen.getByLabelText("近況の本文"), { target: { value: "追記した近況" } });
    api.getBusinessInitiativeDetail.mockResolvedValue({ ...emptyDetail, updates: [{ id: priorId, initiativeId: "work-a", authorId: "fang", authorName: "方", body: "最初の近況", sourceLocale: "ja", contentVersion: "u1", createdAt: 2000 }] }); const next = fixture(); next.fetchedAt = 2000; api.getBusinessWorkspace.mockResolvedValue(next); fireEvent.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await screen.findByText("前回の投稿は保存済みです。変更した入力は残しています。新しい近況として投稿できます。"); expect(screen.getByLabelText("近況の本文")).toHaveValue("追記した近況"); fireEvent.click(screen.getByRole("button", { name: "近況を投稿" }));
    await waitFor(() => expect(api.postBusinessUpdate).toHaveBeenCalledTimes(2)); expect(api.postBusinessUpdate.mock.calls[1][0].id).not.toBe(priorId); expect(api.postBusinessUpdate.mock.calls[1][0].body).toBe("追記した近況");
  });
  it("allows archived theme history to be read without restoring or editing it", async () => {
    const ws = fixture(); ws.themes[0].archived = true; api.getBusinessWorkspace.mockResolvedValue(ws);
    render(<BusinessPage profile={president} onCreateAnnouncement={vi.fn()} />); fireEvent.click(await screen.findByRole("button", { name: "テーマを管理" })); expect(screen.getByRole("button", { name: "テーマを編集" })).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "この設定の変更履歴" }));
    await waitFor(() => expect(api.getBusinessHistory).toHaveBeenCalledWith({ kind: "theme", id: "theme-a" })); expect(api.setBusinessArchived).not.toHaveBeenCalled();
  });
  it("applies an updated deep link while mounted and preserves an unaccepted dirty selection", async () => {
    const ws = fixture(); ws.initiatives.push({ ...ws.initiatives[0], id: "work-b", name: "次の取り組み" }); api.getBusinessWorkspace.mockResolvedValue(ws);
    const view = render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} initialInitiativeId="work-a" />); await screen.findByLabelText("近況の本文"); view.rerender(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} initialInitiativeId="work-b" />);
    await waitFor(() => expect(api.getBusinessInitiativeDetail).toHaveBeenLastCalledWith({ initiativeId: "work-b" })); fireEvent.change(screen.getByLabelText("近況の本文"), { target: { value: "次の取り組みの書きかけ" } }); vi.mocked(window.confirm).mockReturnValue(false); view.rerender(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} initialInitiativeId="work-a" />); expect(screen.getByLabelText("近況の本文")).toHaveValue("次の取り組みの書きかけ"); expect(window.confirm).toHaveBeenCalledTimes(1);
  });
  it("saves a theme through the strict input contract and retains original source language", async () => {
    render(<BusinessPage profile={president} onCreateAnnouncement={vi.fn()} />); fireEvent.click(await screen.findByRole("button", { name: "テーマを管理" })); fireEvent.click(screen.getByRole("button", { name: "テーマを編集" })); fireEvent.change(screen.getByLabelText("目的・説明"), { target: { value: "会社の販売を準備" } }); fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.saveBusinessTheme).toHaveBeenCalledWith({ id: "theme-a", expectedVersion: 1, name: "販売基盤", description: "会社の販売を準備", sourceLocale: "ja", order: 0, referenceLinks: [] }));
  });

  it("keeps the ordinary success message when a poll finds the first post before its acknowledgement", async () => {
    const pending = deferred<{ id: string }>(); api.postBusinessUpdate.mockReturnValue(pending.promise);
    render(<BusinessPage profile={member} onCreateAnnouncement={vi.fn()} />); await openDetail();
    fireEvent.change(screen.getByLabelText("近況の本文"), { target: { value: "初回の報告" } }); fireEvent.click(screen.getByRole("button", { name: "近況を投稿" }));
    await waitFor(() => expect(api.postBusinessUpdate).toHaveBeenCalledTimes(1)); const id = api.postBusinessUpdate.mock.calls[0][0].id;
    api.getBusinessInitiativeDetail.mockResolvedValue({ ...emptyDetail, updates: [{ id, initiativeId: "work-a", authorId: "fang", authorName: "方", body: "初回の報告", sourceLocale: "ja", contentVersion: "u1", createdAt: 2000 }] });
    const next = fixture(); next.fetchedAt = 2000; api.getBusinessWorkspace.mockResolvedValue(next); fireEvent.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() => expect(api.getBusinessInitiativeDetail).toHaveBeenCalledTimes(2)); await screen.findByText("初回の報告", { selector: "span" });
    expect(screen.getByLabelText("近況の本文")).toHaveValue("初回の報告"); expect(screen.queryByText("近況は保存済みです。再投稿は不要です。")).not.toBeInTheDocument();
    await act(async () => pending.resolve({ id }));
    await waitFor(() => expect(screen.getByLabelText("近況の本文")).toHaveValue(""));
    expect(screen.getByText("近況を保存しました。翻訳の成否にかかわらず原文を共有しています。")).toBeInTheDocument();
    expect(screen.queryByText("近況は保存済みです。再投稿は不要です。")).not.toBeInTheDocument(); expect(api.postBusinessUpdate).toHaveBeenCalledTimes(1);
  });

  it("confirms archive and restore in the page, supports cancellation, and cannot close while saving", async () => {
    const pending = deferred<{ id: string; version: number }>(); api.setBusinessArchived.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ id: "work-a", version: 3 });
    render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />); await openDetail(); fireEvent.click(screen.getByRole("button", { name: "取り組みをアーカイブ" }));
    let dialog = screen.getByRole("dialog", { name: "アーカイブの確認" }); expect(within(dialog).getByText("倉庫の比較")).toBeInTheDocument(); expect(within(dialog).getByRole("button", { name: "キャンセル" })).toHaveFocus(); expect(api.setBusinessArchived).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "キャンセル" })); expect(screen.queryByRole("dialog", { name: "アーカイブの確認" })).not.toBeInTheDocument(); expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取り組みをアーカイブ" })); dialog = screen.getByRole("dialog", { name: "アーカイブの確認" }); fireEvent.click(within(dialog).getByRole("button", { name: "アーカイブする" }));
    expect(within(dialog).getByRole("button", { name: "キャンセル" })).toBeDisabled(); expect(within(dialog).getByRole("button", { name: "アーカイブする" })).toBeDisabled(); fireEvent.keyDown(document, { key: "Escape" }); fireEvent.mouseDown(dialog.parentElement!); expect(screen.getByRole("dialog", { name: "アーカイブの確認" })).toBeInTheDocument(); expect(api.setBusinessArchived).toHaveBeenCalledTimes(1);
    const archived = fixture(); archived.initiatives[0].archived = true; archived.initiatives[0].version = 2; api.getBusinessWorkspace.mockResolvedValue(archived); await act(async () => pending.resolve({ id: "work-a", version: 2 }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "アーカイブの確認" })).not.toBeInTheDocument()); expect(api.setBusinessArchived).toHaveBeenNthCalledWith(1, { kind: "initiative", id: "work-a", expectedVersion: 1, archived: true });
    fireEvent.click(screen.getByRole("button", { name: "取り組みを復元" })); dialog = screen.getByRole("dialog", { name: "復元の確認" }); fireEvent.click(within(dialog).getByRole("button", { name: "復元する" })); await waitFor(() => expect(api.setBusinessArchived).toHaveBeenNthCalledWith(2, { kind: "initiative", id: "work-a", expectedVersion: 2, archived: false })); expect(window.confirm).not.toHaveBeenCalled();
  });
  it("keeps a dirty report when archive is cancelled or confirmed without native confirmation", async () => {
    render(<BusinessPage profile={president} onCreateAnnouncement={vi.fn()} />); await openDetail(); fireEvent.change(screen.getByLabelText("近況の本文"), { target: { value: "未投稿の報告" } });
    fireEvent.click(screen.getByRole("button", { name: "取り組みをアーカイブ" })); expect(screen.getByText("入力中の近況は投稿されません。未保存の入力はこの画面に保持します。先に投稿する場合はキャンセルしてください。")).toBeInTheDocument(); fireEvent.keyDown(document, { key: "Escape" }); expect(screen.getByLabelText("近況の本文")).toHaveValue("未投稿の報告");
    fireEvent.click(screen.getByRole("button", { name: "取り組みをアーカイブ" })); const archived = fixture(); archived.initiatives[0].archived = true; archived.initiatives[0].version = 2; archived.fetchedAt = 2000; api.getBusinessWorkspace.mockResolvedValue(archived); api.setBusinessArchived.mockResolvedValue({ id: "work-a", version: 2 }); fireEvent.click(screen.getByRole("button", { name: "アーカイブする" }));
    expect(await screen.findByLabelText("未保存の近況")).toHaveValue("未投稿の報告"); expect(screen.getByText("未保存の入力があります")).toBeInTheDocument(); expect(window.confirm).not.toHaveBeenCalled(); expect(api.postBusinessUpdate).not.toHaveBeenCalled();
  });
  it("localizes theme restoration confirmation in Chinese", async () => {
    state.locale = "zh-CN"; const ws = fixture(); ws.themes[0].archived = true; api.getBusinessWorkspace.mockResolvedValue(ws); render(<BusinessPage profile={president} onCreateAnnouncement={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "管理主题" })); fireEvent.click(screen.getByRole("button", { name: "恢复主题" })); const dialog = screen.getByRole("dialog", { name: "确认恢复" }); expect(within(dialog).getByText("販売基盤")).toBeInTheDocument(); fireEvent.click(within(dialog).getByRole("button", { name: "取消" })); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(api.setBusinessArchived).not.toHaveBeenCalled(); expect(window.confirm).not.toHaveBeenCalled();
  });
  it("removes an archive confirmation and ignores its late reply after account switching", async () => {
    const pending = deferred<{ id: string; version: number }>(); api.setBusinessArchived.mockReturnValue(pending.promise); const view = render(<BusinessPage profile={manager} onCreateAnnouncement={vi.fn()} />); await openDetail(); fireEvent.click(screen.getByRole("button", { name: "取り組みをアーカイブ" })); fireEvent.click(screen.getByRole("button", { name: "アーカイブする" }));
    const next = fixture(); next.canManage = false; api.getBusinessWorkspace.mockResolvedValue(next); view.rerender(<BusinessPage profile={member} onCreateAnnouncement={vi.fn()} />); await screen.findByRole("button", { name: "倉庫の比較" }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => pending.resolve({ id: "work-a", version: 2 })); expect(screen.queryByText("保存しました。")).not.toBeInTheDocument(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

});
