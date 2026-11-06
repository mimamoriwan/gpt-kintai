import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { MeetingResumePage } from "./MeetingResumePage";
import { aiFixture } from "./__fixtures__/ai";
import type { GenerateProgress, GenerateResult } from "./aiModel";
import type { UserProfile } from "../../types";
const mock = vi.hoisted(() => ({ generate: vi.fn(), print: vi.fn(), download: vi.fn() }));
vi.mock("./api", () => ({ generateMeetingResume: mock.generate }));
vi.mock("./download", () => ({ downloadResume: mock.download }));
vi.mock("./export", () => ({ resumeHtml: () => "verified html", printResume: mock.print }));
const owner = { uid: "owner", displayName: "作成者", role: "employee_manager", active: true } as UserProfile;
const president = { uid: "president", displayName: "社長", role: "president_viewer", active: true } as UserProfile;
function prepare() {
  render(<I18nProvider><MeetingResumePage allowed profile={owner} reports={[]} users={[owner, president]} monthlyReports={[]} /></I18nProvider>);
  fireEvent.change(screen.getByLabelText("開始日"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("終了日"), { target: { value: "2026-10-28" } });
  fireEvent.click(screen.getByLabelText("会社の取り組みの投稿・変更履歴"));
  fireEvent.change(screen.getByLabelText("対象者"), { target: { value: "" } });
}
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); localStorage.removeItem("gyoumulog-locale"); });
describe("real AI creation flow", () => {
  it("refuses an artifact whose target period differs from the requested period", async () => {
    const wrong = aiFixture(); wrong.input.periodEnd = "2026-10-27"; mock.generate.mockResolvedValue(wrong);
    prepare(); fireEvent.click(screen.getByRole("button", { name: "AIで会議資料を作成" }));
    await screen.findByText("作成結果の対象条件が一致しません。現在の資料は保持しています。再作成してください。");
    expect(screen.queryByRole("article", { name: "会議レジュメのプレビュー" })).not.toBeInTheDocument();
  });
  it("can start without daily reports, shows streamed stages and prevents duplicate generation", async () => {
    let finish!: (value: GenerateResult) => void, update!: (p: GenerateProgress) => void;
    mock.generate.mockImplementation((_input, progress) => { update = progress; return new Promise(resolve => { finish = resolve; }); });
    prepare(); const button = screen.getByRole("button", { name: "AIで会議資料を作成" });
    expect(button).toBeEnabled(); fireEvent.click(button); expect(button).toBeDisabled();
    expect(screen.getByText("会議資料を作成しています")).toBeInTheDocument();
    update({ stage: "reading", current: 1, total: 2, count: 8 });
    await waitFor(() => expect(screen.getByText("読み取り 1 / 2（対象 8 件）")).toBeInTheDocument());
    fireEvent.click(button); expect(mock.generate).toHaveBeenCalledOnce();
    finish(aiFixture());
    await waitFor(() => expect(screen.getByRole("article", { name: "会議レジュメのプレビュー" })).toBeInTheDocument());
    expect(screen.queryByText("会議資料を作成しています")).not.toBeInTheDocument();
    expect(mock.generate.mock.calls[0][0]).toMatchObject({ userId: "", sources: { daily: true, business: true, todo: true } });
  });
  it("requires review, reflects edited findings and resets review on another edit", async () => {
    mock.generate.mockResolvedValue(aiFixture()); prepare(); fireEvent.click(screen.getByRole("button", { name: "AIで会議資料を作成" }));
    await screen.findByRole("article", { name: "会議レジュメのプレビュー" });
    const print = screen.getByRole("button", { name: "印刷・PDF保存" }); expect(print).toBeDisabled();
    fireEvent.click(screen.getByLabelText("要点・図解・会議の議題と根拠記録を確認した")); expect(print).toBeEnabled();
    fireEvent.change(screen.getByLabelText("今回の要点（1行に1項目）"), { target: { value: "会議に向けて確認した要点。" } });
    expect(print).toBeDisabled(); expect(within(screen.getByRole("article", { name: "会議レジュメのプレビュー" })).getByText("会議に向けて確認した要点。")).toBeInTheDocument();
  });
  it("preserves the previous editable artifact if AI fails", async () => {
    mock.generate.mockResolvedValueOnce(aiFixture()).mockRejectedValueOnce(new Error("AIの接続に失敗しました。"));
    vi.spyOn(window, "confirm").mockReturnValue(true); prepare(); fireEvent.click(screen.getByRole("button", { name: "AIで会議資料を作成" }));
    await screen.findByRole("article", { name: "会議レジュメのプレビュー" });
    fireEvent.change(screen.getByLabelText("今回の要点（1行に1項目）"), { target: { value: "残す編集内容。" } });
    fireEvent.click(screen.getByRole("button", { name: "AIで会議資料を作成" }));
    await screen.findByText("AIの接続に失敗しました。"); expect(within(screen.getByRole("article", { name: "会議レジュメのプレビュー" })).getByText("残す編集内容。")).toBeInTheDocument();
  });
  it("cancels the live request and prevents an aborted result replacing an artifact", async () => {
    let signal!: AbortSignal;
    mock.generate.mockImplementation((_input, _progress, active) => { signal = active; return new Promise((_resolve, reject) => active.addEventListener("abort", () => reject(new Error("aborted")))); });
    prepare(); fireEvent.click(screen.getByRole("button", { name: "AIで会議資料を作成" }));
    fireEvent.click(screen.getByRole("button", { name: "作成を中止" })); expect(signal.aborted).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "AIで会議資料を作成" })).toBeEnabled()); expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});
