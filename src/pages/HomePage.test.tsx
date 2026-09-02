import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayJst } from "../lib/format";
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

  it("prioritizes a no-memo automation failure and opens the affected date", () => {
    authState.profile = { uid: "employee", displayName: "担当者", role: "employee", active: true };
    const targetDate = previousDate(todayJst());
    const onReportDate = vi.fn();

    render(<HomePage
      attendance={[]}
      reports={[]}
      automations={[{ id: "auto-1", userId: "employee", userName: "担当者", workDate: targetDate, status: "blocked_no_memo", triggerReason: "day_rollover", attemptCount: 0, maxAttempts: 3 }]}
      holidayOverrides={[]}
      onReport={vi.fn()}
      onReportDate={onReportDate}
      notify={vi.fn()}
    />);

    expect(screen.getByRole("alert")).toHaveTextContent("業務メモがないため日報を作成できませんでした");
    fireEvent.click(screen.getByRole("button", { name: "メモを確認" }));
    expect(onReportDate).toHaveBeenCalledWith(targetDate);
  });

  it("opens an older provisional report for employee confirmation", () => {
    authState.profile = { uid: "employee", displayName: "担当者", role: "employee", active: true };
    const report = { id: "report-1", userId: "employee", reportDate: previousDate(todayJst()), status: "provisional" } as never;
    const onConfirmReport = vi.fn();

    render(<HomePage attendance={[]} reports={[report]} holidayOverrides={[]} onReport={vi.fn()} onConfirmReport={onConfirmReport} notify={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "確認して提出" }));
    expect(onConfirmReport).toHaveBeenCalledWith(report);
  });

  it("shows a useful recovery message when manual clock-in remains unauthenticated", async () => {
    authState.profile = { uid: "employee", displayName: "担当者", role: "employee", active: true };
    const notify = vi.fn();
    apiMocks.clockIn.mockRejectedValue(Object.assign(new Error("Unauthenticated"), { code: "functions/unauthenticated" }));

    render(<HomePage attendance={[]} reports={[]} holidayOverrides={[]} onReport={vi.fn()} notify={notify} />);

    fireEvent.click(screen.getByRole("button", { name: "始業時刻を修正して開始" }));
    fireEvent.submit(screen.getByRole("dialog"));

    await waitFor(() => expect(notify).toHaveBeenCalledWith(
      "error",
      "ログイン状態を確認できませんでした。画面を再読み込みして、もう一度お試しください。"
    ));
  });
});

function previousDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
