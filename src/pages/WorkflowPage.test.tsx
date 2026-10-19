import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { WorkflowPage } from "./WorkflowPage";
import type { WeeklyReport, WeeklyReportTheme } from "../types";

const state = vi.hoisted(() => ({ role: "employee_manager", locale: "ja" }));
const api = vi.hoisted(() => ({ generateMonthlyReport: vi.fn(), generateWeeklyReport: vi.fn(), saveWeeklyReport: vi.fn() }));
vi.mock("../services/api", () => api);
vi.mock("../auth", () => ({ useAuth: () => ({ profile: { uid: "manager", role: state.role } }) }));
vi.mock("../i18n", () => ({ useI18n: () => ({ locale: state.locale }) }));
const theme = (title: string, includeInReport?: boolean): WeeklyReportTheme => ({ title, includeInReport, objective: "目的", activities: `${title}の業務内容`, outcomes: `${title}の成果`, evidence: "資料", chinaMarketInsight: "", issues: "", nextAction: "次の行動", sourceReferences: ["2026-08-25", "2026-09-25"] });
const monthlyReport = (): WeeklyReport => ({
  id: "month-report", userId: "manager", userName: "テスト担当", reportKind: "monthly", periodStart: "2026-08-25", periodEnd: "2026-09-25", weekStart: "2026-08-25", weekEnd: "2026-09-25", status: "finalized", revision: 1, hasUnreviewedReports: false, unreviewedReportCount: 0,
  themes: [theme("市場調査"), theme("出力しない案件", false)], nextPriorities: [], executiveSummary: "出力しない案件が要約にも含まれる", keyOutcomes: "", blockers: "", decisionsNeeded: "", previousGoals: "", completedWork: "", productResults: "", chinaMarketInsights: "", planActualGap: "", continuingIssues: "", nextWeekPlan: "", pendingItems: ""
});
const props = (weeklyReports: WeeklyReport[] = []): ComponentProps<typeof WorkflowPage> => ({
  users: [{ uid: "manager", displayName: "テスト担当", email: "test@example.com", role: "employee_manager", locale: "ja", active: true }],
  attendance: [], reports: [], dutyDefinitions: [], employmentBases: [], sourceDocuments: [], weeklyPlans: [], weeklyReports, weeklyMeetings: [], nonWorkingReasons: [], evidenceReferences: [], monthlyPackages: [], renewalChecklists: [], notify: vi.fn()
});
function chooseMonthly() {
  fireEvent.change(screen.getByLabelText("レポートの種類"), { target: { value: "monthly" } });
  fireEvent.change(screen.getByLabelText("開始日"), { target: { value: "2026-08-25" } });
  fireEvent.change(screen.getByLabelText("終了日"), { target: { value: "2026-09-25" } });
}
beforeEach(() => {
  state.role = "employee_manager"; state.locale = "ja";
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-25T01:00:00Z"));
  api.generateMonthlyReport.mockResolvedValue({ id: "month-report" }); api.saveWeeklyReport.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); document.body.classList.remove("weekly-report-printing"); });

