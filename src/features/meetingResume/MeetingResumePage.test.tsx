import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { buildResume } from "./model";
import { MeetingResumePage } from "./MeetingResumePage";
import type { DailyReport, UserProfile } from "../../types";
const downloads = vi.hoisted(() => ({ download: vi.fn(), print: vi.fn(async () => undefined) }));
const generations = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./api", () => ({ generateMeetingResume: generations.create }));
vi.mock("./download", () => ({ downloadResume: downloads.download }));
vi.mock("./export", () => ({ printResume: downloads.print, resumeHtml: () => "<html></html>" }));
const profile = { uid: "owner", displayName: "作成者", role: "employee_manager", active: true } as UserProfile;
const rows = [{ id: "report1", userId: "owner", userName: "作成者", reportDate: "2026-10-02", category: "商品開発", activities: "試作を確認", findings: "条件を整理", nextPlan: "次回に相談", status: "submitted" }] as DailyReport[];
function page(allowed = true, who = profile, reports = rows) { return <I18nProvider><MeetingResumePage allowed={allowed} profile={who} reports={reports} users={[profile]} monthlyReports={[]} /></I18nProvider>; }
function prepare(reports = rows) {
  render(page(true, profile, reports));
  fireEvent.change(screen.getByLabelText("開始日"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("終了日"), { target: { value: "2026-10-28" } });
  fireEvent.click(screen.getByRole("button", { name: "日報からたたき台を作成" }));
}
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); localStorage.removeItem("gyoumulog-locale"); });
describe("meeting resume editor", () => {
  it("does not repeat the unsaved browser prompt for an approved update and retains the draft if it times out", async () => {
    const api = await import("../../pwaUpdate");
    let waiting!: () => void;
    api.initializeAppUpdates((options => { waiting = options!.onNeedRefresh!; return vi.fn().mockResolvedValue(undefined); }) as Parameters<typeof api.initializeAppUpdates>[0]);
    prepare();
    const leaving = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
    expect(leaving()).toBe(true);
    waiting(); expect(leaving()).toBe(true);
    vi.useFakeTimers();
    await act(async () => { await api.applyAppUpdate(); });
    expect(leaving()).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(leaving()).toBe(true);
    expect(screen.getByLabelText("今回の要点（1行に1項目）")).toHaveValue("条件を整理");
  });
  it.each([[false, profile], [true, { ...profile, role: "employee" as const }], [true, { ...profile, isDemo: true }], [true, { ...profile, active: false }]])("does not render without the verified real owner capability", (allowed, who) => {
    const { container } = render(page(allowed, who)); expect(container).toBeEmptyDOMElement();
  });
  it("builds an editable visual resume, previews changes and excludes unchecked themes from exports", () => {
    prepare();
    const preview = screen.getByRole("article", { name: "会議レジュメのプレビュー" });
    fireEvent.change(screen.getByLabelText("今回の要点（1行に1項目）"), { target: { value: "今月の会議用に整理" } });
    expect(within(preview).getByText("今月の会議用に整理")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("テーマ1を掲載"));
    expect(screen.getByRole("button", { name: "印刷・PDF保存" })).toBeDisabled();
    expect(within(preview).queryByText("試作を確認")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再編集用の下書きを保存" }));
    const draft = JSON.parse(downloads.download.mock.calls[0][1]);
    expect(draft).toMatchObject({ summary: "今月の会議用に整理", themes: [{ included: false }], sources: [{ activities: "試作を確認" }] });
  });
  it("exports the current edited document and opens the isolated print flow", async () => {
    prepare();
    fireEvent.change(screen.getByLabelText("資料タイトル"), { target: { value: "定例会配布資料" } });
    fireEvent.click(screen.getByRole("button", { name: "配布用HTMLを保存" }));
    await waitFor(() => expect(downloads.download).toHaveBeenCalledWith("meeting-resume-2026-10-01-2026-10-28.html", "<html></html>", "text/html;charset=utf-8"));
    fireEvent.click(screen.getByRole("button", { name: "印刷・PDF保存" }));
    await waitFor(() => expect(downloads.print).toHaveBeenCalledWith(expect.objectContaining({ title: "定例会配布資料" }), "ja"));
  });
  it("preserves the existing document when conditions change or regeneration is cancelled", () => {
    prepare();
    fireEvent.change(screen.getByLabelText("終了日"), { target: { value: "2026-10-03" } });
    expect(screen.getByRole("status")).toHaveTextContent("プレビューは前回");
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "日報からたたき台を作成" }));
    expect(within(screen.getByRole("article", { name: "会議レジュメのプレビュー" })).getByText("2026.10.01 — 2026.10.28")).toBeInTheDocument();
  });
  it("does not overwrite the draft when the daily source changes", () => {
    // Source subscriptions can refresh while a meeting document is being edited.
    const changed = [{ ...rows[0], findings: "日報を訂正" }];
    const view = render(page());
    fireEvent.change(screen.getByLabelText("開始日"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("終了日"), { target: { value: "2026-10-28" } });
    fireEvent.click(screen.getByRole("button", { name: "日報からたたき台を作成" }));
    fireEvent.change(screen.getByLabelText("今回の要点（1行に1項目）"), { target: { value: "編集を保持" } });
    view.rerender(<I18nProvider><MeetingResumePage allowed profile={profile} reports={changed} users={[profile]} monthlyReports={[]} /></I18nProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("参照日報に更新");
    expect(screen.getByLabelText("今回の要点（1行に1項目）")).toHaveValue("編集を保持");
  });
});


