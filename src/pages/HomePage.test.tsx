import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";
import { I18nProvider } from "../i18n";
import type { DailyReport, DailyReportAutomation, PresidentInstruction, Role } from "../types";

const state = vi.hoisted(() => ({ role: "employee" as Role, business: true }));
const api = vi.hoisted(() => ({ clockIn: vi.fn(), clockOut: vi.fn(), correctAttendance: vi.fn(), watchAiUsageEvents: vi.fn(() => () => undefined) }));
vi.mock("../auth", () => ({ useAuth: () => ({ profile: { uid: "owner", displayName: "確認用", role: state.role, active: true } }) }));
vi.mock("../services/api", () => api);
vi.mock("../features/business/api", () => ({ get businessFeatureAvailable() { return state.business; } }));
vi.mock("../components/SharedCalendar", () => ({ SharedCalendar: () => <div>カレンダーの予定詳細</div> }));
const props = () => ({ attendance: [], reports: [], holidayOverrides: [], onReport: vi.fn(), onSection: vi.fn(), onAnnouncements: vi.fn(), notify: vi.fn() });
beforeEach(() => {
  state.role = "employee"; state.business = true;
  localStorage.removeItem("gyoumulog-locale");
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.removeItem("gyoumulog-locale"); });
const show = (p: ComponentProps<typeof HomePage> = props()) => render(<I18nProvider><HomePage {...p} /></I18nProvider>);

