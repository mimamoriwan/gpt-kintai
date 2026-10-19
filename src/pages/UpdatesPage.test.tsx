import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "../i18n";
import { UpdatesPage } from "./UpdatesPage";

vi.mock("../data/updates", () => ({
  updates: [
    {
      id: "earlier", updatedAt: "2026-09-16T23:50:00+09:00", kind: "fix",
      content: {
        ja: { title: "資料の表示修正", areas: ["関連資料"], changes: ["取得条件を修正しました。"], benefits: ["本人の資料を確認できます。"] },
        "zh-CN": { title: "修复资料显示", areas: ["相关资料"], changes: ["修正了获取条件。"], benefits: ["可以查看自己的资料。"] }
      }
    },
    {
      id: "later", updatedAt: "2026-09-16T15:04:00Z", kind: "feature",
      content: {
        ja: { title: "工程表を追加", areas: ["会社の取り組み"], changes: ["節目を追加しました。"], benefits: ["予定を比較できます。"] },
        "zh-CN": { title: "新增工程表", areas: ["公司重点工作"], changes: ["添加了里程碑。"], benefits: ["可以比较计划。"] }
      }
    }
  ]
}));

function PageWithLanguageToggle() {
  const { setLocale } = useI18n();
  return <><button onClick={() => setLocale("zh-CN")}>中文</button><UpdatesPage /></>;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.lang = "ja";
});

describe("UpdatesPage", () => {
  it("orders entries by actual time and displays Japanese time even across a date boundary", () => {
    render(<I18nProvider><UpdatesPage /></I18nProvider>);
    const entries = screen.getAllByRole("article");
    expect(within(entries[0]).getByRole("heading", { level: 2 })).toHaveTextContent("工程表を追加");
    expect(within(entries[1]).getByRole("heading", { level: 2 })).toHaveTextContent("資料の表示修正");
    expect(entries[0].querySelector("time")).toHaveTextContent("2026/09/17 00:04");
    expect(entries[0].querySelector("time")).toHaveAttribute("datetime", "2026-09-16T15:04:00Z");
    expect(within(entries[0]).getByRole("heading", { name: "修正内容" })).toBeInTheDocument();
    expect(within(entries[0]).getByRole("heading", { name: "できるようになったこと" })).toBeInTheDocument();
  });

  it("finds changes by title, location, details and benefits, and recovers from no results", () => {
    render(<I18nProvider><UpdatesPage /></I18nProvider>);
    const search = screen.getByRole("searchbox", { name: "更新情報を検索" });
    for (const query of ["  資料の表示  ", "関連資料", "取得条件", "本人の資料"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getAllByRole("article")).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("資料の表示修正");
      expect(screen.getByRole("status")).toHaveTextContent("1件 / 全2件");
    }
    fireEvent.change(search, { target: { value: "存在しない言葉" } });
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.getByText(/該当する更新情報はありません/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "検索をクリア" }));
    expect(search).toHaveValue("");
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("switches the history and search to Chinese with the app language", () => {
    render(<I18nProvider><PageWithLanguageToggle /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByRole("heading", { name: "更新信息", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "新增工程表" })).toBeInTheDocument();
    expect(screen.queryByText("工程表を追加")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索更新信息" }), { target: { value: "里程碑" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "现在可以做什么" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 条 / 共 2 条");
  });
});
