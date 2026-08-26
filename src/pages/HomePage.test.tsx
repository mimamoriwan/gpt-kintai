import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";

const authState = vi.hoisted(() => ({ profile: { uid: "president", displayName: "社長", role: "president_viewer", active: true } }));
const apiMocks = vi.hoisted(() => ({
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  correctAttendance: vi.fn(),
  watchAiUsageEvents: vi.fn()
}));

vi.mock("../auth", () => ({
  useAuth: () => ({ profile: authState.profile })
}));

vi.mock("../i18n", () => ({
  useI18n: () => ({ locale: "ja", t: (key: string) => key })
}));

vi.mock("../components/SharedCalendar", () => ({
  SharedCalendar: () => <div>共有業務カレンダー本体</div>
}));

vi.mock("../services/api", () => apiMocks);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authState.profile = { uid: "president", displayName: "社長", role: "president_viewer", active: true };
});

describe("HomePage president view", () => {
  it("shows the shared calendar without attendance or daily-report controls", () => {
    render(<HomePage attendance={[]} reports={[]} holidayOverrides={[]} onReport={vi.fn()} notify={vi.fn()} />);

    expect(screen.getByText("共有業務カレンダー本体")).toBeInTheDocument();
    expect(screen.queryByText("workStatus")).not.toBeInTheDocument();
    expect(screen.queryByText("reportReminder")).not.toBeInTheDocument();
    expect(screen.queryByText("最近の勤務")).not.toBeInTheDocument();
  });

  it("alerts the manager when actual API generations reach 50 in the current month", () => {
    authState.profile = { uid: "manager", displayName: "管理担当", role: "employee_manager", active: true };
    const now = new Date();
    apiMocks.watchAiUsageEvents.mockImplementation((callback) => {
      callback(Array.from({ length: 50 }, (_, index) => ({
        id: `ai-${index}`,
        actorId: "employee",
        subjectUserId: "employee",
        entityType: "daily_report_draft",
        entityId: `employee_${index}`,
        action: "ai_generated",
        createdAt: { toDate: () => now, toMillis: () => now.getTime() + index }
      })));
      return () => undefined;
    });

    render(<HomePage attendance={[]} reports={[]} holidayOverrides={[]} onReport={vi.fn()} notify={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("今月のAI生成が50回になりました");
    expect(screen.getByText(/管理画面の「日報AIの利用状況」/)).toBeInTheDocument();
  });
});
