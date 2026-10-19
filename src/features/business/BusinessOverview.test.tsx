import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../../types";
import type { BusinessWorkspace } from "./types";
import { BusinessPage } from "./BusinessPage";

const api = vi.hoisted(() => ({ getBusinessWorkspace: vi.fn(), getBusinessInitiativeDetail: vi.fn(), getBusinessHistory: vi.fn(), translateBusinessContent: vi.fn(), setBusinessArchived: vi.fn() }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ locale: "ja" }) }));
vi.mock("./api", () => ({ ...api, businessFeatureAvailable: true, businessErrorCode: () => "unknown", businessErrorMessage: () => "通信を完了できませんでした。" }));
const profile: UserProfile = { uid: "member", displayName: "担当者", email: "member@example.test", role: "employee", locale: "ja", active: true };
function fixture(): BusinessWorkspace {
  const common = { sourceLocale: "ja" as const, referenceLinks: [], archived: false, version: 1, contentVersion: "v1", createdAt: 1, updatedAt: 2, updatedBy: profile.uid };
  const row = { ...common, id: "work-a", themeId: "theme-a", name: "最初の取り組み", description: "説明", assigneeIds: [profile.uid], status: "in_progress" as const, plannedStartMonth: "2026-09", plannedEndMonth: "2027-03", targetMemo: "", milestones: [] };
  return { settings: { enabled: true, memberIds: [profile.uid], version: 1 }, canManage: false, members: [profile], memberCandidates: [], themes: [{ ...common, id: "theme-a", name: "重点テーマ", description: "テーマの説明", order: 0 }], initiatives: [{ ...row, id: "work-b", name: "次の取り組み", createdAt: 2 }, row], fetchedAt: 1000 };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getBusinessWorkspace.mockResolvedValue(fixture());
  api.getBusinessInitiativeDetail.mockResolvedValue({ updates: [], history: [], nextUpdatesCursor: null, nextHistoryCursor: null, fetchedAt: 1000 });
  api.getBusinessHistory.mockResolvedValue({ history: [], nextCursor: null, fetchedAt: 1000 });
  api.translateBusinessContent.mockRejectedValue(new Error("unused"));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("company initiative overview", () => {
  it("shows milestone completion on the schedule bar while retaining its status color", async () => {
    const workspace = fixture();
    const row = workspace.initiatives.find(item => item.id === "work-a")!;
    row.milestones = ["one", "two", "three"].map((id, order) => ({
      id, name: `節目${order + 1}`, order, archived: false, completed: false, updatedAt: 0, updatedBy: profile.uid
    }));
    api.getBusinessWorkspace.mockResolvedValue(workspace);
    render(<BusinessPage profile={profile} onCreateAnnouncement={vi.fn()} />);

    const bar = () => {
      const timelineRow = screen.getByRole("button", { name: "最初の取り組み" }).closest("tr");
      expect(timelineRow).not.toBeNull();
      const statusBar = timelineRow!.querySelector<HTMLElement>(".business-overview-bar");
      expect(statusBar).not.toBeNull();
      expect(statusBar).toHaveClass("business-overview-bar-in_progress");
      return statusBar!;
    };
    const fill = () => {
      const segment = bar().querySelector<HTMLElement>(".business-overview-milestone-fill");
      expect(segment).not.toBeNull();
      return segment!;
    };

    await screen.findByRole("button", { name: "最初の取り組み" });
    expect(fill().style.width).toBe("0%");
    expect(within(screen.getByRole("row", { name: /最初の取り組み/ })).getByLabelText("3件中0件の節目が完了")).toBeInTheDocument();

    const oneCompleted = fixture();
    oneCompleted.initiatives.find(item => item.id === "work-a")!.milestones = row.milestones.map((step, index) => ({ ...step, completed: index === 0 }));
    api.getBusinessWorkspace.mockResolvedValue(oneCompleted);
    fireEvent.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() => expect(parseFloat(fill().style.width)).toBeCloseTo(100 / 3, 2));
    expect(bar()).toHaveClass("business-overview-bar-in_progress");

    const allCompleted = fixture();
    allCompleted.initiatives.find(item => item.id === "work-a")!.milestones = row.milestones.map(step => ({ ...step, completed: true }));
    api.getBusinessWorkspace.mockResolvedValue(allCompleted);
    fireEvent.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() => expect(fill().style.width).toBe("100%"));
    expect(bar()).toHaveClass("business-overview-bar-in_progress");
  });

  it("keeps the same report form and draft when switching between timeline and list", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<BusinessPage profile={profile} onCreateAnnouncement={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "最初の取り組み" }));
    const report = await screen.findByLabelText("近況の本文");
    const disclosure = report.closest("details");
    if (disclosure && !disclosure.open) fireEvent.click(disclosure.querySelector("summary")!);
    fireEvent.change(report, { target: { value: "切り替えても残る書きかけ" } });
    fireEvent.click(screen.getByRole("button", { name: "一覧・近況" }));
    expect(screen.getByLabelText("近況の本文")).toBe(report);
    expect(report).toHaveValue("切り替えても残る書きかけ");
    fireEvent.click(screen.getByRole("button", { name: "工程表" }));
    expect(screen.getByLabelText("近況の本文")).toBe(report);
    expect(report).toHaveValue("切り替えても残る書きかけ");
    expect(confirm).not.toHaveBeenCalled();
    expect(api.getBusinessInitiativeDetail).toHaveBeenCalledTimes(1);
  });

  it("keeps initiative creation order after updates arrive in a different response order", async () => {
    render(<BusinessPage profile={profile} onCreateAnnouncement={vi.fn()} />);
    const table = await screen.findByRole("table");
    const names = () => within(table).getAllByRole("button").map(button => button.textContent);
    expect(names()).toEqual(["最初の取り組み", "次の取り組み"]);
    const next = fixture();
    next.initiatives[0].updatedAt = 9000;
    next.initiatives.reverse();
    next.fetchedAt = 2000;
    api.getBusinessWorkspace.mockResolvedValue(next);
    fireEvent.click(screen.getByRole("button", { name: "最新情報に更新" }));
    await waitFor(() => expect(api.getBusinessWorkspace).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "最新情報に更新" })).toBeEnabled());
    expect(names()).toEqual(["最初の取り組み", "次の取り組み"]);
    expect(within(table).getAllByRole("columnheader").slice(2).map(header => header.getAttribute("aria-label"))).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
  });
});
