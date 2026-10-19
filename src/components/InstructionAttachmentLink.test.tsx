import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstructionAttachmentLink } from "./InstructionAttachmentLink";
import type { Attachment } from "../types";

const mocks = vi.hoisted(() => ({ url: vi.fn() }));
vi.mock("../services/api", () => ({ presidentInstructionAttachmentUrl: mocks.url }));

const attachment: Attachment = { id: "file-1", name: "確認資料.pdf", contentType: "application/pdf", size: 8, storagePath: "president-instructions/notice/author/file.pdf" };
const fetchMock = vi.fn();
const share = vi.fn();

beforeEach(() => {
  mocks.url.mockReset().mockResolvedValue("https://example.com/file.pdf");
  fetchMock.mockReset().mockResolvedValue({ ok: true, blob: async () => new Blob(["%PDF-1.4"], { type: "application/octet-stream" }) });
  share.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  Object.defineProperty(navigator, "canShare", { configurable: true, value: vi.fn().mockReturnValue(true) });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn().mockReturnValue("blob:local-file") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "canShare");
  Reflect.deleteProperty(navigator, "maxTouchPoints");
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

async function expand(name = /確認資料.pdf.*1KB/) {
  const button = await screen.findByRole("button", { name });
  fireEvent.click(button);
  return button;
}

describe("announcement attachments on iPhone", () => {
  it("downloads only the tapped file and shares it on a separate user gesture without navigating to Firebase", async () => {
    render(<InstructionAttachmentLink attachment={attachment} locale="ja" />);
    expect(fetchMock).not.toHaveBeenCalled();
    await expand();
    const open = await screen.findByRole("button", { name: "書類を開く・保存" });
    expect(share).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/file.pdf", expect.objectContaining({ credentials: "omit", cache: "no-store", signal: expect.any(AbortSignal) }));
    fireEvent.click(open);
    // Synchronous invocation is required by iOS: no download await before sharing.
    expect(share).toHaveBeenCalledOnce();
    const file = share.mock.calls[0][0].files[0] as File;
    expect(file.name).toBe("確認資料.pdf");
    expect(file.type).toBe("application/pdf");
    expect(file.size).toBe(8);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    await waitFor(() => expect(open).toBeEnabled());
  });

  it("also detects iPadOS with a desktop user agent", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
    render(<InstructionAttachmentLink attachment={attachment} locale="ja" />);
    await expand();
    expect(await screen.findByRole("button", { name: "書類を開く・保存" })).toBeEnabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps desktop file links and avoids downloading file contents", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("desktop Chrome");
    render(<InstructionAttachmentLink attachment={attachment} locale="ja" />);
    expect(await screen.findByRole("link", { name: /確認資料.pdf/ })).toHaveAttribute("href", "https://example.com/file.pdf");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["確認資料.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["確認資料.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["確認資料.jpg", "image/jpeg"]
  ])("preserves the filename and type for %s", async (name, contentType) => {
    render(<InstructionAttachmentLink attachment={{ ...attachment, name, contentType, downloadUrl: "https://example.com/file" }} locale="zh-CN" />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
    const open = await screen.findByRole("button", { name: "打开或保存文件" });
    fireEvent.click(open);
    const file = share.mock.calls[0][0].files[0] as File;
    expect(file.name).toBe(name);
    expect(file.type).toBe(contentType);
    if (contentType === "image/jpeg") expect(screen.getByRole("img")).toHaveAttribute("src", "blob:local-file");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await waitFor(() => expect(open).toBeEnabled());
  });

  it("offers a retry after a failed URL lookup", async () => {
    mocks.url.mockRejectedValueOnce(new Error("offline"));
    render(<InstructionAttachmentLink attachment={attachment} locale="ja" />);
    fireEvent.click(await screen.findByRole("button", { name: /読み込みを再試行/ }));
    await expand();
    expect(await screen.findByRole("button", { name: "書類を開く・保存" })).toBeEnabled();
    expect(mocks.url).toHaveBeenCalledTimes(2);
  });

  it("stops an endless URL lookup and ignores a late response after retry", async () => {
    vi.useFakeTimers();
    let resolveOld!: (url: string) => void;
    mocks.url.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveOld = resolve; }));
    render(<InstructionAttachmentLink attachment={attachment} locale="ja" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /読み込みを再試行/ })); });
    await act(async () => { resolveOld("https://example.com/stale"); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /確認資料.pdf.*1KB/ })); });
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.com/file.pdf");
  });

  it("shows download errors and retries in place", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    render(<InstructionAttachmentLink attachment={attachment} locale="ja" />);
    await expand();
    expect(await screen.findByRole("alert")).toHaveTextContent("書類を読み込めませんでした");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByRole("button", { name: "書類を開く・保存" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a stuck file download after 30 seconds", async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<InstructionAttachmentLink attachment={{ ...attachment, downloadUrl: "https://example.com/file.pdf" }} locale="ja" />);
    fireEvent.click(screen.getByRole("button", { name: /確認資料.pdf/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("書類を読み込めませんでした");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    { ok: false, status: 403 },
    { ok: true, blob: async () => new Blob([]) },
    { ok: true, blob: async () => new Blob(["partial"]) }
  ])("does not present failed or incomplete downloads as usable files", async (response) => {
    fetchMock.mockResolvedValueOnce(response);
    render(<InstructionAttachmentLink attachment={attachment} locale="ja" />);
    await expand();
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByRole("button", { name: "書類を開く・保存" })).not.toBeInTheDocument();
  });

  it("treats cancelling the system menu as normal and allows another attempt", async () => {
    share.mockRejectedValueOnce(new DOMException("cancelled", "AbortError"));
    render(<InstructionAttachmentLink attachment={attachment} locale="ja" />);
    await expand();
    const open = await screen.findByRole("button", { name: "書類を開く・保存" });
    fireEvent.click(open);
    await waitFor(() => expect(open).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(open);
    expect(share).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(open).toBeEnabled());
  });

  it("retries sharing in place without reloading or offering dead navigation links", async () => {
    share.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    render(<InstructionAttachmentLink attachment={attachment} locale="ja" />);
    await expand();
    const open = await screen.findByRole("button", { name: "書類を開く・保存" });
    fireEvent.click(open);
    expect(await screen.findByRole("alert")).toHaveTextContent("メニューを開けませんでした");
    expect(open).toBeEnabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(open);
    expect(share).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(open).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["unsupported", "missing", "throws"])("shows guidance without dead controls when file sharing is %s", async (support) => {
    if (support === "missing") Reflect.deleteProperty(navigator, "canShare");
    else if (support === "throws") vi.mocked(navigator.canShare).mockImplementation(() => { throw new Error("unavailable"); });
    else vi.mocked(navigator.canShare).mockReturnValue(false);
    render(<InstructionAttachmentLink attachment={attachment} locale="ja" />);
    await expand();
    expect(await screen.findByText(/PCのブラウザで書類を開いてください/)).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "書類を開く・保存" })).not.toBeInTheDocument();
  });

  it("releases inline image URLs on close and cancels requests on unmount", async () => {
    const { unmount } = render(<InstructionAttachmentLink attachment={{ ...attachment, name: "写真.jpg", contentType: "image/jpeg" }} locale="ja" />);
    const trigger = await expand(/写真.jpg.*1KB/);
    await screen.findByRole("button", { name: "書類を開く・保存" });
    fireEvent.click(trigger);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-file");
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(trigger);
    unmount();
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
  });

  it("does not restart a download when a live announcement snapshot updates", async () => {
    const { rerender } = render(<InstructionAttachmentLink attachment={attachment} locale="ja" />);
    await expand();
    await screen.findByRole("button", { name: "書類を開く・保存" });
    rerender(<InstructionAttachmentLink attachment={{ ...attachment }} locale="ja" />);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("resets the URL and downloaded file when the attachment changes", async () => {
    const { rerender } = render(<InstructionAttachmentLink attachment={attachment} locale="ja" />);
    await expand();
    await screen.findByRole("button", { name: "書類を開く・保存" });
    rerender(<InstructionAttachmentLink attachment={{ ...attachment, storagePath: "new/path.pdf" }} locale="ja" />);
    expect(screen.queryByRole("button", { name: "書類を開く・保存" })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.url).toHaveBeenCalledWith("new/path.pdf"));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