describe("Home app launcher", () => {
  it("keeps details behind icons and opens calendar without attendance controls", () => {
    show();
    expect(screen.queryByText("カレンダーの予定詳細")).not.toBeInTheDocument();
    expect(screen.queryByText("勤務状況")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "共有業務カレンダー" }));
    expect(screen.getByText("カレンダーの予定詳細")).toBeInTheDocument();
    expect(screen.queryByText("勤務状況")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ホームの機能一覧へ戻る" }));
    expect(screen.getByRole("heading", { name: "機能一覧" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /勤怠・打刻/ }));
    expect(screen.getByRole("heading", { name: "勤怠・打刻" })).toBeInTheDocument();
    expect(screen.queryByText("カレンダーの予定詳細")).not.toBeInTheDocument();
  });
  it("opens existing destinations and announcement workspace from icons", () => {
    state.role = "employee_manager";
    const p = { ...props(), canManageAccounts: true };
    show(p);
    for (const [label, section] of [["記録", "records"], ["商品候補", "products"], ["業務サイクル", "workflow"], ["今週のTo Do", "weeklyTodo"], ["会社の取り組み", "business"], ["管理", "admin"], ["ログイン管理", "accounts"], ["使い方", "help"], ["更新情報", "updates"], ["設定", "settings"]]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(p.onSection).toHaveBeenLastCalledWith(section);
    }
    fireEvent.click(screen.getByRole("button", { name: "お知らせ" }));
    expect(p.onAnnouncements).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^日報/ }));
    expect(p.onReport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "更新情報" })).not.toHaveTextContent(/未確認|未読/);
  });
  it.each(["employee", "president_viewer"] as Role[])("retains permission visibility for %s", (role) => {
    state.role = role;
    show({ ...props(), canManageAccounts: true });
    expect(screen.queryByRole("button", { name: "ログイン管理" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "設定" })).toBeInTheDocument();
    if (role === "president_viewer") {
      expect(screen.queryByRole("button", { name: /勤怠・打刻|^日報|^記録$/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "管理" })).toBeInTheDocument();
    } else expect(screen.queryByRole("button", { name: "管理" })).not.toBeInTheDocument();
  });
  it("hides unverified account administration and disabled business feature", () => {
    state.role = "employee_manager"; state.business = false;
    show();
    expect(screen.queryByRole("button", { name: "ログイン管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "会社の取り組み" })).not.toBeInTheDocument();
  });
  it("opens the oldest own provisional report rather than a different employee's report", () => {
    const p = { ...props(), onConfirmReport: vi.fn(), reports: [
      { id: "other", userId: "other", reportDate: "2026-01-01", status: "provisional" },
      { id: "own-new", userId: "owner", reportDate: "2026-09-29", status: "provisional" },
      { id: "own-old", userId: "owner", reportDate: "2026-09-28", status: "provisional" }
    ] as DailyReport[] };
    show(p);
    fireEvent.click(screen.getByRole("button", { name: "日報 確認して提出" }));
    expect(p.onConfirmReport).toHaveBeenCalledWith(p.reports[2]);
  });
  it("routes an unresolved automation failure to its date, but ignores a submitted report's old failure", () => {
    const p = { ...props(), onReportDate: vi.fn(), automations: [
      { id: "submitted-failure", userId: "owner", workDate: "2026-09-27", status: "failed" },
      { id: "failure", userId: "owner", workDate: "2026-09-28", status: "blocked_no_memo" }
    ] as DailyReportAutomation[], reports: [{ userId: "owner", reportDate: "2026-09-27", status: "submitted" }] as DailyReport[] };
    show(p);
    fireEvent.click(screen.getByRole("button", { name: "日報 自動作成を要確認" }));
    expect(p.onReportDate).toHaveBeenCalledWith("2026-09-28");
  });
  it("returns to icons when the existing home menu is pressed again", () => {
    const p = props();
    const { rerender } = show(p);
    fireEvent.click(screen.getByRole("button", { name: "共有業務カレンダー" }));
    rerender(<I18nProvider><HomePage {...p} homeVisit={1} /></I18nProvider>);
    expect(screen.getByRole("heading", { name: "機能一覧" })).toBeInTheDocument();
    expect(screen.queryByText("カレンダーの予定詳細")).not.toBeInTheDocument();
  });
  it("shows only the recipient's pending announcements and supports Chinese names", () => {
    localStorage.setItem("gyoumulog-locale", "zh-CN");
    show({ ...props(), instructions: [
      { id: "pending", status: "active", recipientStates: { owner: { status: "pending" } } },
      { id: "other", status: "active", recipientStates: { other: { status: "pending" } } },
      { id: "ack", status: "active", recipientStates: { owner: { status: "acknowledged" } } }
    ] as unknown as PresidentInstruction[] });
    expect(screen.getByRole("button", { name: "通知 1条未确认" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通知 1条未确认" }).querySelector(".home-app-icon .home-app-badge")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "共享工作日历" }));
    expect(screen.getByRole("button", { name: "返回首页功能列表" })).toBeInTheDocument();
  });
  it.each(["employee", "employee_manager", "president_viewer"] as Role[])("counts individual and all-recipient announcements for %s, excluding other people's states and closed items", (role) => {
    state.role = role;
    show({ ...props(), instructions: [
      { id: "individual", status: "active", recipientStates: { owner: { status: "pending" } } },
      { id: "all", status: "active", recipientStates: { owner: { status: "pending" }, other: { status: "pending" } } },
      { id: "confirmed", status: "active", recipientStates: { owner: { status: "acknowledged" }, other: { status: "pending" } } },
      { id: "own-complete", status: "active", recipientStates: { owner: { status: "completed" }, other: { status: "pending" } } },
      { id: "cancelled", status: "cancelled", recipientStates: { owner: { status: "pending" } } },
      { id: "closed", status: "completed", recipientStates: { owner: { status: "pending" } } },
      { id: "sent", authorId: "owner", status: "active", recipientStates: { other: { status: "pending" } } }
    ] as unknown as PresidentInstruction[] });
    const button = screen.getByRole("button", { name: "お知らせ 未確認 2件" });
    expect(button.querySelector(".home-app-icon .home-app-badge")).toHaveTextContent("2");
    expect(button.querySelector(".home-app-badge")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "更新情報" }).querySelector(".home-app-badge")).toBeNull();
  });
  it("updates the badge on incoming data and clears it only after the recipient confirms", () => {
    const p = props();
    const item = { id: "new", status: "active", recipientStates: { owner: { status: "pending" } } } as unknown as PresidentInstruction;
    const { rerender } = show(p);
    expect(screen.getByRole("button", { name: "お知らせ" }).querySelector(".home-app-badge")).toBeNull();
    const refresh = (instructions: PresidentInstruction[]) => rerender(<I18nProvider><HomePage {...p} instructions={instructions} /></I18nProvider>);
    refresh([item]);
    const button = screen.getByRole("button", { name: "お知らせ 未確認 1件" });
    fireEvent.click(button);
    expect(p.onAnnouncements).toHaveBeenCalledTimes(1);
    expect(within(button).getByText("1")).toBeInTheDocument();
    refresh([{ ...item, recipientStates: { owner: { ...item.recipientStates.owner, status: "acknowledged" } } }]);
    expect(screen.getByRole("button", { name: "お知らせ" }).querySelector(".home-app-badge")).toBeNull();
    refresh([item, { ...item, id: "another" }]);
    expect(screen.getByRole("button", { name: "お知らせ 未確認 2件" }).querySelector(".home-app-badge")).toHaveTextContent("2");
    refresh([]);
    expect(screen.getByRole("button", { name: "お知らせ" }).querySelector(".home-app-badge")).toBeNull();
  });
  it("caps large badges while keeping the full count in the accessible name", () => {
    const instructions = Array.from({ length: 100 }, (_, i) => ({ id: String(i), status: "active", recipientStates: { owner: { status: "pending" } } })) as unknown as PresidentInstruction[];
    const p = { ...props(), instructions };
    const { rerender } = show(p);
    expect(screen.getByRole("button", { name: "お知らせ 未確認 100件" }).querySelector(".home-app-badge")).toHaveTextContent("99+");
    rerender(<I18nProvider><HomePage {...p} instructions={instructions.slice(0, 99)} /></I18nProvider>);
    expect(screen.getByRole("button", { name: "お知らせ 未確認 99件" }).querySelector(".home-app-badge")).toHaveTextContent("99");
  });
});
