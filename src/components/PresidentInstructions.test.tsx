import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstructionBanner, InstructionCenter, InstructionHomePanel, InstructionShortcut, sortPresidentInstructions } from "./PresidentInstructions";
import type { PresidentInstruction } from "../types";
import type { InstructionFileUploadOptions } from "../services/api";

const employeeProfile = { uid: "fang", displayName: "方", role: "employee", locale: "zh-CN", active: true } as const;
const authState = vi.hoisted(() => ({ profile: { uid: "fang", displayName: "方", role: "employee", locale: "zh-CN", active: true } as any }));
const i18nState = vi.hoisted(() => ({ locale: "zh-CN" }));
const apiMocks = vi.hoisted(() => ({
  acknowledgePresidentInstruction: vi.fn().mockResolvedValue(undefined),
  cancelPresidentInstruction: vi.fn(),
  completePresidentInstruction: vi.fn(),
  createPresidentInstruction: vi.fn(),
  presidentInstructionAttachmentUrl: vi.fn().mockResolvedValue("https://example.com/instruction-file"),
  remindPresidentInstruction: vi.fn().mockResolvedValue({ ok: true, recipientCount: 1 }),
  replacePresidentInstruction: vi.fn(),
  retryPresidentInstructionTranslation: vi.fn(),
  uploadPresidentInstructionFiles: vi.fn(),
  sendInstructionMessage: vi.fn().mockResolvedValue(undefined),
  watchInstructionMessages: vi.fn((_id, _recipient, _count, callback) => { callback([]); return vi.fn(); })
}));

vi.mock("../auth", () => ({ useAuth: () => authState }));
vi.mock("../i18n", () => ({ useI18n: () => i18nState }));
vi.mock("../services/api", () => apiMocks);
vi.mock("../features/business/api", () => ({ businessFeatureAvailable: true }));

function row(overrides: Partial<PresidentInstruction> = {}): PresidentInstruction {
  return {
    id: "instruction-1", authorId: "president", authorName: "社長", titleOriginal: "日本語件名", bodyOriginal: "日本語本文",
    titleZh: "中文标题", bodyZh: "中文正文", translationStatus: "completed", translationAttempts: 1, priority: "normal", dueDate: "",
    recipientIds: ["fang"], recipientStates: { fang: { userId: "fang", displayName: "方", status: "pending" } }, status: "active",
    isDemo: false, createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1), ...overrides
  };
}

function announcementToggle(title = "中文标题") {
  return within(screen.getByRole("heading", { name: title, level: 3 })).getByRole("button");
}

function expectAnnouncementOrder(titles: string[]) {
  const cards = screen.getAllByRole("article");
  expect(cards).toHaveLength(titles.length);
  titles.forEach((title, index) => expect(within(cards[index]).getByRole("heading", { level: 3 })).toHaveAccessibleName(title));
}

const catalogFiles = [443 * 1024, Math.round(1.1 * 1024 * 1024), Math.round(8.1 * 1024 * 1024)]
  .map((size, index) => new File([new Uint8Array(size)], `catalog-${index + 1}.pdf`, { type: "application/pdf" }));
const catalogAttachments = catalogFiles.map((file, index) => ({
  id: `attachment-${index + 1}`, name: file.name, contentType: file.type, size: file.size,
  storagePath: `president-instructions/draft/fang/catalog-${index + 1}.pdf`
}));

function renderCatalogComposer() {
  const notify = vi.fn();
  const result = render(<InstructionCenter instructions={[]} users={[
    { uid: "fang", displayName: "方", role: "employee", active: true },
    { uid: "manager", displayName: "管理担当", role: "employee_manager", active: true }
  ]} open onClose={vi.fn()} notify={notify} />);
  fireEvent.click(screen.getByRole("button", { name: "发布" }));
  fireEvent.click(screen.getByRole("button", { name: "管理担当" }));
  fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "资料确认" } });
  fireEvent.change(screen.getByRole("textbox", { name: "通知内容" }), { target: { value: "请确认三个附件" } });
  fireEvent.change(screen.getByLabelText("选择文件"), { target: { files: catalogFiles } });
  return { ...result, notify };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  apiMocks.sendInstructionMessage.mockResolvedValue(undefined);
  apiMocks.watchInstructionMessages.mockImplementation((_id, _recipient, _count, callback) => { callback([]); return vi.fn(); });
  apiMocks.acknowledgePresidentInstruction.mockResolvedValue(undefined);
  apiMocks.presidentInstructionAttachmentUrl.mockResolvedValue("https://example.com/instruction-file");
  apiMocks.remindPresidentInstruction.mockResolvedValue({ ok: true, recipientCount: 1 });
  authState.profile = { ...employeeProfile };
  i18nState.locale = "zh-CN";
});

