import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyReportReplies } from "./DailyReportReplies";
import { unreadReportReplies } from "../lib/reportReplies";
import type { DailyReport } from "../types";

const mocks = vi.hoisted(() => ({ locale: "ja", mark: vi.fn(), notify: vi.fn() }));
vi.mock("../i18n", () => ({ useI18n: () => ({ locale: mocks.locale }) }));
vi.mock("../services/api", () => ({ markDailyReportCommentsRead: mocks.mark }));
const timestamp = { toDate: () => new Date("2026-08-01T01:00:00Z"), toMillis: () => Date.parse("2026-08-01T01:00:00Z") };
const reply = { id: "c1", authorId: "president", authorName: "テスト社長", authorRole: "president_viewer", body: "コメントの内容", createdAt: timestamp };
function report(overrides: Partial<DailyReport> = {}) { return { id: "r1", userId: "owner", status: "submitted", reportDate: "2026-08-01", activities: "提出した内容", comments: [reply], ...overrides } as DailyReport; }
function Harness({ reports, uid = "owner" }: { reports: DailyReport[]; uid?: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <DailyReportReplies reports={reports} uid={uid} selectedReportId={selected} onOpen={setSelected} onClose={() => setSelected(null)} notify={mocks.notify} />;
}
function open() {
  fireEvent.click(screen.getByText("返信のある日報を選ぶ"));
  fireEvent.click(screen.getByRole("button", { name: /返信 1件を確認/ }));
}
beforeEach(() => { mocks.locale = "ja"; mocks.mark.mockReset().mockResolvedValue(undefined); mocks.notify.mockClear(); });
afterEach(cleanup);

describe("daily report reply notifications", () => {
  it("notifies for an older month and opens its report without acknowledging on open or close", () => {
    render(<Harness reports={[report()]} />);
    expect(screen.getByRole("status")).toHaveTextContent("未確認 1件");
    open();
    expect(screen.getByRole("dialog")).toHaveTextContent("提出した内容");
    expect(screen.getByRole("dialog")).toHaveTextContent("コメントの内容");
    expect(mocks.mark).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getAllByRole("button", { name: "閉じる" })[0]);
    expect(screen.getByRole("status")).toHaveTextContent("未確認 1件");
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it("excludes other owners, provisional reports, read comments, and the owner's own comments", () => {
    const rows = [report({ userId: "other" }), report({ status: "provisional" }), report({ commentsReadIds: ["c1"] }), report({ comments: [{ ...reply, authorId: "owner" } as never] })];
    render(<Harness reports={rows} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rows.forEach((row) => expect(unreadReportReplies(row, "owner")).toEqual([]));
  });
  it("saves exactly the shown unread comments on explicit confirmation", async () => {
    render(<Harness reports={[report()]} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "確認しました" }));
    await waitFor(() => expect(mocks.mark).toHaveBeenCalledWith("r1", ["c1"]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("keeps the reply unread and dialog open after a failed save, and permits retry", async () => {
    mocks.mark.mockRejectedValueOnce(new Error("offline"));
    render(<Harness reports={[report()]} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "確認しました" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存できませんでした");
    expect(screen.getByRole("status")).toHaveTextContent("未確認 1件");
    fireEvent.click(screen.getByRole("button", { name: "確認しました" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.mark).toHaveBeenCalledTimes(2);
  });
  it("removes confirmed notifications on a server snapshot and restores them for a new reply", () => {
    const view = render(<Harness reports={[report()]} />);
    view.rerender(<Harness reports={[report({ commentsReadIds: ["c1"] })]} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    view.rerender(<Harness reports={[report({ commentsReadIds: ["c1"], comments: [reply, { ...reply, id: "c2", authorRole: "employee_manager" }] as never })]} />);
    expect(screen.getByRole("status")).toHaveTextContent("未確認 1件");
  });
  it("leaves comments arriving during a pending confirmation unread", async () => {
    let finish!: () => void;
    mocks.mark.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const view = render(<Harness reports={[report()]} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "確認しました" }));
    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
    view.rerender(<Harness reports={[report({ comments: [reply, { ...reply, id: "c2" }] as never })]} />);
    await act(async () => { finish(); });
    expect(mocks.mark).toHaveBeenCalledTimes(1);
    expect(mocks.mark).toHaveBeenCalledWith("r1", ["c1"]);
    view.rerender(<Harness reports={[report({ commentsReadIds: ["c1"], comments: [reply, { ...reply, id: "c2" }] as never })]} />);
    expect(screen.getByRole("status")).toHaveTextContent("未確認 1件");
  });
  it("does not show another user's selected report after an account change", () => {
    const view = render(<Harness reports={[report()]} />);
    open();
    view.rerender(<Harness reports={[report()]} uid="other" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("supports Chinese notification and confirmation text", async () => {
    mocks.locale = "zh-CN";
    render(<Harness reports={[report()]} />);
    expect(screen.getByRole("status")).toHaveTextContent("未确认 1条");
    fireEvent.click(screen.getByText("选择有回复的日报"));
    fireEvent.click(screen.getByRole("button", { name: /查看 1条回复/ }));
    fireEvent.click(screen.getByRole("button", { name: "已确认" }));
    await waitFor(() => expect(mocks.mark).toHaveBeenCalledWith("r1", ["c1"]));
  });
  it("restores focus and closes with Escape", () => {
    render(<Harness reports={[report()]} />);
    fireEvent.click(screen.getByText("返信のある日報を選ぶ"));
    const trigger = screen.getByRole("button", { name: /返信 1件を確認/ });
    trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(trigger).toHaveFocus();
  });
});
