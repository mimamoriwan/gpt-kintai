import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstructionBanner, InstructionCenter, InstructionHomePanel, sortPresidentInstructions } from "./PresidentInstructions";
import type { PresidentInstruction } from "../types";

const employeeProfile = { uid: "fang", displayName: "方", role: "employee", locale: "zh-CN", active: true } as const;
const authState = vi.hoisted(() => ({ profile: { uid: "fang", displayName: "方", role: "employee", locale: "zh-CN", active: true } as any }));
const apiMocks = vi.hoisted(() => ({
  acknowledgePresidentInstruction: vi.fn().mockResolvedValue(undefined),
  cancelPresidentInstruction: vi.fn(),
  completePresidentInstruction: vi.fn(),
  createPresidentInstruction: vi.fn(),
  presidentInstructionAttachmentUrl: vi.fn().mockResolvedValue("https://example.com/instruction-file"),
  replacePresidentInstruction: vi.fn(),
  retryPresidentInstructionTranslation: vi.fn(),
  uploadPresidentInstructionFiles: vi.fn()
}));

vi.mock("../auth", () => ({ useAuth: () => authState }));
vi.mock("../i18n", () => ({ useI18n: () => ({ locale: "zh-CN" }) }));
vi.mock("../services/api", () => apiMocks);

function row(overrides: Partial<PresidentInstruction> = {}): PresidentInstruction {
  return {
    id: "instruction-1", authorId: "president", authorName: "社長", titleOriginal: "日本語件名", bodyOriginal: "日本語本文",
    titleZh: "中文标题", bodyZh: "中文正文", translationStatus: "completed", translationAttempts: 1, priority: "normal", dueDate: "",
    recipientIds: ["fang"], recipientStates: { fang: { userId: "fang", displayName: "方", status: "pending" } }, status: "active",
    isDemo: false, createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1), ...overrides
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authState.profile = { ...employeeProfile };
});

describe("president instructions", () => {
  it("sorts urgent instructions before normal ones, then by due date", () => {
    const sorted = sortPresidentInstructions([
      row({ id: "normal", dueDate: "2026-08-01" }),
      row({ id: "urgent-later", priority: "urgent", dueDate: "2026-08-10" }),
      row({ id: "urgent-sooner", priority: "urgent", dueDate: "2026-08-03" })
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["urgent-sooner", "urgent-later", "normal"]);
  });

  it("shows the highest-priority untranslated state as a global alert until acknowledged", () => {
    const open = vi.fn();
    render(<InstructionBanner instructions={[row(), row({ id: "urgent", priority: "urgent", titleZh: "紧急确认" })]} onOpen={open} />);
    expect(screen.getByRole("alert")).toHaveTextContent("来自社長的未确认通知 2条");
    expect(screen.getByRole("alert")).toHaveTextContent("紧急确认");
    fireEvent.click(screen.getByRole("button", { name: "立即确认" }));
    expect(open).toHaveBeenCalledOnce();
  });

  it("allows only the recipient flow from pending to acknowledged", async () => {
    render(<InstructionCenter instructions={[row()]} users={[]} open onClose={vi.fn()} notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "我已确认内容" }));
    await waitFor(() => expect(apiMocks.acknowledgePresidentInstruction).toHaveBeenCalledWith("instruction-1"));
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

    expect(screen.getByRole("heading", { name: "发布新通知" })).toBeInTheDocument();
    expect(screen.getByText(/所有员工都可以发布通知/)).toBeInTheDocument();
    expect(screen.getByText("发布：管理担当")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消并重新发布" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("uploads an attached document and includes it in a new instruction", async () => {
    authState.profile = { uid: "fang", displayName: "方", role: "employee", locale: "zh-CN", active: true };
    const attachment = { id: "72211f85-20e7-4d40-9c96-2df2248fe67a", name: "指示资料.pdf", contentType: "application/pdf", size: 8, storagePath: "president-instructions/draft/manager/file.pdf" };
    apiMocks.uploadPresidentInstructionFiles.mockResolvedValueOnce([attachment]);
    apiMocks.createPresidentInstruction.mockResolvedValueOnce({ id: "created", translationStatus: "completed" });
    const file = new File(["%PDF-1.4"], "指示资料.pdf", { type: "application/pdf" });

    render(<InstructionCenter instructions={[]} users={[{ uid: "fang", displayName: "方", role: "employee", active: true }, { uid: "manager", displayName: "管理担当", role: "employee_manager", active: true }]} open onClose={vi.fn()} notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "管理担当" }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "资料确认" } });
    fireEvent.change(screen.getByRole("textbox", { name: "通知内容" }), { target: { value: "请确认附件" } });
    fireEvent.change(screen.getByLabelText("选择文件"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "发布通知" }));

    await waitFor(() => expect(apiMocks.uploadPresidentInstructionFiles).toHaveBeenCalledOnce());
    const instructionId = apiMocks.uploadPresidentInstructionFiles.mock.calls[0][1];
    expect(apiMocks.uploadPresidentInstructionFiles).toHaveBeenCalledWith(authState.profile, instructionId, [file], []);
    await waitFor(() => expect(apiMocks.createPresidentInstruction).toHaveBeenCalledWith(expect.objectContaining({
      instructionId,
      title: "资料确认",
      body: "请确认附件",
      recipientIds: ["manager"],
      attachments: [attachment]
    })));
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

  it("keeps the home input area collapsed when there are no active instructions", () => {
    authState.profile = { uid: "manager", displayName: "管理担当", role: "employee_manager", locale: "zh-CN", active: true };
    render(<InstructionHomePanel instructions={[]} users={[]} notify={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: /点击展开发布栏和历史记录/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "发布新通知" })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "发布新通知" })).toBeInTheDocument();
  });

  it("opens the home panel and shows an attention icon and count when an instruction exists", () => {
    const { container } = render(<InstructionHomePanel instructions={[row()]} users={[]} notify={vi.fn()} />);

    expect(screen.getByRole("button", { name: /有1条通知尚未处理/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("1条")).toHaveTextContent("1");
    expect(container.querySelector(".instruction-accordion-icon.attention")).toBeInTheDocument();
  });

  it("automatically opens the accordion when a new instruction arrives", async () => {
    const { rerender } = render(<InstructionHomePanel instructions={[]} users={[]} notify={vi.fn()} />);
    expect(screen.getByRole("button", { name: /点击展开发布栏和历史记录/ })).toHaveAttribute("aria-expanded", "false");

    rerender(<InstructionHomePanel instructions={[row()]} users={[]} notify={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /有1条通知尚未处理/ })).toHaveAttribute("aria-expanded", "true"));
  });
});
