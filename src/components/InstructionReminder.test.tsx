import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstructionReminder } from "./InstructionReminder";
import type { PresidentInstruction, UserProfile } from "../types";

const state = vi.hoisted(() => ({
  profile: { uid: "recipient", email: "recipient@example.com", displayName: "受信者", role: "employee", locale: "ja", active: true } as UserProfile | null,
  locale: "ja"
}));

vi.mock("../auth", () => ({ useAuth: () => ({ profile: state.profile }) }));
vi.mock("../i18n", () => ({ useI18n: () => ({ locale: state.locale }) }));

function row(overrides: Partial<PresidentInstruction> = {}): PresidentInstruction {
  return {
    id: "instruction-1", authorId: "president", authorName: "社長", titleOriginal: "資料を確認してください", bodyOriginal: "会議前に内容をご確認ください。",
    titleZh: "请确认资料", bodyZh: "请在会议前确认内容。", translationStatus: "completed", translationAttempts: 1, priority: "normal", dueDate: "",
    recipientIds: ["recipient"], recipientStates: { recipient: { userId: "recipient", displayName: "受信者", status: "pending" } }, status: "active",
    createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1), ...overrides
  };
}

function visibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  fireEvent(document, new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-17T09:00:00+09:00"));
  window.localStorage.clear();
  state.profile = { uid: "recipient", email: "recipient@example.com", displayName: "受信者", role: "employee", locale: "ja", active: true };
  state.locale = "ja";
  visibility("visible");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("announcement reminders", () => {
  it("shows the highest priority pending item and opens exactly that item without acknowledging it", () => {
    const open = vi.fn();
    const instructions = [
      row({ id: "newest", createdAt: Timestamp.fromMillis(4) }),
      row({ id: "urgent-later", priority: "urgent", dueDate: "2026-09-19" }),
      row({ id: "urgent-first", titleOriginal: "最優先のお知らせ", priority: "urgent", dueDate: "2026-09-18" })
    ];
    render(<InstructionReminder instructions={instructions} onOpen={open} />);

    expect(screen.getByRole("status")).toHaveTextContent("未確認のお知らせがあります");
    expect(screen.getByRole("status")).toHaveTextContent("社長からのお知らせ · 3件未確認");
    expect(screen.getByRole("status")).toHaveTextContent("最優先のお知らせ");
    fireEvent.click(screen.getByRole("button", { name: "内容を開く" }));
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("urgent-first");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(instructions.every((item) => item.recipientStates.recipient.status === "pending")).toBe(true);
  });

  it("dismisses the entire current queue and does not repeat on same-day remount", () => {
    const open = vi.fn();
    const instructions = [row(), row({ id: "instruction-2" })];
    const { unmount } = render(<InstructionReminder instructions={instructions} onOpen={open} />);
    fireEvent.click(screen.getByRole("button", { name: "あとで確認" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    unmount();
    render(<InstructionReminder instructions={instructions} onOpen={open} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(instructions.every((item) => item.recipientStates.recipient.status === "pending")).toBe(true);
  });

  it("still displays its first reminder under React strict mode", () => {
    render(<StrictMode><InstructionReminder instructions={[row()]} onOpen={vi.fn()} /></StrictMode>);
    expect(screen.getByRole("status")).toBeVisible();
  });

  it("shows a newly arrived announcement after the current queue was dismissed", () => {
    const old = row();
    const { rerender } = render(<InstructionReminder instructions={[old]} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あとで確認" }));
    rerender(<InstructionReminder instructions={[old, row({ id: "new", titleOriginal: "新しいお知らせ", createdAt: Timestamp.fromMillis(2) })]} onOpen={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("新しいお知らせ");
    expect(screen.getByRole("status")).toHaveTextContent("2件未確認");
  });

  it("opens the new or manually reminded item even when an older urgent announcement remains pending", () => {
    const open = vi.fn();
    const urgent = row({ id: "old-urgent", titleOriginal: "以前の緊急通知", priority: "urgent" });
    const normal = row({ id: "new-normal", titleOriginal: "今回のお知らせ" });
    const { rerender } = render(<InstructionReminder instructions={[urgent]} onOpen={open} />);
    fireEvent.click(screen.getByRole("button", { name: "あとで確認" }));
    rerender(<InstructionReminder instructions={[urgent, normal]} onOpen={open} />);
    expect(screen.getByRole("status")).toHaveTextContent("今回のお知らせ");
    fireEvent.click(screen.getByRole("button", { name: "内容を開く" }));
    expect(open).toHaveBeenLastCalledWith("new-normal");
    rerender(<InstructionReminder instructions={[urgent, { ...normal, recipientStates: {
      recipient: { ...normal.recipientStates.recipient, reminderCount: 1, lastRemindedAt: Timestamp.fromMillis(100) }
    } }]} onOpen={open} />);
    expect(screen.getByRole("status")).toHaveTextContent("今回のお知らせ");
    fireEvent.click(screen.getByRole("button", { name: "内容を開く" }));
    expect(open).toHaveBeenLastCalledWith("new-normal");
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("reminds again at the next JST day without a page reload", () => {
    vi.setSystemTime(new Date("2026-09-17T23:59:59+09:00"));
    render(<InstructionReminder instructions={[row()]} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あとで確認" }));
    act(() => vi.advanceTimersByTime(900));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("status")).toBeVisible();
  });

  it("rechecks the day when focus returns after the clock has changed", () => {
    render(<InstructionReminder instructions={[row()]} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あとで確認" }));
    vi.setSystemTime(new Date("2026-09-18T08:00:00+09:00"));
    fireEvent(window, new Event("focus"));
    expect(screen.getByRole("status")).toBeVisible();
  });

  it("only repeats for this recipient's manual reminder version", () => {
    const initial = row({
      recipientIds: ["recipient", "other"],
      recipientStates: {
        recipient: { userId: "recipient", displayName: "受信者", status: "pending" },
        other: { userId: "other", displayName: "他の社員", status: "pending" }
      }
    });
    const { rerender } = render(<InstructionReminder instructions={[initial]} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あとで確認" }));
    const otherReminder = { ...initial, lastReminderAt: Timestamp.fromMillis(100), recipientStates: {
      ...initial.recipientStates,
      other: { ...initial.recipientStates.other, reminderCount: 1, lastRemindedAt: Timestamp.fromMillis(100) }
    } };
    rerender(<InstructionReminder instructions={[otherReminder]} onOpen={vi.fn()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<InstructionReminder instructions={[{ ...otherReminder, recipientStates: {
      ...otherReminder.recipientStates,
      recipient: { ...initial.recipientStates.recipient, reminderCount: 1, lastRemindedAt: Timestamp.fromMillis(100) }
    } }]} onOpen={vi.fn()} />);
    expect(screen.getByRole("status")).toBeVisible();
  });

  it("does not consume queued reminders while paused", () => {
    const instructions = [row()];
    const { rerender } = render(<InstructionReminder instructions={instructions} onOpen={vi.fn()} paused />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    rerender(<InstructionReminder instructions={instructions} onOpen={vi.fn()} />);
    expect(screen.getByRole("status")).toBeVisible();
  });

  it("does not consume reminders in a hidden tab, including at the daily rollover", () => {
    visibility("hidden");
    vi.setSystemTime(new Date("2026-09-17T23:59:59+09:00"));
    render(<InstructionReminder instructions={[row()]} onOpen={vi.fn()} />);
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    visibility("visible");
    expect(screen.getByRole("status")).toBeVisible();
  });

  it("removes the prompt after acknowledgement or cancellation and ignores other recipients", () => {
    const instructions = [row()];
    const { rerender } = render(<InstructionReminder instructions={instructions} onOpen={vi.fn()} />);
    expect(screen.getByRole("status")).toBeVisible();
    rerender(<InstructionReminder instructions={[row({ recipientStates: { recipient: { userId: "recipient", displayName: "受信者", status: "acknowledged" } } })]} onOpen={vi.fn()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<InstructionReminder instructions={[row({ id: "cancel-me" })]} onOpen={vi.fn()} />);
    expect(screen.getByRole("status")).toBeVisible();
    rerender(<InstructionReminder instructions={[
      row({ id: "cancel-me", status: "cancelled" }),
      row({ id: "completed", status: "completed" }),
      row({ id: "other", recipientIds: ["other"], recipientStates: { other: { userId: "other", displayName: "他の社員", status: "pending" } } })
    ]} onOpen={vi.fn()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("isolates deliveries by account and removes stale account prompts on logout", () => {
    const initial = row({ recipientIds: ["recipient", "other"], recipientStates: {
      recipient: { userId: "recipient", displayName: "受信者", status: "pending" },
      other: { userId: "other", displayName: "他の社員", status: "pending" }
    } });
    const { rerender } = render(<InstructionReminder instructions={[initial]} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あとで確認" }));
    state.profile = { ...state.profile!, uid: "other" };
    rerender(<InstructionReminder instructions={[initial]} onOpen={vi.fn()} />);
    expect(screen.getByRole("status")).toBeVisible();
    state.profile = { ...state.profile!, uid: "recipient" };
    rerender(<InstructionReminder instructions={[initial]} onOpen={vi.fn()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    state.profile = null;
    rerender(<InstructionReminder instructions={[initial]} onOpen={vi.fn()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("isolates reused instruction ids across demo datasets", () => {
    state.profile = { ...state.profile!, isDemo: true, demoDatasetId: "demo-one" };
    const { rerender } = render(<InstructionReminder instructions={[row({ isDemo: true, demoDatasetId: "demo-one" })]} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あとで確認" }));
    state.profile = { ...state.profile!, demoDatasetId: "demo-two" };
    rerender(<InstructionReminder instructions={[row({ isDemo: true, demoDatasetId: "demo-two" })]} onOpen={vi.fn()} />);
    expect(screen.getByRole("status")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "あとで確認" }));
    state.profile = { ...state.profile!, demoDatasetId: "demo-one" };
    rerender(<InstructionReminder instructions={[row({ isDemo: true, demoDatasetId: "demo-one" })]} onOpen={vi.fn()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each(["write", "read-and-write"])("keeps working and avoids duplicate prompts when storage fails: %s", (failure) => {
    state.profile = { ...state.profile!, demoDatasetId: `storage-failure-${failure}` };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    if (failure === "read-and-write") vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    const { unmount } = render(<InstructionReminder instructions={[row()]} onOpen={vi.fn()} />);
    expect(screen.getByRole("status")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "あとで確認" }));
    unmount();
    render(<InstructionReminder instructions={[row()]} onOpen={vi.fn()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    vi.setSystemTime(new Date("2026-09-18T08:00:00+09:00"));
    fireEvent(window, new Event("focus"));
    expect(screen.getByRole("status")).toBeVisible();
  });

  it("uses the translated title and Chinese action labels", () => {
    state.locale = "zh-CN";
    render(<InstructionReminder instructions={[row()]} onOpen={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("有尚未确认的通知");
    expect(screen.getByRole("status")).toHaveTextContent("请确认资料");
    expect(screen.getByRole("button", { name: "打开内容" })).toBeVisible();
    expect(screen.getByRole("button", { name: "稍后确认" })).toBeVisible();
  });
});
