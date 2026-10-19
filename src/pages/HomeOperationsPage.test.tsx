import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase/firestore";
import { todayJst } from "../lib/format";
import type { AttendanceRecord } from "../types";
import * as attendanceRecovery from "../lib/attendanceRecovery";
import { HomeOperationsPage as HomePage } from "./HomeOperationsPage";

const authState = vi.hoisted(() => ({ profile: { uid: "president", displayName: "社長", role: "president_viewer", active: true } }));
const i18nState = vi.hoisted(() => ({ locale: "ja" }));
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
  useI18n: () => ({ locale: i18nState.locale, t: (key: string) => key })
}));

vi.mock("../components/SharedCalendar", () => ({
  SharedCalendar: () => <div>共有業務カレンダー本体</div>
}));

vi.mock("../services/api", () => apiMocks);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.sessionStorage.clear();
  i18nState.locale = "ja";
  authState.profile = { uid: "president", displayName: "社長", role: "president_viewer", active: true };
});

describe("HomePage president view", () => {
  it("shows the shared calendar without attendance or daily-report controls", () => {
    render(<HomePage view="calendar" attendance={[]} reports={[]} holidayOverrides={[]} onReport={vi.fn()} notify={vi.fn()} />);

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
    // This recovery path starts from the regular workday attendance controls.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-09T03:00:00Z"));
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

describe("HomePage attendance feedback", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T03:00:00Z"));
    authState.profile = { uid: "employee", displayName: "担当者", role: "employee", active: true };
    apiMocks.clockIn.mockReset();
    apiMocks.clockOut.mockReset();
    apiMocks.correctAttendance.mockReset();
  });

  function home(attendance: AttendanceRecord[], notify = vi.fn()) {
    return <HomePage attendance={attendance} reports={[]} holidayOverrides={[]} onReport={vi.fn()} notify={notify} />;
  }

  it("does not restore an attendance correction dialog while viewing the calendar", () => {
    const read = vi.spyOn(attendanceRecovery, "readMissedClockOutDraft");
    render(<HomePage view="calendar" attendance={[attendanceRecord({ workDate: "2026-09-09" })]} reports={[]} holidayOverrides={[]} onReport={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByText("共有業務カレンダー本体")).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows clock-in progress immediately and prevents another punch until the saved record arrives", async () => {
    const request = deferred<string>();
    apiMocks.clockIn.mockReturnValue(request.promise);
    const notify = vi.fn();
    const { rerender } = render(home([], notify));
    const button = screen.getByRole("button", { name: "clockIn" });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(screen.getByRole("status")).toHaveTextContent("始業時刻を記録中…");
    expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "homeWork" })).toBeDisabled();
    expect(apiMocks.clockIn).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByText("working")).not.toBeInTheDocument();

    await act(async () => { request.resolve("attendance-1"); });

    expect(notify).toHaveBeenCalledWith("success", "始業時刻を記録しました。");
    expect(screen.getByRole("status")).toHaveTextContent("記録済み・画面を更新中…");
    expect(button).toBeDisabled();
    rerender(home([attendanceRecord({ id: "another-record" })], notify));
    expect(screen.getByRole("button", { name: /画面を更新中/ })).toBeDisabled();

    rerender(home([attendanceRecord()], notify));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "clockOut" })).toBeEnabled();
    expect(screen.getByText("08:17〜")).toBeInTheDocument();
    expect(apiMocks.clockIn).toHaveBeenCalledTimes(1);
  });

  it("keeps clock-out blocked after acknowledgement until the completed record arrives", async () => {
    const request = deferred<void>();
    apiMocks.clockOut.mockReturnValue(request.promise);
    const notify = vi.fn();
    const { rerender } = render(home([attendanceRecord()], notify));
    fireEvent.click(screen.getByRole("button", { name: "clockOut" }));
    const confirm = screen.getByRole("button", { name: "終業を確定" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(screen.getByRole("status")).toHaveTextContent("終業時刻を記録中…");
    expect(confirm).toBeDisabled();
    expect(apiMocks.clockOut).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByText("終了済み")).not.toBeInTheDocument();

    await act(async () => { request.resolve(); });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /画面を更新中/ })).toBeDisabled();
    expect(notify).toHaveBeenCalledWith("success", "終業時刻を記録しました。");

    rerender(home([attendanceRecord({ status: "completed", endedAt: Timestamp.fromDate(new Date("2026-09-10T03:04:00Z")) })], notify));

    expect(screen.getByText("終了済み")).toBeInTheDocument();
    expect(screen.getByText("12:04")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "clockOut" })).not.toBeInTheDocument();
  });

  it.each(["clock-in", "clock-out"])("handles a %s subscription update before the callable response", async (kind) => {
    const starting = kind === "clock-in";
    const request = deferred<string>();
    (starting ? apiMocks.clockIn : apiMocks.clockOut).mockReturnValue(request.promise);
    const notify = vi.fn();
    const { rerender } = render(home(starting ? [] : [attendanceRecord()], notify));
    fireEvent.click(screen.getByRole("button", { name: starting ? "clockIn" : "clockOut" }));
    if (!starting) fireEvent.click(screen.getByRole("button", { name: "終業を確定" }));

    rerender(home([attendanceRecord(starting ? {} : { status: "completed", endedAt: Timestamp.fromDate(new Date("2026-09-10T03:04:00Z")) })], notify));

    expect(screen.getByRole("status")).toHaveTextContent("記録中…");
    if (starting) expect(screen.getByRole("button", { name: /始業時刻を記録中/ })).toBeDisabled();
    expect(notify).not.toHaveBeenCalled();

    await act(async () => { request.resolve("attendance-1"); });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(notify).toHaveBeenCalledTimes(1);
    if (starting) expect(screen.getByRole("button", { name: "clockOut" })).toBeEnabled();
    else expect(screen.getByText("終了済み")).toBeInTheDocument();
  });

  it("preserves the manual start and reason on failure and prevents simultaneous form submissions", async () => {
    const request = deferred<string>();
    apiMocks.clockIn.mockReturnValueOnce(request.promise).mockResolvedValueOnce("attendance-1");
    const notify = vi.fn();
    render(home([], notify));
    fireEvent.click(screen.getByRole("button", { name: "始業時刻を修正して開始" }));
    const dialog = screen.getByRole("dialog");
    const startTime = within(dialog).getByLabelText("始業時刻");
    const reason = within(dialog).getByLabelText("修正理由");
    fireEvent.change(startTime, { target: { value: "2026-09-10T08:30" } });
    fireEvent.change(reason, { target: { value: "出先で始業打刻を忘れたため" } });

    act(() => {
      fireEvent.submit(dialog);
      fireEvent.submit(dialog);
    });

    expect(apiMocks.clockIn).toHaveBeenCalledTimes(1);
    expect(startTime).toBeDisabled();
    expect(reason).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /始業時刻を記録中/ })).toBeDisabled();

    await act(async () => { request.reject(new Error("通信に失敗しました。")); });

    expect(startTime).toHaveValue("2026-09-10T08:30");
    expect(reason).toHaveValue("出先で始業打刻を忘れたため");
    expect(startTime).toBeEnabled();
    expect(notify).toHaveBeenCalledWith("error", "通信に失敗しました。");
    expect(notify).not.toHaveBeenCalledWith("success", expect.anything());

    fireEvent.submit(dialog);
    await waitFor(() => expect(apiMocks.clockIn).toHaveBeenCalledTimes(2));
    expect(apiMocks.clockIn).toHaveBeenLastCalledWith("office", { startedAt: "2026-09-09T23:30:00.000Z", reason: "出先で始業打刻を忘れたため" });
  });

  it("keeps missed clock-out correction locked until the previous record is completed", async () => {
    const request = deferred<void>();
    apiMocks.correctAttendance.mockReturnValue(request.promise);
    const previousRecord = attendanceRecord({ workDate: "2026-09-09", startedAt: Timestamp.fromDate(new Date("2026-09-09T00:00:00Z")) });
    const notify = vi.fn();
    const { rerender } = render(home([previousRecord], notify));
    fireEvent.click(screen.getByRole("button", { name: "終業時刻を入力" }));
    fireEvent.submit(screen.getByRole("dialog"));

    expect(screen.getByRole("status")).toHaveTextContent("終業時刻を修正中…");
    await act(async () => { request.resolve(); });
    expect(screen.getByRole("button", { name: "終業時刻を入力" })).toBeDisabled();

    rerender(home([{ ...previousRecord, status: "completed", endedAt: Timestamp.fromDate(new Date("2026-09-09T08:00:00Z")) }], notify));

    expect(screen.getByRole("button", { name: "clockIn" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each(["appCheck/throttled", "appCheck/initial-throttle", "app-check/throttled", "appCheck/fetch-network-error"])("preserves missed clock-out input and gives persistent recovery for %s", async (code) => {
    const previousRecord = attendanceRecord({ workDate: "2026-09-09", startedAt: Timestamp.fromDate(new Date("2026-09-09T00:00:00Z")) });
    apiMocks.correctAttendance.mockRejectedValue(Object.assign(new Error("AppCheck: Requests throttled due to previous 403 error"), { code }));
    const notify = vi.fn();
    render(home([previousRecord], notify));
    fireEvent.click(screen.getByRole("button", { name: "終業時刻を入力" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("endTime"), { target: { value: "2026-09-09T18:30" } });
    fireEvent.change(within(dialog).getByLabelText("修正理由"), { target: { value: "外出先で終業打刻を忘れたため" } });
    fireEvent.submit(dialog);

    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("アプリ認証"));
    expect(within(dialog).getByLabelText("endTime")).toHaveValue("2026-09-09T18:30");
    expect(within(dialog).getByLabelText("修正理由")).toHaveValue("外出先で終業打刻を忘れたため");
    expect(within(dialog).getByRole("button", { name: "前日の勤務を確定" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "入力を保持して再読み込み" })).toBeEnabled();
    expect(notify).toHaveBeenCalledWith("error", expect.stringContaining("アプリ認証"));
    expect(notify).not.toHaveBeenCalledWith("success", expect.anything());
    expect(apiMocks.correctAttendance).toHaveBeenCalledOnce();
    expect(apiMocks.correctAttendance).toHaveBeenCalledWith({ id: "attendance-1", startedAt: "2026-09-09T00:00:00.000Z", endedAt: "2026-09-09T09:30:00.000Z", reason: "外出先で終業打刻を忘れたため", correctionKind: "missed_clock_out" });
  });

  it("retains a correction on explicit reload and restores it after the listener loads without submitting", async () => {
    const previousRecord = attendanceRecord({ workDate: "2026-09-09", startedAt: Timestamp.fromDate(new Date("2026-09-09T00:00:00Z")) });
    const reload = vi.fn();
    const realReloadWithDraft = attendanceRecovery.reloadWithMissedClockOutDraft;
    vi.spyOn(attendanceRecovery, "reloadWithMissedClockOutDraft").mockImplementation((input) => realReloadWithDraft(input, reload));
    apiMocks.correctAttendance.mockRejectedValue(Object.assign(new Error("backoff"), { code: "appCheck/throttled" }));
    const first = render(home([previousRecord]));
    fireEvent.click(screen.getByRole("button", { name: "終業時刻を入力" }));
    fireEvent.change(screen.getByLabelText("endTime"), { target: { value: "2026-09-09T18:30" } });
    fireEvent.change(screen.getByLabelText("修正理由"), { target: { value: "外出先で終業打刻を忘れたため" } });
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(screen.getByRole("button", { name: "入力を保持して再読み込み" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "入力を保持して再読み込み" }));

    expect(reload).toHaveBeenCalledOnce();
    expect(attendanceRecovery.readMissedClockOutDraft("employee")).toMatchObject({ attendanceId: "attendance-1", endedAtLocal: "2026-09-09T18:30", reason: "外出先で終業打刻を忘れたため" });
    first.unmount();
    const second = render(home([]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    second.rerender(home([previousRecord]));
    expect(screen.getByLabelText("endTime")).toHaveValue("2026-09-09T18:30");
    expect(screen.getByLabelText("修正理由")).toHaveValue("外出先で終業打刻を忘れたため");
    expect(apiMocks.correctAttendance).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("endTime"), { target: { value: "2026-09-09T18:45" } });
    second.rerender(home([{ ...previousRecord }]));
    expect(screen.getByLabelText("endTime")).toHaveValue("2026-09-09T18:45");

    apiMocks.correctAttendance.mockResolvedValueOnce(undefined);
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(attendanceRecovery.readMissedClockOutDraft("employee")).toBeNull();
    expect(screen.getByRole("button", { name: "終業時刻を入力" })).toBeDisabled();
  });

  it("shows missed clock-out app verification recovery in Chinese", async () => {
    i18nState.locale = "zh-CN";
    const previousRecord = attendanceRecord({ workDate: "2026-09-09", startedAt: Timestamp.fromDate(new Date("2026-09-09T00:00:00Z")) });
    apiMocks.correctAttendance.mockRejectedValue(Object.assign(new Error("backoff"), { code: "appCheck/throttled" }));
    render(home([previousRecord]));
    fireEvent.click(screen.getByRole("button", { name: "输入结束时间" }));
    fireEvent.submit(screen.getByRole("dialog"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("应用验证暂时限制重试"));
    expect(screen.getByRole("button", { name: "保留输入并刷新" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "确认前一天考勤" })).toBeEnabled();
  });

  it("keeps the correction visible when browser storage cannot preserve it", async () => {
    const previousRecord = attendanceRecord({ workDate: "2026-09-09", startedAt: Timestamp.fromDate(new Date("2026-09-09T00:00:00Z")) });
    apiMocks.correctAttendance.mockRejectedValue(Object.assign(new Error("backoff"), { code: "appCheck/throttled" }));
    render(home([previousRecord]));
    fireEvent.click(screen.getByRole("button", { name: "終業時刻を入力" }));
    fireEvent.change(screen.getByLabelText("endTime"), { target: { value: "2026-09-09T18:30" } });
    fireEvent.submit(screen.getByRole("dialog"));
    await waitFor(() => expect(screen.getByRole("button", { name: "入力を保持して再読み込み" })).toBeEnabled());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage unavailable"); });

    fireEvent.click(screen.getByRole("button", { name: "入力を保持して再読み込み" }));

    expect(screen.getByRole("alert")).toHaveTextContent("画面は再読み込みしていません");
    expect(screen.getByLabelText("endTime")).toHaveValue("2026-09-09T18:30");
    expect(screen.getByRole("button", { name: "前日の勤務を確定" })).toBeEnabled();
    expect(apiMocks.correctAttendance).toHaveBeenCalledOnce();
  });

  it.each(["another account", "another record", "completed record"])("does not restore a correction for %s", (mismatch) => {
    const previousRecord = attendanceRecord({ workDate: "2026-09-09", startedAt: Timestamp.fromDate(new Date("2026-09-09T00:00:00Z")) });
    attendanceRecovery.reloadWithMissedClockOutDraft({ userId: "employee", attendanceId: "attendance-1", workDate: "2026-09-09", endedAtLocal: "2026-09-09T18:30", reason: "前日の終業打刻を忘れたため" }, vi.fn());
    if (mismatch === "another account") authState.profile = { uid: "another-employee", displayName: "別の担当者", role: "employee", active: true };
    render(home([{ ...previousRecord,
      ...(mismatch === "another record" ? { id: "another-record" } : {}),
      ...(mismatch === "completed record" ? { status: "completed", endedAt: Timestamp.fromDate(new Date("2026-09-09T09:30:00Z")) } : {})
    }]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apiMocks.correctAttendance).not.toHaveBeenCalled();
    if (mismatch === "completed record") expect(attendanceRecovery.readMissedClockOutDraft("employee")).toBeNull();
  });

  it("discards a restored correction when the user cancels", () => {
    const previousRecord = attendanceRecord({ workDate: "2026-09-09", startedAt: Timestamp.fromDate(new Date("2026-09-09T00:00:00Z")) });
    attendanceRecovery.reloadWithMissedClockOutDraft({ userId: "employee", attendanceId: "attendance-1", workDate: "2026-09-09", endedAtLocal: "2026-09-09T18:30", reason: "前日の終業打刻を忘れたため" }, vi.fn());
    render(home([previousRecord]));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(attendanceRecovery.readMissedClockOutDraft("employee")).toBeNull();
  });

  it.each([false, true])("resets the attendance lock on account change (already acknowledged: %s)", async (acknowledged) => {
    const previousRequest = deferred<string>();
    const currentRequest = deferred<string>();
    apiMocks.clockIn.mockReturnValueOnce(previousRequest.promise).mockReturnValueOnce(currentRequest.promise);
    const notify = vi.fn();
    const { rerender } = render(home([], notify));
    fireEvent.click(screen.getByRole("button", { name: "clockIn" }));
    if (acknowledged) await act(async () => { previousRequest.resolve("attendance-1"); });
    notify.mockClear();

    authState.profile = { uid: "another-employee", displayName: "別の担当者", role: "employee", active: true };
    rerender(home([], notify));

    expect(screen.getByRole("button", { name: "clockIn" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "clockIn" }));
    if (!acknowledged) await act(async () => { previousRequest.resolve("attendance-1"); });

    expect(screen.getByRole("status")).toHaveTextContent("始業時刻を記録中…");
    expect(notify).not.toHaveBeenCalled();
    await act(async () => { currentRequest.resolve("attendance-2"); });
    rerender(home([attendanceRecord({ id: "attendance-2", userId: "another-employee" })], notify));

    expect(screen.getByRole("button", { name: "clockOut" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers reload recovery for delayed saved-record updates without enabling another punch", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T03:00:00Z"));
    const request = deferred<string>();
    apiMocks.clockIn.mockReturnValue(request.promise);
    const { rerender } = render(home([]));
    fireEvent.click(screen.getByRole("button", { name: "clockIn" }));
    await act(async () => { request.resolve("attendance-1"); });

    act(() => { vi.advanceTimersByTime(9_999); });
    expect(screen.queryByRole("button", { name: "画面を再読み込み" })).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });

    expect(screen.getByRole("alert")).toHaveTextContent("打刻は保存済みです。表示の更新に時間がかかっています。");
    expect(screen.getByRole("button", { name: "画面を再読み込み" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /画面を更新中/ })).toBeDisabled();
    expect(apiMocks.clockIn).toHaveBeenCalledTimes(1);

    rerender(home([attendanceRecord()]));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "画面を再読み込み" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "clockOut" })).toBeEnabled();
  });

  it.each(["record arrives", "account changes", "page closes"])("cancels delayed recovery when the %s", async (event) => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T03:00:00Z"));
    apiMocks.clockIn.mockResolvedValue("attendance-1");
    const { rerender, unmount } = render(home([]));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "clockIn" })); });
    expect(vi.getTimerCount()).toBe(1);

    if (event === "record arrives") rerender(home([attendanceRecord()]));
    else if (event === "account changes") {
      authState.profile = { uid: "another-employee", displayName: "別の担当者", role: "employee", active: true };
      rerender(home([]));
    } else unmount();

    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByRole("button", { name: "画面を再読み込み" })).not.toBeInTheDocument();
    expect(apiMocks.clockIn).toHaveBeenCalledTimes(1);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function attendanceRecord(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  const startedAt = Timestamp.fromDate(new Date("2026-09-09T23:17:00Z"));
  return {
    id: "attendance-1", userId: "employee", userName: "担当者", workMode: "office", workDate: "2026-09-10",
    status: "active", startedAt, corrected: false, needsReview: false, createdAt: startedAt, updatedAt: startedAt, ...overrides
  };
}
