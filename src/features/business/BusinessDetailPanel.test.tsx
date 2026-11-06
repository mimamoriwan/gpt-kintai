import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../../types";
import { BusinessDetailPanel } from "./BusinessDetailPanel";
import type { BusinessInitiative, BusinessUpdate } from "./types";
import { BusinessTranslationProvider } from "./useBusinessTranslation";

const api = vi.hoisted(() => ({ getBusinessInitiativeDetail: vi.fn(), postBusinessUpdate: vi.fn(), setBusinessMilestoneCompletion: vi.fn(), setBusinessStatus: vi.fn(), translateBusinessContent: vi.fn() }));
const addToTodo = vi.hoisted(() => vi.fn());
vi.mock("../../i18n", () => ({ useI18n: () => ({ locale: "ja" }) }));
vi.mock("./api", () => ({ ...api, businessErrorMessage: () => "通信を完了できませんでした。" }));
vi.mock("../weeklyTodo/api", () => ({ addBusinessMilestonesToWeeklyTodo: addToTodo, todoError: () => "今週のTo Doを確認してください。" }));

const profile: UserProfile = { uid: "member", displayName: "担当者", email: "member@example.test", role: "employee", locale: "ja", active: true };
const initiative: BusinessInitiative = { id: "work-a", themeId: "theme-a", name: "準備を進める", description: "取り組みの説明", sourceLocale: "ja", referenceLinks: [], archived: false, version: 1, contentVersion: "v1", createdAt: 1, updatedAt: 2, updatedBy: "member", assigneeIds: ["member"], status: "in_progress", plannedStartMonth: "2026-09", plannedEndMonth: "2027-03", targetMemo: "", milestones: [] };
const update = (id: string, createdAt: number, initiativeId = initiative.id): BusinessUpdate => ({ id, initiativeId, body: id, createdAt, authorId: profile.uid, authorName: profile.displayName, sourceLocale: "ja", contentVersion: id });

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

it("selects unfinished achievements for this week without marking them complete", async () => {
  api.getBusinessInitiativeDetail.mockResolvedValue({ updates: [], history: [], nextUpdatesCursor: null, nextHistoryCursor: null, fetchedAt: 4000 });
  addToTodo.mockResolvedValue({ itemIds: ["linked-task"], addedCount: 1 });
  const onOpenWeeklyTodo = vi.fn();
  render(<BusinessTranslationProvider uid={profile.uid}><BusinessDetailPanel row={{ ...initiative, milestones: [
    { id: "done", name: "完了済み", order: 0, archived: false, completed: true, updatedAt: 0, updatedBy: "" },
    { id: "open", name: "審査条件を確定", order: 1, archived: false, completed: false, updatedAt: 0, updatedBy: "" }
  ] }} themes={[]} members={[profile]} profile={profile} canManage={false} fetchedAt={4000} refresh={vi.fn()} onEdit={vi.fn()} onArchive={vi.fn()} onCreateAnnouncement={vi.fn()} onDirty={vi.fn()} onAccessError={vi.fn()} onOpenWeeklyTodo={onOpenWeeklyTodo} /></BusinessTranslationProvider>);
  const add = screen.getByRole("button", { name: "選んだ項目を今週に追加" });
  expect(add).toBeDisabled();
  expect(screen.queryByRole("checkbox", { name: "今週取り組む: 完了済み" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "今週取り組む: 審査条件を確定" }));
  fireEvent.click(add);
  expect(await screen.findByText("今週のTo Doの下書きに1件追加しました。")).toBeVisible();
  expect(addToTodo).toHaveBeenCalledWith(expect.objectContaining({ initiativeId: initiative.id, expectedInitiativeVersion: 1, milestoneIds: ["open"] }));
  expect(api.setBusinessMilestoneCompletion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "今週のTo Doを開く" }));
  expect(onOpenWeeklyTodo).toHaveBeenCalledWith("linked-task");
});

describe("BusinessDetailPanel latest update", () => {
  it.each([
    { summary: update("一覧から取得した最新の報告", 3000), updates: [update("詳細の以前の報告", 2000)], expected: "一覧から取得した最新の報告" },
    { summary: update("一覧の以前の報告", 1000), updates: [update("詳細から取得した最新の報告", 2000)], expected: "詳細から取得した最新の報告" },
    { summary: update("別の取り組みの報告", 3000, "other-work"), updates: [update("この取り組みの最新の報告", 2000)], expected: "この取り組みの最新の報告" },
    { summary: update("同じ報告", 2000), updates: [update("同じ報告", 2000)], expected: "同じ報告" }
  ])("reconciles the workspace summary and detail: $expected", async ({ summary, updates, expected }) => {
    api.getBusinessInitiativeDetail.mockResolvedValue({ updates, history: [], nextUpdatesCursor: null, nextHistoryCursor: null, fetchedAt: 4000 });
    render(<BusinessTranslationProvider uid={profile.uid}><BusinessDetailPanel row={{ ...initiative, latestUpdate: summary }} themes={[]} members={[profile]} profile={profile} canManage={false} fetchedAt={4000} refresh={vi.fn()} onEdit={vi.fn()} onArchive={vi.fn()} onCreateAnnouncement={vi.fn()} onDirty={vi.fn()} onAccessError={vi.fn()} /></BusinessTranslationProvider>);
    await screen.findByText(/詳細の取得/);
    const latestSection = screen.getByRole("heading", { name: "最新の近況" }).parentElement!;
    await waitFor(() => expect(within(latestSection).getByText(expected)).toBeInTheDocument());
    expect(screen.getAllByText(expected)).toHaveLength(1);
    expect(screen.queryByText("別の取り組みの報告")).not.toBeInTheDocument();
  });
});
