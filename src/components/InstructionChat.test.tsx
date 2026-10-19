import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstructionChat } from "./InstructionChat";
import type { InstructionMessage, PresidentInstruction } from "../types";

const context = vi.hoisted(() => ({ uid: "recipient", locale: "ja" }));
const api = vi.hoisted(() => ({ sendInstructionMessage: vi.fn(), watchInstructionMessages: vi.fn() }));
vi.mock("../auth", () => ({ useAuth: () => ({ profile: { uid: context.uid } }) }));
vi.mock("../i18n", () => ({ useI18n: () => ({ locale: context.locale }) }));
vi.mock("../services/api", () => api);
const now = Timestamp.fromMillis(1000);
const row = {
  id: "notice", authorId: "author", authorName: "発信者", recipientIds: ["recipient", "other"],
  recipientStates: {
    recipient: { userId: "recipient", displayName: "受信者", status: "completed", completionNote: "以前の返信", completedAt: now },
    other: { userId: "other", displayName: "別の受信者", status: "pending" }
  }, status: "completed", createdAt: now
} as unknown as PresidentInstruction;
const message = (id: string, body: string, senderId = "author", at = 2000): InstructionMessage => ({ id, body, senderId, senderName: senderId === "author" ? "発信者" : "受信者", createdAt: Timestamp.fromMillis(at) });
let receive: (messages: InstructionMessage[]) => void;
let fail: (error: Error) => void;
let unsubscribe: ReturnType<typeof vi.fn>;

async function openChat() {
  const details = screen.getByText(context.locale === "ja" ? "返信・チャット" : "回复与聊天").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await waitFor(() => expect(api.watchInstructionMessages).toHaveBeenCalled());
}
beforeEach(() => {
  context.uid = "recipient";
  context.locale = "ja";
  api.sendInstructionMessage.mockReset().mockResolvedValue(undefined);
  unsubscribe = vi.fn();
  api.watchInstructionMessages.mockReset().mockImplementation((_id, _recipient, _count, callback, onError) => {
    receive = callback;
    fail = onError;
    callback([]);
    return unsubscribe;
  });
});
afterEach(cleanup);

