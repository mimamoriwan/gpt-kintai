import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayJst } from "../lib/format";
import type { DailyReport } from "../types";
import { AdminPage } from "./AdminPage";

const apiMocks = vi.hoisted(() => ({
  addDailyReportComment: vi.fn(),
  deactivateUser: vi.fn(),
  exportMonth: vi.fn(),
  getCalendarMembers: vi.fn(),
  inviteUser: vi.fn(),
  markReviewed: vi.fn(),
  removeCompanyHolidayOverride: vi.fn(),
  saveCalendarMember: vi.fn(),
  saveCategory: vi.fn(),
  saveCompanyHolidayOverride: vi.fn(),
  watchAiUsageEvents: vi.fn(),
  watchWorkLogs: vi.fn()
}));

const authState = vi.hoisted(() => ({
  profile: { uid: "manager-1", role: "employee_manager", displayName: "管理担当", locale: "ja" }
}));

vi.mock("../auth", () => ({
  useAuth: () => ({ profile: authState.profile })
}));

vi.mock("../i18n", () => ({
  useI18n: () => ({ locale: "ja", t: (key: string) => key })
}));

vi.mock("../services/api", () => apiMocks);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authState.profile.uid = "manager-1";
  authState.profile.role = "employee_manager";
  authState.profile.displayName = "管理担当";
});