describe("president instructions", () => {
  it.each(["normal", "urgent"] as const)("updates an overdue %s announcement after confirming and completing even while another recipient is pending", async (priority) => {
    i18nState.locale = "ja";
    const props = { users: [], open: true, onClose: vi.fn(), notify: vi.fn() };
    const pending = row({
      priority, dueDate: "2000-01-01", recipientIds: ["fang", "manager"],
      recipientStates: {
        fang: { userId: "fang", displayName: "方", status: "pending" },
        manager: { userId: "manager", displayName: "管理担当", status: "pending" }
      }
    });
    const acknowledged = { ...pending, recipientStates: { ...pending.recipientStates, fang: { ...pending.recipientStates.fang, status: "acknowledged" as const, acknowledgedAt: Timestamp.now() } } };
    const completed = { ...acknowledged, recipientStates: { ...acknowledged.recipientStates, fang: { ...acknowledged.recipientStates.fang, status: "completed" as const, completedAt: Timestamp.now(), completionNote: "確認・対応しました" } } };
    const { rerender } = render(<InstructionCenter {...props} instructions={[pending]} />);
    const tags = () => screen.getByRole("article").querySelector(".instruction-card-tags")!;
    expect(screen.getByRole("article")).toHaveClass("overdue");
    expect(tags()).toHaveTextContent("未確認");
    expect(screen.getByText("期限超過")).toBeVisible();

    apiMocks.acknowledgePresidentInstruction.mockImplementationOnce(async () => {
      rerender(<InstructionCenter {...props} instructions={[acknowledged]} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "内容を確認しました" }));
    await waitFor(() => expect(props.notify).toHaveBeenCalledWith("success", "内容の確認を発信者に伝えました。"));
    expect(apiMocks.acknowledgePresidentInstruction).toHaveBeenCalledWith(pending.id);
    expect(tags()).toHaveTextContent("確認済み");
    expect(screen.getByRole("button", { name: "日本語件名" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "対応を完了" })).not.toBeInTheDocument();
    expect(tags()).not.toHaveTextContent("対応中");
    expect(screen.getByRole("article")).not.toHaveClass("overdue");
    expect(screen.getByRole("article")).not.toHaveClass("urgent");
    expect(screen.queryByText("期限超過")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "内容を確認しました" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "対応中" }));
    expect(screen.getByRole("article")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "日本語件名" }));
    fireEvent.change(screen.getByRole("textbox", { name: "完了メモ（任意）" }), { target: { value: "確認・対応しました" } });
    apiMocks.completePresidentInstruction.mockImplementationOnce(async () => {
      rerender(<InstructionCenter {...props} instructions={[completed]} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "対応を完了" }));
    await waitFor(() => expect(props.notify).toHaveBeenCalledWith("success", "お知らせへの対応を完了しました。"));
    expect(apiMocks.completePresidentInstruction).toHaveBeenCalledWith(pending.id, "確認・対応しました");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "履歴" }));
    expect(tags()).toHaveTextContent("完了");
    expect(tags()).not.toHaveTextContent("対応中");
    expect(screen.getByRole("article")).not.toHaveClass("overdue");
    expect(screen.getByRole("article")).not.toHaveClass("urgent");
    expect(screen.queryByRole("button", { name: "対応を完了" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "日本語件名" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "日本語件名" }));
    expect(screen.getByRole("article")).toHaveTextContent("確認・対応しました");
  });

  it("keeps the sender's overall progress and overdue warning until everyone completes", () => {
    authState.profile = { ...employeeProfile, uid: "president" };
    const props = { users: [], open: true, onClose: vi.fn(), notify: vi.fn() };
    const instruction = row({ priority: "urgent", dueDate: "2000-01-01", recipientIds: ["fang", "manager"], recipientStates: {
      fang: { userId: "fang", displayName: "方", status: "completed" },
      manager: { userId: "manager", displayName: "管理担当", status: "pending" }
    } });
    const { rerender } = render(<InstructionCenter {...props} instructions={[instruction]} />);
    fireEvent.click(screen.getByRole("button", { name: "处理中" }));
    expect(screen.getByRole("article")).toHaveClass("overdue", "urgent");
    expect(screen.getByRole("article").querySelector(".instruction-card-tags")).toHaveTextContent("处理中");
    rerender(<InstructionCenter {...props} instructions={[{ ...instruction, status: "completed", recipientStates: {
      ...instruction.recipientStates, manager: { ...instruction.recipientStates.manager, status: "completed" }
    } }]} />);
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    expect(screen.getByRole("article")).not.toHaveClass("overdue");
    expect(screen.getByRole("article")).not.toHaveClass("urgent");
  });

  it("prioritizes cancellation over the recipient state and removes red emphasis", () => {
    render(<InstructionCenter instructions={[row({ status: "cancelled", priority: "urgent", dueDate: "2000-01-01" })]} users={[]} open onClose={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByRole("article").querySelector(".instruction-card-tags")).toHaveTextContent("已取消");
    expect(screen.getByRole("article")).not.toHaveClass("overdue");
    expect(screen.getByRole("article")).not.toHaveClass("urgent");
    expect(screen.queryByRole("button", { name: "我已确认内容" })).not.toBeInTheDocument();
  });


  it("sends a chat reply from an expanded completed announcement without completing it again", async () => {
    render(<InstructionCenter instructions={[row({ status: "completed", recipientStates: { fang: { userId: "fang", displayName: "方", status: "completed" } } })]} users={[]} open selectedInstructionId="instruction-1" onClose={vi.fn()} notify={vi.fn()} />);
    const details = screen.getByText("回复与聊天").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const input = await screen.findByRole("textbox", { name: "消息" });
    fireEvent.change(input, { target: { value: "追加確認です" } });
    fireEvent.click(screen.getByRole("button", { name: "发送回复" }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(apiMocks.sendInstructionMessage).toHaveBeenCalledWith(expect.objectContaining({ instructionId: "instruction-1", recipientId: "fang", body: "追加確認です" }));
    expect(apiMocks.completePresidentInstruction).not.toHaveBeenCalled();
    expect(apiMocks.acknowledgePresidentInstruction).not.toHaveBeenCalled();
  });

  it("sorts newest first regardless of urgency or due date without changing the source order", () => {
    const instructions = [
      row({ id: "old-urgent", priority: "urgent", dueDate: "2026-08-01", createdAt: Timestamp.fromMillis(1) }),
      row({ id: "latest-normal", createdAt: Timestamp.fromMillis(3) }),
      row({ id: "older-normal", dueDate: "2026-08-02", createdAt: Timestamp.fromMillis(2) })
    ];
    expect(sortPresidentInstructions(instructions).map((item) => item.id)).toEqual(["latest-normal", "older-normal", "old-urgent"]);
    expect(instructions.map((item) => item.id)).toEqual(["old-urgent", "latest-normal", "older-normal"]);
  });

  it("shows the highest-priority untranslated state as a global alert until acknowledged", () => {
    const open = vi.fn();
    render(<InstructionBanner instructions={[
      row({ createdAt: Timestamp.fromMillis(3) }),
      row({ id: "urgent-later", priority: "urgent", dueDate: "2026-08-10", titleZh: "稍后确认", createdAt: Timestamp.fromMillis(2) }),
      row({ id: "urgent", priority: "urgent", dueDate: "2026-08-01", titleZh: "紧急确认", createdAt: Timestamp.fromMillis(1) })
    ]} onOpen={open} />);
    expect(screen.getByRole("alert")).toHaveTextContent("来自社長的未确认通知 3条");
    expect(screen.getByRole("alert")).toHaveTextContent("紧急确认");
    fireEvent.click(screen.getByRole("button", { name: "立即确认" }));
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("urgent");
    expect(apiMocks.acknowledgePresidentInstruction).not.toHaveBeenCalled();
  });

  it("opens in reading mode with the newest announcement first even when it is completed", () => {
    render(<InstructionCenter instructions={[
      row({ id: "old-urgent", titleZh: "以前的紧急通知", priority: "urgent", dueDate: "2026-08-01", createdAt: Timestamp.fromMillis(1) }),
      row({ id: "latest", titleZh: "最新的已完成通知", status: "completed", createdAt: Timestamp.fromMillis(3) }),
      row({ id: "middle", titleZh: "较新的通知", createdAt: Timestamp.fromMillis(2) }),
      row({ id: "unrelated", titleZh: "其他人的通知", recipientIds: ["someone-else"], recipientStates: {}, createdAt: Timestamp.fromMillis(4) })
    ]} users={[]} open onClose={vi.fn()} notify={vi.fn()} />);

    expect(screen.getByRole("button", { name: "浏览" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("heading", { name: "发布新通知" })).not.toBeInTheDocument();
    expectAnnouncementOrder(["最新的已完成通知", "较新的通知", "以前的紧急通知"]);

    fireEvent.click(screen.getByRole("button", { name: "处理中" }));
    expectAnnouncementOrder(["较新的通知", "以前的紧急通知"]);
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "最新的已完成通知" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("allows only the recipient flow from pending to acknowledged", async () => {
    render(<InstructionCenter instructions={[row()]} users={[]} open onClose={vi.fn()} notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "我已确认内容" }));
    await waitFor(() => expect(apiMocks.acknowledgePresidentInstruction).toHaveBeenCalledWith("instruction-1"));
  });

  it("expands pending received announcements and collapses confirmed, closed, and authored-only announcements", () => {
    render(<InstructionCenter instructions={[
      row({ id: "pending", titleZh: "未读通知" }),
      row({ id: "confirmed", titleZh: "已读通知", recipientStates: { fang: { userId: "fang", displayName: "方", status: "acknowledged" } } }),
      row({ id: "recipient-completed", titleZh: "个人已完成通知", recipientStates: { fang: { userId: "fang", displayName: "方", status: "completed" } } }),
      row({ id: "completed", titleZh: "结束的通知", status: "completed" }),
      row({ id: "cancelled", titleZh: "取消的通知", status: "cancelled" }),
      row({ id: "sent", titleZh: "发出的通知", authorId: "fang", recipientIds: ["manager"], recipientStates: { manager: { userId: "manager", displayName: "管理担当", status: "pending" } } })
    ]} users={[]} open onClose={vi.fn()} notify={vi.fn()} />);

    expect(announcementToggle("未读通知")).toHaveAttribute("aria-expanded", "true");
    for (const title of ["已读通知", "个人已完成通知", "结束的通知", "取消的通知", "发出的通知"]) {
      const toggle = announcementToggle(title);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(document.getElementById(toggle.getAttribute("aria-controls")!)).not.toBeVisible();
    }
    expect(screen.getAllByRole("button", { name: "我已确认内容" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "完成处理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消并重新发布" })).not.toBeInTheDocument();
    expect(apiMocks.acknowledgePresidentInstruction).not.toHaveBeenCalled();
  });

  it("allows unread content to be collapsed without confirming it and preserves the choice during updates", () => {
    const props = { users: [], open: true, onClose: vi.fn(), notify: vi.fn() };
    const { rerender } = render(<InstructionCenter {...props} instructions={[row()]} />);
    const toggle = announcementToggle();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "我已确认内容" })).not.toBeInTheDocument();
    rerender(<InstructionCenter {...props} instructions={[row({ updatedAt: Timestamp.fromMillis(20) })]} />);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "未确认 1" })).toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("中文正文")).toBeVisible();
    expect(screen.getByRole("button", { name: "我已确认内容" })).toBeEnabled();
    expect(apiMocks.acknowledgePresidentInstruction).not.toHaveBeenCalled();
  });

  it.each([false, true])("collapses after the saved acknowledgement arrives and can reopen to complete it (selected: %s)", async (selected) => {
    const props = { users: [], open: true, onClose: vi.fn(), notify: vi.fn(), selectedInstructionId: selected ? "instruction-1" : undefined };
    const { rerender } = render(<InstructionCenter {...props} instructions={[row()]} />);
    let finishAcknowledgement!: () => void;
    apiMocks.acknowledgePresidentInstruction.mockImplementationOnce(() => new Promise<void>((resolve) => { finishAcknowledgement = resolve; }));

    fireEvent.click(screen.getByRole("button", { name: "我已确认内容" }));
    expect(screen.getByRole("button", { name: "我已确认内容" })).toBeDisabled();
    expect(announcementToggle()).toHaveAttribute("aria-expanded", "true");
    await act(async () => { finishAcknowledgement(); });
    expect(apiMocks.acknowledgePresidentInstruction).toHaveBeenCalledWith("instruction-1");
    expect(announcementToggle()).toHaveAttribute("aria-expanded", "true");

    const acknowledged = row({ recipientStates: { fang: { userId: "fang", displayName: "方", status: "acknowledged", acknowledgedAt: Timestamp.fromMillis(10) } } });
    rerender(<InstructionCenter {...props} instructions={[acknowledged]} />);
    expect(announcementToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "未确认 0" })).toBeVisible();
    expect(screen.getByRole("button", { name: "已确认 1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "完成处理" })).not.toBeInTheDocument();

    fireEvent.click(announcementToggle());
    fireEvent.change(screen.getByRole("textbox", { name: "完成备注（可选）" }), { target: { value: "  已完成安排  " } });
    fireEvent.click(announcementToggle());
    fireEvent.click(announcementToggle());
    expect(screen.getByRole("textbox", { name: "完成备注（可选）" })).toHaveValue("  已完成安排  ");
    fireEvent.click(screen.getByRole("button", { name: "完成处理" }));
    await waitFor(() => expect(apiMocks.completePresidentInstruction).toHaveBeenCalledWith("instruction-1", "已完成安排"));
    expect(apiMocks.acknowledgePresidentInstruction).toHaveBeenCalledOnce();
  });

  it("expands an explicitly selected confirmed announcement, preserves manual collapse, and opens it again on reopening", () => {
    const instructions = [row({ recipientStates: { fang: { userId: "fang", displayName: "方", status: "acknowledged" } } })];
    const props = { instructions, users: [], onClose: vi.fn(), notify: vi.fn(), selectedInstructionId: "instruction-1" };
    const { rerender } = render(<InstructionCenter {...props} open />);

    expect(announcementToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "完成处理" })).toBeVisible();
    fireEvent.click(announcementToggle());
    rerender(<InstructionCenter {...props} instructions={[{ ...instructions[0], updatedAt: Timestamp.fromMillis(20) }]} open />);
    expect(announcementToggle()).toHaveAttribute("aria-expanded", "false");
    rerender(<InstructionCenter {...props} open={false} />);
    rerender(<InstructionCenter {...props} open />);

    expect(announcementToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "完成处理" })).toBeVisible();
    expect(apiMocks.acknowledgePresidentInstruction).not.toHaveBeenCalled();
  });

  it("restores unread expansion and confirmed collapse when the center is reopened", () => {
    const props = { instructions: [
      row({ id: "pending", titleZh: "未读通知" }),
      row({ id: "confirmed", titleZh: "已读通知", recipientStates: { fang: { userId: "fang", displayName: "方", status: "acknowledged" } } })
    ], users: [], onClose: vi.fn(), notify: vi.fn() };
    const { rerender } = render(<InstructionCenter {...props} open />);
    fireEvent.click(announcementToggle("未读通知"));
    fireEvent.click(announcementToggle("已读通知"));
    rerender(<InstructionCenter {...props} open={false} />);
    rerender(<InstructionCenter {...props} open />);

    expect(announcementToggle("未读通知")).toHaveAttribute("aria-expanded", "true");
    expect(announcementToggle("已读通知")).toHaveAttribute("aria-expanded", "false");
    expect(apiMocks.acknowledgePresidentInstruction).not.toHaveBeenCalled();
  });

  it("keeps a collapsed announcement's summary visible and its hidden controls out of the dialog focus loop", async () => {
    const createdAt = Timestamp.fromDate(new Date("2026-09-15T10:00:00Z"));
    render(<InstructionCenter instructions={[row({
      createdAt, dueDate: "2026-10-01",
      recipientStates: { fang: { userId: "fang", displayName: "方", status: "acknowledged" } },
      attachments: [{ id: "document", name: "確認資料.pdf", contentType: "application/pdf", size: 2048, storagePath: "president-instructions/instruction-1/president/file.pdf" }]
    })]} users={[]} open onClose={vi.fn()} notify={vi.fn()} />);

    const card = screen.getByRole("article");
    expect(announcementToggle()).toHaveAttribute("aria-expanded", "false");
    expect(within(card).getByText("发布：社長")).toBeVisible();
    expect(within(card).getByText("截止 2026-10-01")).toBeVisible();
    expect(within(card).getByText(createdAt.toDate().toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }))).toBeVisible();
    expect(within(card).getAllByText("已确认").some((element) => !element.closest("[hidden]"))).toBe(true);
    expect(within(card).getAllByText(/附件.*1/).some((element) => !element.closest("[hidden]"))).toBe(true);
    expect(screen.queryByRole("textbox", { name: "完成备注（可选）" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /確認資料.pdf/ })).not.toBeInTheDocument();

    const close = screen.getByRole("button", { name: "关闭" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(announcementToggle()).toHaveFocus();
    fireEvent.keyDown(announcementToggle(), { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.click(announcementToggle());
    expect(await screen.findByRole("link", { name: /確認資料.pdf/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "完成处理" })).toBeVisible();
  });

  it("prioritizes and focuses the selected announcement without marking it confirmed", () => {
    render(<InstructionCenter instructions={[
      row({ id: "latest", titleZh: "最新通知", createdAt: Timestamp.fromMillis(3) }),
      row({ id: "selected", titleZh: "提醒的通知", createdAt: Timestamp.fromMillis(1) }),
      row({ id: "middle", titleZh: "较新通知", createdAt: Timestamp.fromMillis(2) })
    ]} users={[]} open selectedInstructionId="selected" onClose={vi.fn()} notify={vi.fn()} />);

    const cards = screen.getAllByRole("article");
    expectAnnouncementOrder(["提醒的通知", "最新通知", "较新通知"]);
    expect(cards[0]).toHaveFocus();
    fireEvent.click(within(cards[0]).getByText("查看日语原文"));
    expect(apiMocks.acknowledgePresidentInstruction).not.toHaveBeenCalled();
    expect(within(cards[0]).getByRole("button", { name: "我已确认内容" })).toBeEnabled();
  });

  it("filters received pending announcements separately from announcements the user sent", () => {
    render(<InstructionCenter instructions={[
      row({ id: "pending", titleZh: "待确认通知" }),
      row({ id: "confirmed", titleZh: "已确认的通知", recipientStates: { fang: { userId: "fang", displayName: "方", status: "acknowledged" } } }),
      row({ id: "cancelled", titleZh: "已取消的通知", status: "cancelled" }),
      row({ id: "completed", titleZh: "已完成的通知", status: "completed" }),
      row({ id: "sent", titleZh: "自己发布的通知", authorId: "fang", recipientIds: ["manager"], recipientStates: { manager: { userId: "manager", displayName: "管理担当", status: "pending" } } })
    ]} users={[]} open onClose={vi.fn()} notify={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "未确认 1" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "待确认通知" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "我发布的" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "自己发布的通知" })).toBeVisible();
    expect(apiMocks.acknowledgePresidentInstruction).not.toHaveBeenCalled();
  });

  it("filters confirmed received announcements across active and historical statuses without counting authored-only announcements", () => {
    const acknowledged = { fang: { userId: "fang", displayName: "方", status: "acknowledged" as const } };
    render(<InstructionCenter instructions={[
      row({ id: "pending", titleZh: "待确认通知" }),
      row({ id: "confirmed", titleZh: "已确认处理中", recipientStates: acknowledged, createdAt: Timestamp.fromMillis(5) }),
      row({ id: "recipient-completed", titleZh: "个人处理完成", recipientStates: { fang: { userId: "fang", displayName: "方", status: "completed" } }, createdAt: Timestamp.fromMillis(4) }),
      row({ id: "completed", titleZh: "全体处理完成", status: "completed", recipientStates: acknowledged, createdAt: Timestamp.fromMillis(3) }),
      row({ id: "cancelled-confirmed", titleZh: "确认后取消", status: "cancelled", recipientStates: acknowledged, createdAt: Timestamp.fromMillis(2) }),
      row({ id: "cancelled-unread", titleZh: "未确认就取消", status: "cancelled" }),
      row({ id: "sent", titleZh: "自己发布的通知", authorId: "fang", recipientIds: ["manager"], recipientStates: { manager: { userId: "manager", displayName: "管理担当", status: "acknowledged" } } })
    ]} users={[]} open onClose={vi.fn()} notify={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "已确认 4" }));
    expect(screen.getByRole("button", { name: "已确认 4" })).toHaveAttribute("aria-pressed", "true");
    expectAnnouncementOrder(["已确认处理中", "个人处理完成", "全体处理完成", "确认后取消"]);
    expect(screen.queryByRole("heading", { name: "自己发布的通知" })).not.toBeInTheDocument();
    expect(apiMocks.acknowledgePresidentInstruction).not.toHaveBeenCalled();
  });

  it("keeps an acknowledgement available and reports the error when saving it fails", async () => {
    const notify = vi.fn();
    apiMocks.acknowledgePresidentInstruction.mockRejectedValueOnce(new Error("无法保存确认状态"));
    render(<InstructionCenter instructions={[row()]} users={[]} open onClose={vi.fn()} notify={notify} />);
    expect(apiMocks.acknowledgePresidentInstruction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "我已确认内容" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("error", "无法保存确认状态"));
    expect(announcementToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("中文正文")).toBeVisible();
    expect(screen.getByRole("button", { name: "我已确认内容" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "完成处理" })).not.toBeInTheDocument();
  });

  it("counts only unconfirmed announcements in the shortcut badge", () => {
    const confirmed = row({ id: "confirmed", recipientStates: { fang: { userId: "fang", displayName: "方", status: "acknowledged" } } });
    const props = { onOpen: vi.fn() };
    const { rerender } = render(<InstructionShortcut {...props} instructions={[row(), confirmed, row({ id: "cancelled", status: "cancelled" }), row({ id: "completed", status: "completed" })]} />);

    expect(screen.getByRole("button", { name: "通知，1条未确认" })).toHaveTextContent("1");
    rerender(<InstructionShortcut {...props} instructions={[confirmed]} />);
    const shortcut = screen.getByRole("button", { name: "通知，0条未确认" });
    expect(shortcut).toHaveTextContent(/^通知$/);
    fireEvent.click(shortcut);
    expect(props.onOpen).toHaveBeenCalledOnce();
  });

  it("lets an author manage their own announcement", () => {
    authState.profile = { uid: "manager", displayName: "管理担当", role: "employee_manager", locale: "zh-CN", active: true };
    const managerInstruction = row({
      id: "manager-instruction",
      authorId: "manager",
      authorName: "管理担当",
      authorRole: "employee_manager",
      recipientIds: ["fang"],
      recipientStates: { fang: { userId: "fang", displayName: "方", status: "pending" } }
    });

    render(<InstructionCenter instructions={[managerInstruction]} users={[]} open onClose={vi.fn()} notify={vi.fn()} />);

    expect(screen.getByText("发布：管理担当")).toBeInTheDocument();
    expect(announcementToggle()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(announcementToggle());
    expect(screen.getByRole("button", { name: "取消并重新发布" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(screen.getByRole("heading", { name: "发布新通知" })).toBeInTheDocument();
    expect(screen.getByText(/所有员工都可以发布通知/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "取消并重新发布" })).not.toBeInTheDocument();
  });

  it("shows the author who confirmed and retains confirmation and completion times", () => {
    authState.profile = { ...employeeProfile, uid: "president" };
    const acknowledgedAt = Timestamp.fromDate(new Date("2026-09-15T10:00:00Z"));
    const completedAt = Timestamp.fromDate(new Date("2026-09-16T11:00:00Z"));
    render(<InstructionCenter instructions={[row({
      recipientIds: ["fang", "manager", "worker"],
      recipientStates: {
        fang: { userId: "fang", displayName: "方", status: "pending" },
        manager: { userId: "manager", displayName: "管理担当", status: "acknowledged", acknowledgedAt },
        worker: { userId: "worker", displayName: "担当者", status: "completed", acknowledgedAt, completedAt, completionNote: "已完成安排" }
      }
    })]} users={[]} open onClose={vi.fn()} notify={vi.fn()} />);

    fireEvent.click(announcementToggle());
    const progress = screen.getByRole("region", { name: "接收者确认情况" });
    expect(within(progress).getByText("已确认 2 / 3人")).toBeVisible();
    expect(within(progress).getByText("1人未确认")).toBeVisible();
    const completedRecipient = within(progress).getByText("担当者").parentElement!;
    const dateFormat = { dateStyle: "medium", timeStyle: "short" } as const;
    expect(completedRecipient).toHaveTextContent(`内容确认 · ${acknowledgedAt.toDate().toLocaleString("zh-CN", dateFormat)}`);
    expect(completedRecipient).toHaveTextContent(`处理完成 · ${completedAt.toDate().toLocaleString("zh-CN", dateFormat)}`);
    expect(completedRecipient).toHaveTextContent("已完成安排");
    expect(within(progress).getByRole("button", { name: "提醒 1位未确认者" })).toBeEnabled();
  });

  it("reminds unconfirmed recipients, blocks duplicate requests, and reports the delivered count", async () => {
    authState.profile = { ...employeeProfile, uid: "president" };
    const notify = vi.fn();
    let resolveReminder!: (value: { ok: boolean; recipientCount: number }) => void;
    apiMocks.remindPresidentInstruction.mockImplementationOnce(() => new Promise((resolve) => { resolveReminder = resolve; }));
    render(<InstructionCenter instructions={[row()]} users={[]} open onClose={vi.fn()} notify={notify} />);
    fireEvent.click(announcementToggle());
    const reminder = screen.getByRole("button", { name: "提醒 1位未确认者" });

    fireEvent.click(reminder);
    expect(apiMocks.remindPresidentInstruction).toHaveBeenCalledWith("instruction-1");
    expect(reminder).toBeDisabled();
    fireEvent.click(reminder);
    expect(apiMocks.remindPresidentInstruction).toHaveBeenCalledOnce();
    await act(async () => { resolveReminder({ ok: true, recipientCount: 1 }); });

    expect(notify).toHaveBeenCalledWith("success", "已提醒1位未确认者。");
    expect(reminder).toBeDisabled();
    expect(screen.getByText("已发送提醒，5分钟后可再次提醒。")).toBeVisible();
    expect(apiMocks.acknowledgePresidentInstruction).not.toHaveBeenCalled();
  });

  it("reports a reminder failure and allows the author to retry", async () => {
    authState.profile = { ...employeeProfile, uid: "president" };
    const notify = vi.fn();
    apiMocks.remindPresidentInstruction.mockRejectedValueOnce(new Error("提醒发送失败"));
    render(<InstructionCenter instructions={[row()]} users={[]} open onClose={vi.fn()} notify={notify} />);

    fireEvent.click(announcementToggle());
    fireEvent.click(screen.getByRole("button", { name: "提醒 1位未确认者" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("error", "提醒发送失败"));
    expect(screen.getByRole("button", { name: "提醒 1位未确认者" })).toBeEnabled();
    expect(notify).not.toHaveBeenCalledWith("success", expect.any(String));
  });

  it("enforces the five-minute reminder cooldown and enables the button when it expires", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-09-17T03:00:00Z");
    vi.setSystemTime(now);
    authState.profile = { ...employeeProfile, uid: "president" };
    render(<InstructionCenter instructions={[row({ lastReminderAt: Timestamp.fromMillis(now.getTime() - 4 * 60 * 1000) })]} users={[]} open onClose={vi.fn()} notify={vi.fn()} />);
    fireEvent.click(announcementToggle());
    const reminder = screen.getByRole("button", { name: "提醒 1位未确认者" });

    expect(reminder).toBeDisabled();
    fireEvent.click(reminder);
    expect(apiMocks.remindPresidentInstruction).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
    expect(reminder).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(101); });
    expect(reminder).toBeEnabled();
  });

  it.each([
    { scenario: "the viewer is a recipient", authorId: "president", status: "active", recipientStatus: "pending" },
    { scenario: "all recipients have confirmed", authorId: "fang", status: "active", recipientStatus: "acknowledged" },
    { scenario: "all recipients have completed", authorId: "fang", status: "active", recipientStatus: "completed" },
    { scenario: "the announcement is cancelled", authorId: "fang", status: "cancelled", recipientStatus: "pending" },
    { scenario: "the announcement is completed", authorId: "fang", status: "completed", recipientStatus: "pending" }
  ] as const)("does not offer reminders when $scenario", ({ authorId, status, recipientStatus }) => {
    render(<InstructionCenter instructions={[row({ authorId, status, recipientStates: { fang: { userId: "fang", displayName: "方", status: recipientStatus } } })]} users={[]} open onClose={vi.fn()} notify={vi.fn()} />);
    if (announcementToggle().getAttribute("aria-expanded") === "false") fireEvent.click(announcementToggle());

    expect(screen.queryByRole("button", { name: /提醒 \d+位未确认者/ })).not.toBeInTheDocument();
    expect(apiMocks.remindPresidentInstruction).not.toHaveBeenCalled();
  });

  it("offers the Japanese confirmation filters, summary, and reminder action", async () => {
    i18nState.locale = "ja";
    authState.profile = { ...employeeProfile, uid: "president", locale: "ja" };
    const notify = vi.fn();
    render(<InstructionCenter instructions={[row()]} users={[]} open onClose={vi.fn()} notify={notify} />);

    expect(screen.getByRole("button", { name: "未確認 0" })).toBeVisible();
    expect(screen.getByRole("button", { name: "確認済み 0" })).toBeVisible();
    expect(screen.getByRole("button", { name: "発信したお知らせ" })).toBeVisible();
    fireEvent.click(announcementToggle("日本語件名"));
    expect(screen.getByText("確認済み 0 / 1人")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "未確認の 1人に再通知" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("success", "未確認の1人に再通知しました。"));
  });

  it("uploads an attached document and includes it in a new instruction", async () => {
    authState.profile = { uid: "fang", displayName: "方", role: "employee", locale: "zh-CN", active: true };
    const attachment = { id: "72211f85-20e7-4d40-9c96-2df2248fe67a", name: "指示资料.pdf", contentType: "application/pdf", size: 8, storagePath: "president-instructions/draft/manager/file.pdf" };
    apiMocks.uploadPresidentInstructionFiles.mockResolvedValueOnce([attachment]);
    apiMocks.createPresidentInstruction.mockResolvedValueOnce({ id: "created", translationStatus: "completed" });
    const file = new File(["%PDF-1.4"], "指示资料.pdf", { type: "application/pdf" });

    render(<InstructionCenter instructions={[]} users={[{ uid: "fang", displayName: "方", role: "employee", active: true }, { uid: "manager", displayName: "管理担当", role: "employee_manager", active: true }]} open onClose={vi.fn()} notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    fireEvent.click(screen.getByRole("button", { name: "管理担当" }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "资料确认" } });
    fireEvent.change(screen.getByRole("textbox", { name: "通知内容" }), { target: { value: "请确认附件" } });
    fireEvent.change(screen.getByLabelText("选择文件"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "发布通知" }));

    await waitFor(() => expect(apiMocks.uploadPresidentInstructionFiles).toHaveBeenCalledOnce());
    const instructionId = apiMocks.uploadPresidentInstructionFiles.mock.calls[0][1];
    expect(apiMocks.uploadPresidentInstructionFiles).toHaveBeenCalledWith(authState.profile, instructionId, [file], [], expect.objectContaining({ onUploaded: expect.any(Function), onProgress: expect.any(Function) }));
    await waitFor(() => expect(apiMocks.createPresidentInstruction).toHaveBeenCalledWith(expect.objectContaining({
      instructionId,
      title: "资料确认",
      body: "请确认附件",
      recipientIds: ["manager"],
      attachments: [attachment]
    })));
    await waitFor(() => expect(screen.getByRole("button", { name: "浏览" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("heading", { name: "发布新通知" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("");
  });

  it("preserves the draft and selected attachment when switching between reading and posting", async () => {
    const file = new File(["%PDF-1.4"], "草稿附件.pdf", { type: "application/pdf" });
    apiMocks.uploadPresidentInstructionFiles.mockResolvedValueOnce([]);
    apiMocks.createPresidentInstruction.mockResolvedValueOnce({ id: "created", translationStatus: "completed" });
    render(<InstructionCenter instructions={[row()]} users={[{ uid: "manager", displayName: "管理担当", role: "employee_manager", active: true }]} open onClose={vi.fn()} notify={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    fireEvent.click(screen.getByRole("button", { name: "管理担当" }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "草稿标题" } });
    fireEvent.change(screen.getByRole("textbox", { name: "通知内容" }), { target: { value: "草稿正文" } });
    fireEvent.change(screen.getByLabelText("选择文件"), { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: "浏览" }));
    expect(screen.getByRole("heading", { name: "中文标题" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "标题" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("草稿标题");
    expect(screen.getByRole("textbox", { name: "通知内容" })).toHaveValue("草稿正文");
    expect(screen.getByText("草稿附件.pdf")).toBeVisible();
    expect(screen.getByRole("button", { name: "发布通知" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "发布通知" }));
    await waitFor(() => expect(apiMocks.uploadPresidentInstructionFiles).toHaveBeenCalledWith(authState.profile, expect.any(String), [file], [], expect.objectContaining({ onUploaded: expect.any(Function), onProgress: expect.any(Function) })));
    await waitFor(() => expect(apiMocks.createPresidentInstruction).toHaveBeenCalledWith(expect.objectContaining({ title: "草稿标题", body: "草稿正文", recipientIds: ["manager"] })));
  });

  it("keeps the posting mode and draft when publishing fails", async () => {
    const notify = vi.fn();
    apiMocks.createPresidentInstruction.mockRejectedValueOnce(new Error("送信できませんでした"));
    render(<InstructionCenter instructions={[]} users={[{ uid: "manager", displayName: "管理担当", role: "employee_manager", active: true }]} open onClose={vi.fn()} notify={notify} />);
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    fireEvent.click(screen.getByRole("button", { name: "管理担当" }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "保留的标题" } });
    fireEvent.change(screen.getByRole("textbox", { name: "通知内容" }), { target: { value: "保留的正文" } });
    fireEvent.click(screen.getByRole("button", { name: "发布通知" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("error", "送信できませんでした"));
    expect(screen.getByRole("button", { name: "发布" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("保留的标题");
    expect(screen.getByRole("textbox", { name: "通知内容" })).toHaveValue("保留的正文");
    expect(screen.getByRole("button", { name: "发布通知" })).toBeEnabled();
  });

  it("returns to all announcements in reading mode when the center is reopened", () => {
    const props = { instructions: [row()], users: [], onClose: vi.fn(), notify: vi.fn() };
    const { rerender } = render(<InstructionCenter {...props} open />);
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    rerender(<InstructionCenter {...props} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<InstructionCenter {...props} open />);

    expect(screen.getByRole("button", { name: "浏览" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "中文标题" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "发布新通知" })).not.toBeInTheDocument();
  });

  it("uploads three PDFs, shows progress, and prevents edits or duplicate submissions until publishing finishes", async () => {
    let finishUpload!: (attachments: typeof catalogAttachments) => void;
    let finishCreate!: (result: { id: string; translationStatus: string }) => void;
    let uploadOptions!: InstructionFileUploadOptions;
    apiMocks.uploadPresidentInstructionFiles.mockImplementationOnce((_profile, _id, _files, _existing, options) => {
      uploadOptions = options;
      options.onProgress(1, 3);
      return new Promise((resolve) => { finishUpload = resolve; });
    });
    apiMocks.createPresidentInstruction.mockImplementationOnce(() => new Promise((resolve) => { finishCreate = resolve; }));
    const { container, notify } = renderCatalogComposer();
    const form = container.querySelector("form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(apiMocks.uploadPresidentInstructionFiles).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("正在上传附件 (1/3)");
    for (const control of form.querySelectorAll("input, textarea, select, button")) expect(control).toBeDisabled();
    act(() => {
      uploadOptions.onUploaded!(catalogAttachments[0]);
      uploadOptions.onProgress!(2, 3);
    });
    expect(screen.getByRole("status")).toHaveTextContent("正在上传附件 (2/3)");
    await act(async () => {
      uploadOptions.onUploaded!(catalogAttachments[1]);
      uploadOptions.onUploaded!(catalogAttachments[2]);
      finishUpload(catalogAttachments);
    });

    expect(screen.getByRole("status")).toHaveTextContent("正在发布通知");
    expect(apiMocks.createPresidentInstruction).toHaveBeenCalledWith(expect.objectContaining({ attachments: catalogAttachments }));
    for (const control of form.querySelectorAll("input, textarea, select, button")) expect(control).toBeDisabled();
    await act(async () => finishCreate({ id: "created", translationStatus: "completed" }));

    expect(notify).toHaveBeenCalledWith("success", "通知已发布。");
    expect(screen.getByRole("button", { name: "浏览" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("");
    expect(screen.queryByText(catalogFiles[0].name)).not.toBeInTheDocument();
  });

  it("retains the draft and successful attachment after interruption and retries only the remaining PDFs", async () => {
    apiMocks.uploadPresidentInstructionFiles
      .mockImplementationOnce(async (_profile, _id, _files, _existing, options: InstructionFileUploadOptions) => {
        options.onUploaded!(catalogAttachments[0]);
        throw new Error("upload interrupted");
      })
      .mockImplementationOnce(async (_profile, _id, _files, _existing, options: InstructionFileUploadOptions) => {
        catalogAttachments.slice(1).forEach((attachment) => options.onUploaded!(attachment));
        return catalogAttachments.slice(1);
      });
    apiMocks.createPresidentInstruction.mockResolvedValueOnce({ id: "created", translationStatus: "completed" });
    const { notify } = renderCatalogComposer();

    fireEvent.click(screen.getByRole("button", { name: "发布通知" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("upload interrupted");
    expect(notify).toHaveBeenCalledWith("error", "upload interrupted");
    expect(screen.getByRole("textbox", { name: "通知内容" })).toHaveValue("请确认三个附件");
    catalogFiles.forEach((file) => expect(screen.getAllByText(file.name)).toHaveLength(1));
    expect(apiMocks.createPresidentInstruction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "发布通知" }));

    await waitFor(() => expect(apiMocks.createPresidentInstruction).toHaveBeenCalledOnce());
    const instructionId = apiMocks.uploadPresidentInstructionFiles.mock.calls[0][1];
    expect(apiMocks.uploadPresidentInstructionFiles.mock.calls[1]).toEqual([
      authState.profile, instructionId, catalogFiles.slice(1), [catalogAttachments[0]], expect.any(Object)
    ]);
    expect(apiMocks.createPresidentInstruction).toHaveBeenCalledWith(expect.objectContaining({ instructionId, attachments: catalogAttachments }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps all PDFs and the draft visible when security preparation rejects the upload", async () => {
    apiMocks.uploadPresidentInstructionFiles.mockRejectedValueOnce(Object.assign(new Error("Requests throttled due to previous 403 error"), { code: "appCheck/throttled" }));
    const { notify } = renderCatalogComposer();

    fireEvent.click(screen.getByRole("button", { name: "发布通知" }));

    const alert = await screen.findByRole("alert");
    expect(notify).toHaveBeenCalledWith("error", alert.textContent);
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("资料确认");
    expect(screen.getByRole("textbox", { name: "通知内容" })).toHaveValue("请确认三个附件");
    catalogFiles.forEach((file) => expect(screen.getAllByText(file.name)).toHaveLength(1));
    expect(screen.getByRole("button", { name: "发布通知" })).toBeEnabled();
    expect(apiMocks.createPresidentInstruction).not.toHaveBeenCalled();
  });

  it("reuses uploaded attachments and the instruction ID when publishing fails", async () => {
    apiMocks.uploadPresidentInstructionFiles.mockImplementationOnce(async (_profile, _id, _files, _existing, options: InstructionFileUploadOptions) => {
      catalogAttachments.forEach((attachment) => options.onUploaded!(attachment));
      return catalogAttachments;
    });
    apiMocks.createPresidentInstruction
      .mockRejectedValueOnce(new Error("publish interrupted"))
      .mockResolvedValueOnce({ id: "created", translationStatus: "completed" });
    renderCatalogComposer();

    fireEvent.click(screen.getByRole("button", { name: "发布通知" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("publish interrupted");
    catalogFiles.forEach((file) => expect(screen.getAllByText(file.name)).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "发布通知" }));

    await waitFor(() => expect(apiMocks.createPresidentInstruction).toHaveBeenCalledTimes(2));
    expect(apiMocks.uploadPresidentInstructionFiles).toHaveBeenCalledOnce();
    expect(apiMocks.createPresidentInstruction.mock.calls[0]).toEqual(apiMocks.createPresidentInstruction.mock.calls[1]);
  });

  it("shows published attachments in the instruction card", async () => {
    const attachment = { id: "72211f85-20e7-4d40-9c96-2df2248fe67a", name: "確認資料.pdf", contentType: "application/pdf", size: 2048, storagePath: "president-instructions/instruction-1/president/file.pdf" };
    render(<InstructionCenter instructions={[row({ attachments: [attachment] })]} users={[]} open onClose={vi.fn()} notify={vi.fn()} />);

    expect(screen.getByText("附件资料 1个")).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: /確認資料.pdf/ });
    expect(link).toHaveAttribute("href", "https://example.com/instruction-file");
  });

  it("does not render the global alert after acknowledgement", () => {
    const acknowledged = row({ recipientStates: { fang: { userId: "fang", displayName: "方", status: "acknowledged" } } });
    const { container } = render(<InstructionBanner instructions={[acknowledged]} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the collapsed home panel in reading mode when there are no active instructions", () => {
    authState.profile = { uid: "manager", displayName: "管理担当", role: "employee_manager", locale: "zh-CN", active: true };
    render(<InstructionHomePanel instructions={[]} users={[]} notify={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: /点击查看最新通知/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "发布新通知" })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "浏览" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("heading", { name: "发布新通知" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(screen.getByRole("heading", { name: "发布新通知" })).toBeInTheDocument();
  });

  it("opens the home panel and shows an attention icon and count when an instruction exists", () => {
    const { container } = render(<InstructionHomePanel instructions={[row()]} users={[]} notify={vi.fn()} />);

    expect(screen.getByRole("button", { name: /有1条通知尚未确认/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("1条")).toHaveTextContent("1");
    expect(container.querySelector(".instruction-accordion-icon.attention")).toBeInTheDocument();
  });

  it("automatically opens the accordion when a new instruction arrives", async () => {
    const { rerender } = render(<InstructionHomePanel instructions={[]} users={[]} notify={vi.fn()} />);
    expect(screen.getByRole("button", { name: /点击查看最新通知/ })).toHaveAttribute("aria-expanded", "false");

    rerender(<InstructionHomePanel instructions={[row()]} users={[]} notify={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /有1条通知尚未确认/ })).toHaveAttribute("aria-expanded", "true"));
  });

  it("clears the home attention count after acknowledgement while keeping the completion flow available", () => {
    const props = { users: [], notify: vi.fn() };
    const { rerender, container } = render(<InstructionHomePanel {...props} instructions={[row()]} />);
    expect(screen.getByLabelText("1条")).toBeInTheDocument();
    rerender(<InstructionHomePanel {...props} instructions={[row({ recipientStates: { fang: { userId: "fang", displayName: "方", status: "acknowledged", acknowledgedAt: Timestamp.now() } } })]} />);
    expect(screen.queryByLabelText("1条")).not.toBeInTheDocument();
    expect(container.querySelector(".instruction-accordion-icon.attention")).not.toBeInTheDocument();
    expect(screen.getByText("有1条已确认的通知正在处理")).toBeInTheDocument();
    expect(announcementToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "完成处理" })).not.toBeInTheDocument();
    fireEvent.click(announcementToggle());
    expect(screen.getByRole("button", { name: "完成处理" })).toBeInTheDocument();
  });
});
