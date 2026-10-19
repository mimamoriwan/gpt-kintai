import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../../types";
import { BusinessDetailPanel } from "./BusinessDetailPanel";
import type { BusinessInitiative, BusinessUpdate } from "./types";
import { BusinessTranslationProvider } from "./useBusinessTranslation";

const api = vi.hoisted(() => ({ getBusinessInitiativeDetail: vi.fn(), postBusinessUpdate: vi.fn(), setBusinessMilestoneCompletion: vi.fn(), setBusinessStatus: vi.fn(), translateBusinessContent: vi.fn() }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ locale: "ja" }) }));
vi.mock("./api", () => ({ ...api, businessErrorMessage: () => "通信を完了できませんでした。" }));

const profile: UserProfile = { uid: "member", displayName: "担当者", email: "member@example.test", role: "employee", locale: "ja", active: true };
const initiative: BusinessInitiative = { id: "work-a", themeId: "theme-a", name: "準備を進める", description: "取り組みの説明", sourceLocale: "ja", referenceLinks: [], archived: false, version: 1, contentVersion: "v1", createdAt: 1, updatedAt: 2, updatedBy: "member", assigneeIds: ["member"], status: "in_progress", plannedStartMonth: "2026-09", plannedEndMonth: "2027-03", targetMemo: "", milestones: [] };
const update = (id: string, createdAt: number, initiativeId = initiative.id): BusinessUpdate => ({ id, initiativeId, body: id, createdAt, authorId: profile.uid, authorName: profile.displayName, sourceLocale: "ja", contentVersion: id });

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

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
