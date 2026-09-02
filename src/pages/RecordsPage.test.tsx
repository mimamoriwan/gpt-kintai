import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayJst } from "../lib/format";
import type { DailyReport } from "../types";
import { RecordsPage } from "./RecordsPage";

vi.mock("../auth", () => ({
  useAuth: () => ({ profile: { uid: "employee-1", role: "employee", displayName: "方さん", locale: "ja" } })
}));

vi.mock("../i18n", () => ({
  useI18n: () => ({ locale: "ja", t: (key: string) => key })
}));

vi.mock("../services/api", () => ({
  correctAttendance: vi.fn(),
  retryTranslation: vi.fn()
}));

afterEach(cleanup);

describe("RecordsPage report comments", () => {
  it("shows comments from the president to the employee who submitted the report", () => {
    const reportDate = `${todayJst().slice(0, 7)}-01`;
    const createdAt = {
      toDate: () => new Date(`${reportDate}T01:00:00Z`),
      toMillis: () => new Date(`${reportDate}T01:00:00Z`).getTime()
    };
    const report = {
      id: "report-1",
      userId: "employee-1",
      userName: "方さん",
      reportDate,
      status: "submitted",
      category: "商品調査",
      area: "",
      destinations: "",
      activities: "候補商品を調査しました。",
      findings: "",
      nextPlan: "",
      sourceLanguage: "ja",
      translationStatus: "not_required",
      translationAttempts: 0,
      reviewStatus: "unreviewed",
      revision: 1,
      attachments: [],
      comments: [{ id: "comment-1", authorId: "president-1", authorName: "山田社長", authorRole: "president_viewer", body: "価格条件も追記してください。", createdAt }]
    } as unknown as DailyReport;

    render(<RecordsPage attendance={[]} reports={[report]} categories={[]} onEditReport={vi.fn()} notify={vi.fn()} />);

    expect(screen.getByText("日報へのコメント")).toBeInTheDocument();
    expect(screen.getByText("山田社長")).toBeInTheDocument();
    expect(screen.getByText("社長")).toBeInTheDocument();
    expect(screen.getByText("価格条件も追記してください。")).toBeInTheDocument();
  });
});