describe("WorkflowPage monthly reports", () => {
  it("sends the exact selected dates and hides weekly plans/meetings", async () => {
    render(<WorkflowPage {...props()} />); chooseMonthly();
    fireEvent.click(screen.getByRole("button", { name: "AIでテーマ別の月次下書きを作成" }));
    await waitFor(() => expect(api.generateMonthlyReport).toHaveBeenCalledWith("manager", "2026-08-25", "2026-09-25"));
    expect(api.generateWeeklyReport).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "今週の計画" })).not.toBeInTheDocument();
  });
  it("blocks missing, reversed, and oversized periods", () => {
    render(<WorkflowPage {...props()} />); chooseMonthly();
    for (const date of ["", "2026-08-24", "2027-09-25"]) {
      fireEvent.change(screen.getByLabelText("終了日"), { target: { value: date } });
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "AIでテーマ別の月次下書きを作成" })).toBeDisabled();
    }
  });
  it("previews only selected themes, keeps excluded text editable, and saves selection without deleting it", async () => {
    render(<WorkflowPage {...props([monthlyReport()])} />); chooseMonthly();
    const preview = screen.getByRole("region", { name: "月次レポートの出力プレビュー" });
    expect(preview).toHaveTextContent("市場調査の業務内容"); expect(preview).not.toHaveTextContent("出力しない案件");
    expect(preview).toHaveTextContent("2026-08-25 〜 2026-09-25");
    expect(screen.getByDisplayValue("出力しない案件の業務内容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "このテーマを出力する：出力しない案件" }));
    expect(preview).toHaveTextContent("出力しない案件の業務内容"); expect(preview).toHaveTextContent("下書き");
    fireEvent.click(screen.getByRole("button", { name: "編集内容を保存" }));
    await waitFor(() => expect(api.saveWeeklyReport).toHaveBeenCalled());
    expect(api.saveWeeklyReport.mock.calls[0][0].sections.themes[1]).toMatchObject({ includeInReport: true, activities: "出力しない案件の業務内容" });
  });
  it("does not print or finalize an empty selection", () => {
    render(<WorkflowPage {...props([monthlyReport()])} />); chooseMonthly();
    fireEvent.click(screen.getByRole("checkbox", { name: "このテーマを出力する：市場調査" }));
    expect(screen.getByRole("button", { name: "月次レポートを印刷・PDF保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "最終確定" })).toBeDisabled();
  });
  it("reopens saved periods with persisted selections and preserves existing weekly reports", () => {
    const month = monthlyReport(); const week = { ...month, id: "weekly", reportKind: undefined, periodStart: undefined, periodEnd: undefined, weekStart: "2026-09-14", weekEnd: "2026-09-20" };
    render(<WorkflowPage {...props([month, week])} />);
    expect(screen.getByRole("heading", { name: "週次業務レポート" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("レポートの種類"), { target: { value: "monthly" } });
    fireEvent.change(screen.getByLabelText("保存済みの月次レポート"), { target: { value: "month-report" } });
    expect(screen.getByLabelText("開始日")).toHaveValue("2026-08-25");
    expect(screen.getByRole("checkbox", { name: "このテーマを出力する：出力しない案件" })).not.toBeChecked();
  });
  it("limits printing to the monthly preview and excludes editing controls", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const view = render(<WorkflowPage {...props([monthlyReport()])} />); chooseMonthly();
    fireEvent.click(screen.getByRole("button", { name: "月次レポートを印刷・PDF保存" }));
    expect(print).toHaveBeenCalledOnce(); expect(document.body).toHaveClass("weekly-report-printing");
    const areas = view.container.querySelectorAll(".weekly-print-area"); expect(areas).toHaveLength(1);
    expect(areas[0]).not.toHaveTextContent("出力しない案件"); expect(areas[0].querySelector("input,textarea,button")).toBeNull();
    window.dispatchEvent(new Event("afterprint")); print.mockRestore();
  });
  it("keeps employee/viewer editing and generation disabled", () => {
    state.role = "president_viewer";
    render(<WorkflowPage {...props([monthlyReport()])} />); chooseMonthly();
    expect(screen.queryByRole("button", { name: "AIでテーマ別の月次下書きを作成" })).not.toBeInTheDocument();
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
  });
  it("uses Chinese labels for the new period controls and preview", () => {
    state.locale = "zh-CN";
    render(<WorkflowPage {...props([monthlyReport()])} />);
    fireEvent.change(screen.getByLabelText("报告类型"), { target: { value: "monthly" } });
    fireEvent.change(screen.getByLabelText("已保存的月报"), { target: { value: "month-report" } });
    const preview = screen.getByRole("region", { name: "月报输出预览" });
    expect(within(preview).getByRole("heading", { name: "月度业务报告" })).toBeInTheDocument();
    expect(screen.getByLabelText("开始日期")).toHaveValue("2026-08-25");
  });
});