describe("announcement conversations", () => {
  it("pauses subscriptions when the containing announcement is hidden", async () => {
    const { rerender } = render(<InstructionChat row={row} />);
    await openChat();
    rerender(<InstructionChat row={row} active={false} />);
    expect(unsubscribe).toHaveBeenCalledOnce();
    rerender(<InstructionChat row={row} active />);
    expect(api.watchInstructionMessages).toHaveBeenCalledTimes(2);
  });

  it("loads only the recipient's private conversation on demand and keeps legacy comments", async () => {
    const { unmount } = render(<InstructionChat row={row} />);
    expect(api.watchInstructionMessages).not.toHaveBeenCalled();
    await openChat();
    expect(api.watchInstructionMessages).toHaveBeenCalledWith("notice", "recipient", 50, expect.any(Function), expect.any(Function));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(screen.getByRole("log")).getByText("以前の返信")).toBeVisible();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("allows repeated messages even after completion and renders realtime replies in order", async () => {
    render(<InstructionChat row={row} />);
    await openChat();
    const input = screen.getByRole("textbox", { name: "メッセージ" });
    const send = screen.getByRole("button", { name: "返信を送信" });
    expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: "最初の質問" } });
    fireEvent.click(send);
    await waitFor(() => expect(input).toHaveValue(""));
    act(() => receive([message("a", "最初の質問", "recipient"), message("b", "発信者からの回答", "author", 3000)]));
    fireEvent.change(input, { target: { value: "追加の質問" } });
    fireEvent.click(send);
    await waitFor(() => expect(api.sendInstructionMessage).toHaveBeenCalledTimes(2));
    expect(api.sendInstructionMessage.mock.calls[0][0]).toMatchObject({ instructionId: "notice", recipientId: "recipient", body: "最初の質問" });
    expect(api.sendInstructionMessage.mock.calls[1][0].messageId).not.toBe(api.sendInstructionMessage.mock.calls[0][0].messageId);
    expect(within(screen.getByRole("log")).getAllByText(/以前の返信|最初の質問|発信者からの回答/).map((element) => element.textContent)).toEqual(["以前の返信", "最初の質問", "発信者からの回答"]);
  });

  it("keeps a failed draft and reuses its ID on retry, preventing duplicates", async () => {
    api.sendInstructionMessage.mockRejectedValueOnce(new Error("通信エラー"));
    render(<InstructionChat row={row} />);
    await openChat();
    const input = screen.getByRole("textbox", { name: "メッセージ" });
    fireEvent.change(input, { target: { value: "再送する質問" } });
    fireEvent.click(screen.getByRole("button", { name: "返信を送信" }));
    await screen.findByRole("alert");
    expect(input).toHaveValue("再送する質問");
    fireEvent.click(screen.getByRole("button", { name: "返信を送信" }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(api.sendInstructionMessage.mock.calls[0][0]).toEqual(api.sendInstructionMessage.mock.calls[1][0]);
  });

  it("guards double clicks and keeps typing Enter as a newline", async () => {
    let resolve!: () => void;
    api.sendInstructionMessage.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    render(<InstructionChat row={row} />);
    await openChat();
    const input = screen.getByRole("textbox", { name: "メッセージ" });
    fireEvent.change(input, { target: { value: "返信" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(api.sendInstructionMessage).not.toHaveBeenCalled();
    const send = screen.getByRole("button", { name: "返信を送信" });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(api.sendInstructionMessage).toHaveBeenCalledOnce();
    expect(input).toBeDisabled();
    await act(async () => resolve());
  });

  it("lets the author switch private conversations without losing drafts or mixing messages", async () => {
    context.uid = "author";
    render(<InstructionChat row={row} />);
    await openChat();
    act(() => receive([message("a", "一人目の会話")]));
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), { target: { value: "保存中の下書き" } });
    fireEvent.change(screen.getByRole("combobox", { name: "会話の相手" }), { target: { value: "other" } });
    expect(unsubscribe).toHaveBeenCalled();
    expect(screen.queryByText("一人目の会話")).not.toBeVisible();
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("");
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), { target: { value: "二人目への返事" } });
    fireEvent.click(screen.getByRole("button", { name: "返信を送信" }));
    await waitFor(() => expect(api.sendInstructionMessage).toHaveBeenCalledWith(expect.objectContaining({ recipientId: "other", body: "二人目への返事" })));
    fireEvent.change(screen.getByRole("combobox", { name: "会話の相手" }), { target: { value: "recipient" } });
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("保存中の下書き");
  });

  it("loads beyond 50 messages and retains previously loaded history on new messages", async () => {
    render(<InstructionChat row={row} />);
    await openChat();
    const messages = Array.from({ length: 50 }, (_, index) => message(String(index), `返信${index}`, "author", 3000 + index));
    act(() => receive(messages));
    fireEvent.click(screen.getByRole("button", { name: "以前の返信を読み込む" }));
    expect(api.watchInstructionMessages).toHaveBeenLastCalledWith("notice", "recipient", 100, expect.any(Function), expect.any(Function));
    act(() => receive([message("old", "古い返信", "author", 2500), ...messages]));
    expect(screen.getByText("古い返信")).toBeVisible();
    act(() => receive([...messages, message("new", "新しい返信", "author", 4000)]));
    expect(screen.getByText("古い返信")).toBeVisible();
    expect(screen.getByText("新しい返信")).toBeVisible();
  });

  it("shows a retryable load failure and cancelled announcements as read-only", async () => {
    render(<InstructionChat row={{ ...row, status: "cancelled" }} />);
    await openChat();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    act(() => fail(new Error("読み込みエラー")));
    expect(screen.getByRole("alert")).toHaveTextContent("返信を読み込めませんでした");
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(api.watchInstructionMessages).toHaveBeenCalledTimes(2);
    expect(screen.getByText("以前の返信")).toBeVisible();
  });

  it("supports Chinese and does not show another recipient's conversation to outsiders", async () => {
    context.locale = "zh-CN";
    const { rerender } = render(<InstructionChat row={row} />);
    await openChat();
    expect(screen.getByRole("button", { name: "发送回复" })).toBeDisabled();
    context.uid = "outsider";
    rerender(<InstructionChat row={row} />);
    expect(screen.queryByText("回复与聊天")).not.toBeInTheDocument();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
