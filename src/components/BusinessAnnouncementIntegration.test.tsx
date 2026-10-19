import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase/firestore";
import { InstructionCenter } from "./PresidentInstructions";
import type { BusinessAnnouncementDraft } from "../features/business/types";
import type { PresidentInstruction } from "../types";

const state = vi.hoisted(() => ({ locale: "ja", profile: { uid: "yasushi", displayName: "ヤスシ", role: "employee_manager", active: true } }));
const api = vi.hoisted(() => ({
  acknowledgePresidentInstruction: vi.fn(), cancelPresidentInstruction: vi.fn(), completePresidentInstruction: vi.fn(),
  createPresidentInstruction: vi.fn(), presidentInstructionAttachmentUrl: vi.fn(), replacePresidentInstruction: vi.fn(),
  retryPresidentInstructionTranslation: vi.fn(), uploadPresidentInstructionFiles: vi.fn(), remindPresidentInstruction: vi.fn()
}));
vi.mock("../auth", () => ({ useAuth: () => ({ profile: state.profile }) }));
vi.mock("../i18n", () => ({ useI18n: () => ({ locale: state.locale }) }));
vi.mock("../services/api", () => api);
vi.mock("../features/business/api", () => ({ businessFeatureAvailable: true }));

const users = [{ uid: "fang", displayName: "方さん", role: "employee" as const, active: true }];
const draft = { key: "from-business-1", title: "販売基盤について", body: "状況を確認してください。\nhttps://example.test/#business/initiative-1" };
const props = { instructions: [], users, open: true, onClose: vi.fn(), notify: vi.fn() };
beforeEach(() => { state.locale = "ja"; state.profile = { uid: "yasushi", displayName: "ヤスシ", role: "employee_manager", active: true }; vi.resetAllMocks(); });
afterEach(cleanup);