describe("complete meeting text", () => {
  it("shows every long line through its final sentence in the editor, preview and saved draft", () => {
    const longLines = Array.from({ length: 6 }, (_, i) => `行${i}：${"詳細な確認内容".repeat(30)}。結論${i}まで記載。`);
    const full = longLines.join("\n");
    prepare([{ ...rows[0], activities: full, findings: full, nextPlan: full }]);
    expect(screen.getByLabelText("今回の要点（1行に1項目）")).toHaveValue(full);
    const preview = screen.getByRole("article", { name: "会議レジュメのプレビュー" });
    for (const line of longLines) expect(preview).toHaveTextContent(line);
    expect(preview.textContent).not.toContain("…");
    fireEvent.click(screen.getByRole("button", { name: "再編集用の下書きを保存" }));
    const saved = JSON.parse(downloads.download.mock.calls[0][1]);
    expect(saved.summary).toBe(full);
    expect(saved.themes[0]).toMatchObject({ activities: full, findings: full, nextAction: full });
  });
  it("keeps legacy edits on import, blocks clipped exports, and recovers the full text on regeneration", async () => {
    const full = "原文".repeat(120) + "。最後の条件まで記載。";
    const reports = [{ ...rows[0], activities: full }];
    const legacy = buildResume({ reports, userId: profile.uid, from: "2026-10-01", to: "2026-10-28", owner: profile, locale: "ja", createdDate: "2026-10-28" });
    delete legacy.textVersion;
    legacy.themes[0].activities = full.slice(0, 140) + "…";
    legacy.discussion = "本人が追記した相談事項";
    const text = JSON.stringify(legacy);
    const selected = Object.assign(new File([text], "draft.json", { type: "application/json" }), { text: async () => text });
    const view = render(page(true, profile, reports));
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [selected] } });
    await screen.findByText(/元の日報を途中で切った文章/);
    expect(screen.getByLabelText("会議で確認・相談したいこと")).toHaveValue("本人が追記した相談事項");
    expect(screen.getByRole("button", { name: "印刷・PDF保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "配布用HTMLを保存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "日報からたたき台を作成" }));
    expect(screen.getByRole("button", { name: "印刷・PDF保存" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "配布用HTMLを保存" })).toBeEnabled();
    expect(screen.getByRole("article", { name: "会議レジュメのプレビュー" })).toHaveTextContent(full);
  });
});

describe("long AI generation", () => {
  it("shows actual elapsed time beyond the former timeout and keeps edited content after cancellation", async () => {
    vi.useFakeTimers();
    generations.create.mockImplementation((_input, progress, signal) => {
      progress({ stage: "composing", count: 32 });
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true }));
    });
    prepare();
    fireEvent.change(screen.getByLabelText("今回の要点（1行に1項目）"), { target: { value: "会議前の編集を保持" } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "AIで会議資料を作成" }));
    expect(screen.getByRole("timer")).toHaveTextContent("経過 0分00秒");
    expect(screen.getByText(/記録量により数分/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(601_000); });
    expect(screen.getByRole("timer")).toHaveTextContent("経過 10分01秒");
    expect(generations.create).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("今回の要点（1行に1項目）")).toHaveValue("会議前の編集を保持");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "作成を中止" })); });
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.getByLabelText("今回の要点（1行に1項目）")).toHaveValue("会議前の編集を保持");
    expect(screen.getByRole("button", { name: "AIで会議資料を作成" })).toBeEnabled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("shows a stage-specific time limit without replacing the current edited draft", async () => {
    let reject!: (error: Error) => void;
    generations.create.mockImplementation((_input, progress) => {
      progress({ stage: "composing", count: 32 });
      return new Promise((_resolve, fail) => { reject = fail; });
    });
    prepare();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "AIで会議資料を作成" }));
    await act(async () => { reject(new Error("資料の構成に時間がかかり、制限時間に達しました。現在の資料は保持しています。")); });
    expect(screen.getByRole("alert")).toHaveTextContent("資料の構成に時間がかかり、制限時間に達しました");
    expect(screen.getByLabelText("今回の要点（1行に1項目）")).toHaveValue("条件を整理");
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });
});
