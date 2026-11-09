import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../../types";
import { mondayOf } from "../weeklyTodo/calendar";
import type { TodoItem, TodoWeek } from "../weeklyTodo/types";
import type { BusinessWorkspace } from "./types";
import { BusinessPage } from "./BusinessPage";

const api = vi.hoisted(() => ({ getBusinessWorkspace: vi.fn(), getBusinessInitiativeDetail: vi.fn(), getBusinessHistory: vi.fn(), translateBusinessContent: vi.fn(), setBusinessArchived: vi.fn() }));
const getWeeklyTodoWorkspace = vi.hoisted(() => vi.fn());
const language = vi.hoisted(() => ({ locale: "ja" }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ locale: language.locale }) }));
vi.mock("./api", () => ({ ...api, businessFeatureAvailable: true, businessErrorCode: () => "unknown", businessErrorMessage: () => "通信を完了できませんでした。" }));
vi.mock("../weeklyTodo/api", () => ({ getWeeklyTodoWorkspace, todoError: () => "通信を完了できませんでした。" }));
const profile: UserProfile = { uid: "member", displayName: "担当者", email: "member@example.test", role: "employee", locale: "ja", active: true };
function fixture(): BusinessWorkspace {
  const common = { sourceLocale: "ja" as const, referenceLinks: [], archived: false, version: 1, contentVersion: "v1", createdAt: 1, updatedAt: 2, updatedBy: profile.uid };
  const row = { ...common, id: "work-a", themeId: "theme-a", name: "最初の取り組み", description: "説明", assigneeIds: [profile.uid], status: "in_progress" as const, plannedStartMonth: "2026-09", plannedEndMonth: "2027-03", targetMemo: "", milestones: [] };
  return { settings: { enabled: true, memberIds: [profile.uid], version: 1 }, canManage: false, members: [profile], memberCandidates: [], themes: [{ ...common, id: "theme-a", name: "重点テーマ", description: "テーマの説明", order: 0 }], initiatives: [{ ...row, id: "work-b", name: "次の取り組み", createdAt: 2 }, row], fetchedAt: 1000 };
}
beforeEach(() => {
  vi.resetAllMocks();
  language.locale = "ja";
  api.getBusinessWorkspace.mockResolvedValue(fixture());
  api.getBusinessInitiativeDetail.mockResolvedValue({ updates: [], history: [], nextUpdatesCursor: null, nextHistoryCursor: null, fetchedAt: 1000 });
  api.getBusinessHistory.mockResolvedValue({ history: [], nextCursor: null, fetchedAt: 1000 });
  api.translateBusinessContent.mockRejectedValue(new Error("unused"));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("company initiative overview", () => {
  it.each([
    { locale: "ja", listLabel: "一覧・近況", nextLabel: "次の未完了", countLabel: "7件中3件の達成項目が完了" },
    { locale: "zh-CN", listLabel: "列表与动态", nextLabel: "下一项未完成", countLabel: "7个达成项已完成3个" }
  ] as const)("shows the ordered next milestone with the count and latest report in $locale", async ({ locale, listLabel, nextLabel, countLabel }) => {
    language.locale = locale;
    const workspace = fixture();
    workspace.themes[0].sourceLocale = locale;
    const row = workspace.initiatives[1];
    row.sourceLocale = locale;
    row.milestones = Array.from({ length: 8 }, (_, order) => ({
      id: `item-${order}`, name: `項目${order}`, order, archived: order === 0, completed: order >= 1 && order <= 3,
      updatedAt: 0, updatedBy: profile.uid
    })).reverse();
    row.milestoneGroups = [
      { id: "order", name: "発注・納期", milestoneIds: ["item-2", "item-5", "item-6"] },
      { id: "prepare", name: "準備", milestoneIds: ["item-1", "item-3", "item-4"] }
    ];
    row.latestUpdate = { id: "report", initiativeId: row.id, body: "確認待ち", sourceLocale: locale, contentVersion: "report", authorId: profile.uid, authorName: profile.displayName, createdAt: 4 };
    api.getBusinessWorkspace.mockResolvedValue(workspace);
    render(<BusinessPage profile={profile} onCreateAnnouncement={vi.fn()} />);

    const timelineRow = (await screen.findByRole("button", { name: row.name })).closest("tr")!;
    expect(within(timelineRow).getByLabelText(countLabel)).toHaveTextContent("3/7");
    expect(timelineRow).toHaveTextContent(`${nextLabel} · 発注・納期 / 項目5`);
    expect(timelineRow).not.toHaveTextContent(/[●○]/);
    const bar = timelineRow.querySelector(".business-overview-bar")!;
    fireEvent.click(bar);
    const preview = screen.getByText("発注・納期", { selector: ".business-preview-groups span" }).closest("li")!;
    expect(preview).toHaveTextContent(locale === "ja" ? "1/3件完了" : "已完成1/3项");
    fireEvent.click(screen.getByRole("button", { name: listLabel }));
    const listRow = screen.getByRole("button", { name: row.name }).closest("article")!;
    expect(within(listRow).getByLabelText(countLabel)).toHaveTextContent("3/7");
    expect(listRow).toHaveTextContent(`${nextLabel} · 発注・納期 / 項目5`);
    expect(within(listRow).getByText("確認待ち")).toBeVisible();
  });

  it("shows milestone completion on the schedule bar while retaining its status color", async () => {
    const workspace = fixture();
    const row = workspace.initiatives.find(item => item.id === "work-a")!;
    row.milestones = ["one", "two", "three"].map((id, order) => ({
      id, name: `達成項目${order + 1}`, order, archived: false, completed: false, updatedAt: 0, updatedBy: profile.uid
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
    expect(within(screen.getByRole("row", { name: /最初の取り組み/ })).getByLabelText("3件中0件の達成項目が完了")).toBeInTheDocument();

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
    const names = () => within(table).getAllByRole("button", { name: /^(最初の取り組み|次の取り組み)$/ }).map(button => button.textContent);
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

  it("previews active milestones on hover and opens full details from the schedule bar", async () => {
    const workspace = fixture();
    workspace.initiatives[1].milestones = [
      { id: "done", name: "完了した条件", completed: true, archived: false, order: 0, updatedAt: 2, updatedBy: profile.uid },
      { id: "pending", name: "残りの条件", completed: false, archived: false, order: 1, updatedAt: 2, updatedBy: profile.uid },
      { id: "archived", name: "以前の条件", completed: false, archived: true, order: 2, updatedAt: 2, updatedBy: profile.uid }
    ];
    api.getBusinessWorkspace.mockResolvedValue(workspace);
    render(<BusinessPage profile={profile} onCreateAnnouncement={vi.fn()} />);
    const bar = await screen.findByRole("button", { name: "最初の取り組みの達成項目を確認" });
    fireEvent(bar, Object.assign(new MouseEvent("pointerover", { bubbles: true }), { pointerType: "mouse" }));
    const preview = screen.getByRole("region", { name: "最初の取り組みの達成項目" });
    expect(preview).toHaveTextContent("1/2件完了");
    expect(preview).toHaveTextContent("残り1件");
    expect(preview).toHaveTextContent("残りの条件");
    expect(preview).not.toHaveTextContent("以前の条件");
    expect(api.getBusinessInitiativeDetail).not.toHaveBeenCalled();
    fireEvent.click(bar);
    const details = within(preview).getByRole("button", { name: "詳細を開く" });
    expect(details).toHaveFocus();
    fireEvent.keyDown(details, { key: "Escape" });
    expect(bar).toHaveFocus();
    expect(bar).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(bar);
    fireEvent.click(screen.getByRole("button", { name: "詳細を開く" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(api.getBusinessInitiativeDetail).toHaveBeenCalledWith({ initiativeId: "work-a" });
  });

  it("shows only current shared work for company members and links to its initiative and owner", async () => {
    const weekStart = mondayOf();
    const item = (title: string, extra?: Partial<TodoItem>): TodoItem => ({
      id: title, title, goal: "", progress: 0, memo: "", sourceLocale: "ja", memoLocale: "ja", withdrawn: false, ...extra
    });
    const week = (userId: string, items: TodoItem[], start = weekStart): TodoWeek => {
      const shared = { items, at: 1, revision: 1, contentVersion: "v1" };
      return { userId, weekStart: start, shared, initial: shared, review: null, reviewRevision: null };
    };
    getWeeklyTodoWorkspace.mockResolvedValue({
      ownDraft: { items: [item("未共有の下書き")], version: 1 },
      weeks: [
        week("outsider", [item("対象外の担当")]),
        week(profile.uid, [item("別週の作業")], "2025-01-06"),
        week(profile.uid, [
          item("公開した作業", { businessLink: { initiativeId: "work-a", milestoneId: "done", initiativeName: "最初の取り組み", milestoneName: "完了した条件" } }),
          item("取り下げた作業", { withdrawn: true })
        ])
      ]
    });
    const onOpenWeeklyWork = vi.fn();
    render(<BusinessPage profile={profile} onCreateAnnouncement={vi.fn()} onOpenWeeklyWork={onOpenWeeklyWork} />);
    const assignments = within(await screen.findByRole("complementary", { name: "今週の担当" }));
    expect(await assignments.findByText("公開した作業")).toBeInTheDocument();
    for (const title of ["未共有の下書き", "対象外の担当", "別週の作業", "取り下げた作業"]) {
      expect(assignments.queryByText(title)).not.toBeInTheDocument();
    }
    fireEvent.click(assignments.getByRole("button", { name: "担当者の今週の作業を開く" }));
    expect(onOpenWeeklyWork).toHaveBeenCalledWith(profile.uid);
    fireEvent.click(assignments.getByRole("button", { name: "最初の取り組み" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