describe("business announcement initial values", () => {
  it("opens only local initiative links and closes the notice without acknowledging or completing it", () => {
    const close = vi.fn();
    const link = `${window.location.origin}/#business/initiative-1`;
    const instruction: PresidentInstruction = { id: "notice", authorId: "president", authorName: "社長", titleOriginal: "進捗確認", bodyOriginal: `${link}\nhttps://external.example/#business/initiative-1\n${window.location.origin}/#admin`, translationStatus: "failed", translationAttempts: 1, dueDate: "", createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1), recipientIds: ["yasushi"], recipientStates: { yasushi: { userId: "yasushi", displayName: "ヤスシ", status: "pending" } }, priority: "normal", status: "active" };
    render(<InstructionCenter {...props} instructions={[instruction]} onClose={close} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    fireEvent.click(screen.getByRole("link", { name: link }), { ctrlKey: true });
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: link }));
    expect(close).toHaveBeenCalledOnce();
    expect(api.acknowledgePresidentInstruction).not.toHaveBeenCalled();
    expect(api.completePresidentInstruction).not.toHaveBeenCalled();
  });
  it("opens posting with the requested title/link, keeps edits on updates, and sends only after recipient and submit", async () => {
    api.createPresidentInstruction.mockResolvedValue({ id: "notice", translationStatus: "completed" });
    const { rerender } = render(<InstructionCenter {...props} initialDraft={draft} />);
    expect(screen.getByRole("button", { name: "投稿" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "件名" })).toHaveValue(draft.title);
    expect(screen.getByRole("textbox", { name: "お知らせ内容" })).toHaveValue(draft.body);
    expect(screen.getByRole("button", { name: "お知らせを発信" })).toBeDisabled();
    expect(api.createPresidentInstruction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "件名" }), { target: { value: "確認した件名" } });
    rerender(<InstructionCenter {...props} initialDraft={{ ...draft, title: "same request must not reset" }} users={[...users]} />);
    expect(screen.getByRole("textbox", { name: "件名" })).toHaveValue("確認した件名");
    fireEvent.click(screen.getByRole("button", { name: "方さん" }));
    fireEvent.click(screen.getByRole("button", { name: "お知らせを発信" }));
    await waitFor(() => expect(api.createPresidentInstruction).toHaveBeenCalledWith(expect.objectContaining({ title: "確認した件名", body: draft.body, recipientIds: ["fang"] })));
    expect(api.completePresidentInstruction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "閲覧" })).toHaveAttribute("aria-pressed", "true"));
    rerender(<InstructionCenter {...props} initialDraft={{ ...draft }} />);
    fireEvent.click(screen.getByRole("button", { name: "投稿" }));
    expect(screen.getByRole("textbox", { name: "件名" })).toHaveValue("");
  });

  it("preserves an ordinary draft and attachment while closed and asks before using a new business request", () => {
    const { rerender } = render(<InstructionCenter {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "投稿" }));
    fireEvent.change(screen.getByRole("textbox", { name: "件名" }), { target: { value: "元のお知らせ" } });
    fireEvent.change(screen.getByRole("textbox", { name: "お知らせ内容" }), { target: { value: "保存しておきたい内容" } });
    fireEvent.click(screen.getByRole("button", { name: "方さん" }));
    fireEvent.change(screen.getByLabelText("ファイルを選ぶ"), { target: { files: [new File(["a"], "資料.pdf", { type: "application/pdf" })] } });
    rerender(<InstructionCenter {...props} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<InstructionCenter {...props} initialDraft={draft} />);
    expect(screen.getByRole("textbox", { name: "件名" })).toHaveValue("元のお知らせ");
    expect(screen.getByText("資料.pdf")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("現在の本文・宛先・添付の選択を置き換えます");
    fireEvent.click(screen.getByRole("button", { name: "編集中の内容を続ける" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "お知らせ内容" })).toHaveValue("保存しておきたい内容");
    expect(screen.getByRole("button", { name: "方さん" })).toHaveClass("selected");

    rerender(<InstructionCenter {...props} initialDraft={{ ...draft, key: "from-business-2" }} />);
    fireEvent.click(screen.getByRole("button", { name: "取り組みの内容に切り替える" }));
    expect(screen.getByRole("textbox", { name: "件名" })).toHaveValue(draft.title);
    expect(screen.queryByText("資料.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "方さん" })).not.toHaveClass("selected");
    expect(api.uploadPresidentInstructionFiles).not.toHaveBeenCalled();
    expect(api.createPresidentInstruction).not.toHaveBeenCalled();
  });

  it("opens selected reminders in reading mode while preserving the business draft, recipients, and attachments", () => {
    const instruction: PresidentInstruction = { id: "reminder", authorId: "president", authorName: "社長", titleOriginal: "要確認のお知らせ", bodyOriginal: "内容を確認してください。", translationStatus: "failed", translationAttempts: 1, dueDate: "", createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1), recipientIds: ["yasushi"], recipientStates: { yasushi: { userId: "yasushi", displayName: "ヤスシ", status: "pending" } }, priority: "normal", status: "active" };
    const { rerender } = render(<InstructionCenter {...props} instructions={[instruction]} initialDraft={draft} />);
    fireEvent.change(screen.getByRole("textbox", { name: "件名" }), { target: { value: "編集中の取り組みのお知らせ" } });
    fireEvent.change(screen.getByRole("textbox", { name: "お知らせ内容" }), { target: { value: "残しておく本文" } });
    fireEvent.click(screen.getByRole("button", { name: "方さん" }));
    fireEvent.change(screen.getByLabelText("ファイルを選ぶ"), { target: { files: [new File(["a"], "途中の資料.pdf", { type: "application/pdf" })] } });
    rerender(<InstructionCenter {...props} instructions={[instruction]} initialDraft={draft} open={false} />);
    rerender(<InstructionCenter {...props} instructions={[instruction]} initialDraft={draft} selectedInstructionId="reminder" />);
    expect(screen.getByRole("button", { name: "閲覧" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("article")).toHaveFocus();
    expect(screen.getByRole("heading", { name: "要確認のお知らせ" })).toBeVisible();
    expect(api.acknowledgePresidentInstruction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "投稿" }));
    expect(screen.getByRole("textbox", { name: "件名" })).toHaveValue("編集中の取り組みのお知らせ");
    expect(screen.getByRole("textbox", { name: "お知らせ内容" })).toHaveValue("残しておく本文");
    expect(screen.getByRole("button", { name: "方さん" })).toHaveClass("selected");
    expect(screen.getByText("途中の資料.pdf")).toBeVisible();

    const second = { ...instruction, id: "second", titleOriginal: "次の確認事項" };
    rerender(<InstructionCenter {...props} instructions={[instruction, second]} initialDraft={draft} selectedInstructionId="second" />);
    expect(screen.getByRole("button", { name: "閲覧" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("article")[0]).toHaveTextContent("次の確認事項");
    fireEvent.click(screen.getByRole("button", { name: "未確認 2" }));
    rerender(<InstructionCenter {...props} instructions={[instruction, second]} initialDraft={draft} selectedInstructionId="second" />);
    expect(screen.getByRole("button", { name: "未確認 2" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "投稿" }));
    expect(screen.getByRole("textbox", { name: "件名" })).toHaveValue("編集中の取り組みのお知らせ");
    expect(screen.getByText("途中の資料.pdf")).toBeVisible();
    expect(api.createPresidentInstruction).not.toHaveBeenCalled();
    expect(api.uploadPresidentInstructionFiles).not.toHaveBeenCalled();
  });

  it("does not replay initial values after closing/reopening and clears the composer on account change", () => {
    const { rerender } = render(<InstructionCenter {...props} initialDraft={draft} />);
    fireEvent.change(screen.getByRole("textbox", { name: "件名" }), { target: { value: "編集中の件名" } });
    rerender(<InstructionCenter {...props} initialDraft={draft} open={false} />);
    rerender(<InstructionCenter {...props} initialDraft={draft} />);
    expect(screen.getByRole("button", { name: "閲覧" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "投稿" }));
    expect(screen.getByRole("textbox", { name: "件名" })).toHaveValue("編集中の件名");
    state.profile = { uid: "president", displayName: "社長", role: "president_viewer", active: true };
    rerender(<InstructionCenter {...props} initialDraft={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "投稿" }));
    expect(screen.getByRole("textbox", { name: "件名" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "お知らせ内容" })).toHaveValue("");
  });

  it("supports the president's existing posting permission and Chinese draft handling", () => {
    state.profile = { uid: "president", displayName: "社長", role: "president_viewer", active: true };
    state.locale = "zh-CN";
    const { rerender } = render(<InstructionCenter {...props} initialDraft={draft} />);
    expect(screen.getByRole("button", { name: "发布" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue(draft.title);
    rerender(<InstructionCenter {...props} initialDraft={{ ...draft, key: "new" } as BusinessAnnouncementDraft} />);
    expect(screen.getByRole("alert")).toHaveTextContent("有正在编辑的通知");
    fireEvent.click(screen.getByRole("button", { name: "继续编辑当前内容" }));
    expect(screen.getByRole("textbox", { name: "通知内容" })).toHaveValue(draft.body);
    expect(api.createPresidentInstruction).not.toHaveBeenCalled();
  });

  it("waits for an ongoing send before presenting a new business request without sending it", async () => {
    let finish!: (result: { id: string; translationStatus: string }) => void;
    api.createPresidentInstruction.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(<InstructionCenter {...props} initialDraft={draft} />);
    fireEvent.click(screen.getByRole("button", { name: "方さん" }));
    fireEvent.click(screen.getByRole("button", { name: "お知らせを発信" }));
    await waitFor(() => expect(api.createPresidentInstruction).toHaveBeenCalledOnce());
    const next = { key: "second-request", title: "別の取り組み", body: "別の取り組みのリンク" };
    rerender(<InstructionCenter {...props} initialDraft={next} />);
    expect(screen.getByRole("textbox", { name: "件名" })).toHaveValue(draft.title);
    expect(screen.getByRole("textbox", { name: "件名" })).toBeDisabled();
    await act(async () => finish({ id: "first-notice", translationStatus: "completed" }));
    expect(screen.getByRole("button", { name: "投稿" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "件名" })).toHaveValue(next.title);
    expect(screen.getByRole("textbox", { name: "お知らせ内容" })).toHaveValue(next.body);
    expect(screen.getByRole("button", { name: "お知らせを発信" })).toBeDisabled();
    expect(api.createPresidentInstruction).toHaveBeenCalledOnce();
  });
});
