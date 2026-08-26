import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "./AdminPage";

const apiMocks = vi.hoisted(() => ({
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

vi.mock("../auth", () => ({
  useAuth: () => ({ profile: { uid: "manager-1", role: "employee_manager", displayName: "管理担当", locale: "ja" } })
}));

vi.mock("../i18n", () => ({
  useI18n: () => ({ locale: "ja", t: (key: string) => key })
}));

vi.mock("../services/api", () => apiMocks);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdminPage AI usage", () => {
  it("shows API generations and cache reuse separately for the selected month", () => {
    const timestamp = (iso: string) => ({
      toDate: () => new Date(iso),
      toMillis: () => new Date(iso).getTime()
    });
    apiMocks.watchAiUsageEvents.mockImplementation((callback) => {
      callback([
        { id: "a1", actorId: "employee-1", subjectUserId: "employee-1", entityType: "daily_report_draft", entityId: "employee-1_2026-08-09", action: "ai_generated", after: { inputTokens: 120, outputTokens: 30, analyzedAttachmentCount: 1 }, createdAt: timestamp("2026-08-10T01:00:00Z") },
        { id: "a2", actorId: "employee-1", subjectUserId: "employee-1", entityType: "daily_report_draft", entityId: "employee-1_2026-08-10", action: "ai_generated", after: { inputTokens: 80, outputTokens: 20 }, createdAt: timestamp("2026-08-11T01:00:00Z") },
        { id: "a3", actorId: "employee-1", subjectUserId: "employee-1", entityType: "daily_report_draft", entityId: "employee-1_2026-08-10", action: "ai_cache_reused", after: {}, createdAt: timestamp("2026-08-12T01:00:00Z") },
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
});