describe("AdminPage AI usage", () => {
  it("shows API generations and cache reuse separately for the selected month", () => {
    const currentMonth = todayJst().slice(0, 7);
    const currentMonthStart = `${currentMonth}-10T01:00:00Z`;
    const timestamp = (iso: string) => ({
      toDate: () => new Date(iso),
      toMillis: () => new Date(iso).getTime()
    });
    apiMocks.watchAiUsageEvents.mockImplementation((callback) => {
      callback([
        { id: "a1", actorId: "employee-1", subjectUserId: "employee-1", entityType: "daily_report_draft", entityId: `employee-1_${currentMonth}-09`, action: "ai_generated", after: { inputTokens: 120, outputTokens: 30, analyzedAttachmentCount: 1 }, createdAt: timestamp(currentMonthStart) },
        { id: "a2", actorId: "employee-1", subjectUserId: "employee-1", entityType: "daily_report_draft", entityId: `employee-1_${currentMonth}-10`, action: "ai_generated", after: { inputTokens: 80, outputTokens: 20 }, createdAt: timestamp(`${currentMonth}-11T01:00:00Z`) },
        { id: "a3", actorId: "employee-1", subjectUserId: "employee-1", entityType: "daily_report_draft", entityId: `employee-1_${currentMonth}-10`, action: "ai_cache_reused", after: {}, createdAt: timestamp(`${currentMonth}-12T01:00:00Z`) },
        { id: "old", actorId: "employee-1", subjectUserId: "employee-1", entityType: "daily_report_draft", entityId: "r0", action: "ai_generated", after: { inputTokens: 999 }, createdAt: timestamp("2026-07-12T01:00:00Z") }
      ]);
      return () => undefined;
    });

    render(<AdminPage
      attendance={[]}
      reports={[]}
      users={[
        { uid: "manager-1", email: "manager@example.com", displayName: "管理担当", role: "employee_manager", locale: "ja", active: true },
        { uid: "employee-1", email: "employee@example.com", displayName: "方さん", role: "employee", locale: "ja", active: true }
      ]}
      categories={[]}
      holidayOverrides={[]}
      products={[]}
      productObservations={[]}
      notify={vi.fn()}
    />);

    const section = screen.getByText("日報AIの利用状況").closest("section");
    expect(section).not.toBeNull();
    const totals = section!.querySelector<HTMLElement>(".ai-usage-totals");
    expect(totals).not.toBeNull();
    expect(within(totals!).getByText("2回")).toBeInTheDocument();
    expect(within(totals!).getByText("1回")).toBeInTheDocument();
    expect(within(totals!).getByText("200")).toBeInTheDocument();
    expect(within(totals!).getByText("50")).toBeInTheDocument();
    expect(within(section!).getAllByText("方さん").length).toBeGreaterThan(1);
    expect(within(section!).getByText("日時別の利用ログ")).toBeInTheDocument();
    expect(within(section!).getByText("月間API生成 2 / 50回")).toBeInTheDocument();
  });

  it("shows an alert when the current month reaches 50 API generations", () => {
    const date = new Date();
    apiMocks.watchAiUsageEvents.mockImplementation((callback) => {
      callback(Array.from({ length: 50 }, (_, index) => ({
        id: `a-${index}`,
        actorId: "employee-1",
        subjectUserId: "employee-1",
        entityType: "daily_report_draft",
        entityId: `employee-1_${index}`,
        action: "ai_generated",
        after: { inputTokens: 10, outputTokens: 5 },
        createdAt: { toDate: () => date, toMillis: () => date.getTime() + index }
      })));
      return () => undefined;
    });

    render(<AdminPage attendance={[]} reports={[]} users={[{ uid: "employee-1", email: "employee@example.com", displayName: "方さん", role: "employee", locale: "ja", active: true }]} categories={[]} holidayOverrides={[]} products={[]} productObservations={[]} notify={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("今月のAI生成が50回に達しました");
  });

  it("separates provisional reports and automatic-generation problems from submitted reports", () => {
    const currentMonth = todayJst().slice(0, 7);
    apiMocks.watchAiUsageEvents.mockImplementation((callback) => { callback([]); return () => undefined; });

    render(<AdminPage
      attendance={[]}
      reports={[{
        id: "provisional",
        userId: "employee-1",
        userName: "方さん",
        reportDate: `${currentMonth}-01`,
        status: "provisional",
        category: "調査",
        activities: "候補商品を調査",
        sourceLanguage: "ja",
        reviewStatus: "unreviewed",
        revision: 1
      }] as unknown as DailyReport[]}
      automations={[{
        id: "missing-memo",
        userId: "employee-2",
        userName: "李さん",
        workDate: `${currentMonth}-01`,
        status: "blocked_no_memo",
        triggerReason: "day_rollover",
        attemptCount: 0,
        maxAttempts: 3
      }]}
      users={[
        { uid: "employee-1", email: "fang@example.com", displayName: "方さん", role: "employee", locale: "ja", active: true },
        { uid: "employee-2", email: "li@example.com", displayName: "李さん", role: "employee", locale: "zh-CN", active: true }
      ]}
      categories={[]}
      holidayOverrides={[]}
      products={[]}
      productObservations={[]}
      notify={vi.fn()}
    />);

    const panel = screen.getByText("日報自動作成の要対応").closest("section");
    expect(panel).not.toBeNull();
    expect(within(panel!).getByText("本人確認待ち")).toBeInTheDocument();
    expect(within(panel!).getByText("メモなし")).toBeInTheDocument();
    expect(within(panel!).getByText("方さん")).toBeInTheDocument();
    expect(within(panel!).getByText("李さん")).toBeInTheDocument();
    expect(document.querySelector(".review-panel")).toHaveTextContent("提出済みの日報0noData");
  });

  it("lets the president open a submitted report and add a comment", async () => {
    const currentMonth = todayJst().slice(0, 7);
    authState.profile.uid = "president-1";
    authState.profile.role = "president_viewer";
    authState.profile.displayName = "社長";
    apiMocks.addDailyReportComment.mockResolvedValue(undefined);
    apiMocks.watchWorkLogs.mockImplementation(() => () => undefined);

    render(<AdminPage
      attendance={[]}
      reports={[{
        id: "report-1",
        userId: "employee-1",
        userName: "方さん",
        reportDate: `${currentMonth}-01`,
        status: "submitted",
        category: "商品調査",
        area: "",
        destinations: "",
        activities: "候補商品を調査しました。",
        findings: "新しい候補を発見しました。",
        nextPlan: "見積もりを依頼します。",
        sourceLanguage: "ja",
        reviewStatus: "reviewed",
        revision: 1,
        attachments: []
      }] as unknown as DailyReport[]}
      users={[{ uid: "employee-1", email: "fang@example.com", displayName: "方さん", role: "employee", locale: "ja", active: true }]}
      categories={[]}
      holidayOverrides={[]}
      products={[]}
      productObservations={[]}
      notify={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "確認・コメント" }));
    fireEvent.change(screen.getByRole("textbox", { name: "日報へのコメント" }), { target: { value: "次回は価格条件も確認してください。" } });
    fireEvent.click(screen.getByRole("button", { name: "コメントを送信" }));

    await waitFor(() => expect(apiMocks.addDailyReportComment).toHaveBeenCalledWith("report-1", "次回は価格条件も確認してください。"));
    expect(screen.queryByText("markReviewed")).not.toBeInTheDocument();
  });
});
