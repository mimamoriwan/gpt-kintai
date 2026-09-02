import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportPage } from "./ReportPage";

const apiMocks = vi.hoisted(() => ({
  addWorkLog: vi.fn().mockResolvedValue("work-log-1"),
  generateReportDraft: vi.fn(),
  makeLinkAttachment: vi.fn(),
  removeWorkLog: vi.fn(),
  saveWorkTag: vi.fn(),
  submitReport: vi.fn(),
  updateWorkLog: vi.fn().mockResolvedValue(undefined),
  watchWorkLogs: vi.fn((_userId: string, _date: string, _callback: (rows: unknown[]) => void) => () => undefined),
  watchWorkTags: vi.fn((_userId: string, _callback: (rows: unknown[]) => void) => () => undefined)
}));

vi.mock("../auth", () => ({
  useAuth: () => ({
    profile: {
      uid: "employee-1",
      displayName: "テスト社員",
      email: "employee@example.com",
      role: "employee",
      locale: "ja",
      active: true
    }
  })
}));

vi.mock("../i18n", () => ({
  useI18n: () => ({ locale: "ja", t: (key: string) => key })
}));

vi.mock("../services/api", () => apiMocks);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportPage work log attachments", () => {
  it("keeps files selected in separate browser picker operations", async () => {
    const { container } = render(
      <ReportPage reports={[]} categories={[]} attendance={[]} editing={null} onDone={vi.fn()} notify={vi.fn()} />
    );
    const memo = screen.getByPlaceholderText("今行った仕事を短く入力（複数行可）");
    const fileButton = screen.getByRole("button", { name: "この報告に書類を添付" });
    const addButton = screen.getByRole("button", { name: "報告を追加" });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const firstFile = new File(["quotation"], "quotation.pdf", { type: "application/pdf", lastModified: 1 });
    const secondFile = new File(["minutes"], "minutes.pdf", { type: "application/pdf", lastModified: 2 });

    expect(fileButton.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fileInput).not.toBeNull();
    expect(fileInput).toHaveAttribute("multiple");

    fireEvent.change(memo, { target: { value: "見積書を受領した" } });
    fireEvent.change(fileInput!, { target: { files: [firstFile] } });
    fireEvent.change(fileInput!, { target: { files: [secondFile] } });
    expect(screen.getByText("quotation.pdf")).toBeInTheDocument();
    expect(screen.getByText("minutes.pdf")).toBeInTheDocument();

    fireEvent.click(addButton);

    await waitFor(() => expect(apiMocks.addWorkLog).toHaveBeenCalledWith(
      expect.objectContaining({ text: "見積書を受領した" }),
      expect.objectContaining({ uid: "employee-1" }),
      [firstFile, secondFile],
      []
    ));
  });

  it("edits an existing work report instead of creating a duplicate", async () => {
    const timestamp = {
      toDate: () => new Date("2026-07-25T01:00:00.000Z"),
      toMillis: () => 1
    };
    const existingAttachment = { id: "file-1", name: "既存資料.pdf", contentType: "application/pdf", size: 100, storagePath: "reports/employee-1/work-log-work-log-1/file.pdf", downloadUrl: "https://example.com/file.pdf" };
    apiMocks.watchWorkLogs.mockImplementationOnce((_userId, _date, callback) => {
      callback([{
        id: "work-log-1",
        userId: "employee-1",
        workDate: "2026-07-25",
        tagId: "market_research",
        tagLabel: "市場調査",
        text: "資料を確認した",
        attachments: [existingAttachment],
        createdAt: timestamp,
        updatedAt: timestamp
      }]);
      return () => undefined;
    });

    render(<ReportPage reports={[]} categories={[]} attendance={[]} editing={null} onDone={vi.fn()} notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "編集" }));
    const memo = screen.getByPlaceholderText("今行った仕事を短く入力（複数行可）");
    expect(memo).toHaveValue("資料を確認した");
    expect(screen.getByText("追加済みの報告を編集中です")).toBeInTheDocument();

    fireEvent.change(memo, { target: { value: "資料を確認し、条件を追記した" } });
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));

    await waitFor(() => expect(apiMocks.updateWorkLog).toHaveBeenCalledWith(
      "work-log-1",
      expect.objectContaining({ tagId: "market_research", tagLabel: "市場調査", text: "資料を確認し、条件を追記した" }),
      expect.objectContaining({ uid: "employee-1" }),
      [],
      [existingAttachment]
    ));
    expect(apiMocks.addWorkLog).not.toHaveBeenCalled();
  });

  it("discloses attachment analysis and reports a cached draft without another API generation", async () => {
    const timestamp = {
      toDate: () => new Date("2026-07-25T01:00:00.000Z"),
      toMillis: () => 1
    };
    apiMocks.watchWorkLogs.mockImplementationOnce((_userId, _date, callback) => {
      callback([{
        id: "work-log-1",
        userId: "employee-1",
        workDate: "2026-07-25",
        tagId: "market_research",
        tagLabel: "市場調査",
        text: "資料を確認した",
        attachments: [{ id: "file-1", name: "資料.pdf", contentType: "application/pdf", size: 100, storagePath: "reports/employee-1/work-log-work-log-1/file.pdf" }],
        createdAt: timestamp,
        updatedAt: timestamp
      }]);
      return () => undefined;
    });
    apiMocks.generateReportDraft.mockResolvedValueOnce({
      category: "市場調査",
      area: "",
      destinations: "",
      activities: "【市場調査】資料を確認した。",
      findings: "",
      nextPlan: "",
      aiMeta: {
        cached: true,
        successfulGenerations: 1,
        analyzedAttachmentCount: 1,
        analyzedAttachmentNames: ["資料.pdf"],
        skippedLinkCount: 0
      }
    });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    const notify = vi.fn();

    render(<ReportPage reports={[]} categories={[]} attendance={[]} editing={null} onDone={vi.fn()} notify={notify} />);

    expect(screen.getByText(/保存した添付ファイルは.*OpenAI APIへ送信/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "AIでメモ・添付から日報を作成" }));

    await waitFor(() => expect(apiMocks.generateReportDraft).toHaveBeenCalled());
    expect(await screen.findByText("保存済み下書きを再利用")).toBeInTheDocument();
    expect(screen.getByText(/送信済み：資料.pdf/)).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("success", expect.stringContaining("API再実行なし"));
  });

  it("confirms an automatically created provisional report without a correction reason", async () => {
    const timestamp = {
      toDate: () => new Date("2026-09-01T08:00:00.000Z"),
      toMillis: () => new Date("2026-09-01T08:00:00.000Z").getTime()
    };
    const provisional = {
      id: "auto-report-1",
      userId: "employee-1",
      userName: "テスト社員",
      reportDate: "2026-09-01",
      sourceLanguage: "ja",
      category: "社内業務",
      area: "",
      destinations: "",
      activities: "【社内業務】\n資料を整理した。",
      findings: "",
      nextPlan: "",
      attachments: [],
      status: "provisional",
      creationMethod: "auto_clock_out",
      translationStatus: "not_required",
      translationAttempts: 0,
      reviewStatus: "unreviewed",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    } as const;
    apiMocks.submitReport.mockResolvedValueOnce({ id: provisional.id, translationStatus: "not_required" });

    render(<ReportPage reports={[provisional as never]} categories={[]} attendance={[]} editing={provisional as never} onDone={vi.fn()} notify={vi.fn()} />);

    expect(screen.getByText("自動作成済み・本人未確認")).toBeInTheDocument();
    expect(screen.queryByText("correctionReason")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "内容を確認して正式提出" }));

    await waitFor(() => expect(apiMocks.submitReport).toHaveBeenCalledWith(expect.objectContaining({
      reportId: "auto-report-1",
      correctionReason: undefined
    })));
  });
});
