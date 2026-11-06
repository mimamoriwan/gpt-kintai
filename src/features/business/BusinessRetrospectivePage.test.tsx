import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BusinessRetrospectivePage } from "./BusinessRetrospectivePage";
import type { BusinessRetrospective } from "./types";

const getBusinessRetrospective = vi.hoisted(() => vi.fn());
vi.mock("../../i18n", () => ({ useI18n: () => ({ locale: "ja" }) }));
vi.mock("../../lib/format", () => ({ todayJst: () => "2026-11-06" }));
vi.mock("./api", () => ({ getBusinessRetrospective, businessErrorCode: () => "", businessErrorMessage: () => "取得できませんでした。" }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("submits an explicit period and assignee, shows both types of completion, and opens the source initiative", async () => {
  const fixture: BusinessRetrospective = {
    from: "2026-11-01", to: "2026-11-06", assigneeId: "",
    members: [{ uid: "a", displayName: "担当者A", active: true, role: "employee" }],
    initiatives: [{
      id: "sample", name: "申請準備", sourceLocale: "ja", assigneeIds: ["a"],
      before: { state: "unknown" }, after: { state: "active", completed: 1, total: 2, status: "in_progress" },
      hasActivity: true, completed: [{ id: "checked", name: "条件の確認" }], remaining: [{ id: "remaining", name: "費用の確定" }]
    }],
    reports: [{ id: "report", initiativeId: "sample", authorId: "a", authorName: "担当者A", body: "確認結果を共有しました。", sourceLocale: "ja", createdAt: 1793865600000 }],
    completedMilestones: 1, completedWeekly: 2, weeklyHistoryIncomplete: false, remainingMilestones: 1
  };
  getBusinessRetrospective.mockImplementation(async input => ({ ...fixture, ...input }));
  const onOpenInitiative = vi.fn();
  render(<BusinessRetrospectivePage onOpenInitiative={onOpenInitiative} />);
  const row = await screen.findByRole("row", { name: /申請準備/ });
  expect(within(row).getByText("履歴不足")).toBeInTheDocument();
  expect(within(row).getByText("1/2件完了")).toBeInTheDocument();
  expect(screen.getByText("2件")).toBeInTheDocument();
  expect(screen.getByText("確認結果を共有しました。")).toBeInTheDocument();
  expect(screen.getByText("費用の確定")).toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "申請準備" }));
  expect(onOpenInitiative).toHaveBeenCalledWith("sample");
  fireEvent.change(screen.getByLabelText("開始日"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("終了日"), { target: { value: "2026-10-31" } });
  fireEvent.change(screen.getByLabelText("担当"), { target: { value: "a" } });
  fireEvent.click(screen.getByRole("button", { name: "集計する" }));
  await waitFor(() => expect(getBusinessRetrospective).toHaveBeenLastCalledWith({ from: "2026-10-01", to: "2026-10-31", assigneeId: "a" }));
  expect(await screen.findByText(/集計期間 2026-10-01/)).toHaveTextContent("担当者A");
});
