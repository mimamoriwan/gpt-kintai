import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdateProvider } from "./AppUpdateNotice";
import { Shell } from "./Shell";
import type { NavSection } from "../types";

const store = vi.hoisted(() => ({
  state: { available: false, applying: false, failed: false },
  apply: vi.fn(),
  businessEnabled: false,
  locale: "ja"
}));

vi.mock("../auth", () => ({ useAuth: () => ({ profile: { role: "employee", displayName: "担当者" }, logout: vi.fn() }) }));
vi.mock("../i18n", () => ({ useI18n: () => ({
  locale: store.locale, setLocale: vi.fn(),
  t: (key: string) => key === "home" ? "ホーム" : key === "dailyReport" ? "日報" : key
}) }));
vi.mock("../features/business/api", () => ({ get businessFeatureAvailable() { return store.businessEnabled; } }));
vi.mock("../pwaUpdate", () => ({
  getAppUpdateState: () => store.state,
  subscribeToAppUpdate: () => () => undefined,
  applyAppUpdate: store.apply
}));
vi.mock("./PresidentInstructions", () => ({
  InstructionBanner: ({ onOpen }: { onOpen: (id: string) => void }) => <section aria-label="既存のお知らせ">お知らせ本文<button type="button" onClick={() => onOpen("banner-notice")}>バナーから確認</button></section>,
  InstructionShortcut: ({ onOpen }: { onOpen: () => void }) => <button type="button" onClick={onOpen}>お知らせを開く</button>,
  InstructionCenter: ({ open, selectedInstructionId, onClose }: { open: boolean; selectedInstructionId?: string; onClose: () => void }) => open ? <div role="dialog" aria-label="お知らせの閲覧"><span>{selectedInstructionId || "すべてのお知らせ"}</span><button type="button" onClick={onClose}>閲覧を閉じる</button></div> : null
}));

vi.mock("./InstructionReminder", () => ({
  InstructionReminder: ({ paused, onOpen }: { paused: boolean; onOpen: (id: string) => void }) => <button type="button" hidden={paused} onClick={() => onOpen("reminded-notice")}>リマインダーから確認</button>
}));

beforeEach(() => {
  store.state = { available: false, applying: false, failed: false };
  store.apply.mockReset();
  store.businessEnabled = false;
  store.locale = "ja";
});
afterEach(cleanup);

function shell(section: NavSection = "home", onSection = vi.fn()) {
  return <AppUpdateProvider><Shell section={section} onSection={onSection} instructions={[]} users={[]} notify={vi.fn()}>
    <input aria-label="入力中の内容" defaultValue="保存してから更新する内容" />
  </Shell></AppUpdateProvider>;
}

describe("app update placement in the application shell", () => {
  it("opens the existing announcement center from home content", () => {
    render(<AppUpdateProvider><Shell section="home" onSection={vi.fn()} instructions={[]} users={[]} notify={vi.fn()}>
      {(openInstructions) => <button onClick={openInstructions}>ホームのお知らせアイコン</button>}
    </Shell></AppUpdateProvider>);
    fireEvent.click(screen.getByRole("button", { name: "ホームのお知らせアイコン" }));
    expect(screen.getByRole("dialog", { name: "お知らせの閲覧" })).toHaveTextContent("すべてのお知らせ");
  });

  it("opens the exact reminder or banner announcement, pauses prompts, and clears selection from the shortcut", () => {
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "リマインダーから確認" }));
    expect(screen.getByRole("dialog", { name: "お知らせの閲覧" })).toHaveTextContent("reminded-notice");
    expect(screen.queryByRole("button", { name: "リマインダーから確認" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "閲覧を閉じる" }));
    expect(screen.getByRole("button", { name: "リマインダーから確認" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "バナーから確認" }));
    expect(screen.getByRole("dialog", { name: "お知らせの閲覧" })).toHaveTextContent("banner-notice");
    fireEvent.click(screen.getByRole("button", { name: "閲覧を閉じる" }));
    fireEvent.click(screen.getAllByRole("button", { name: "お知らせを開く" })[0]);
    expect(screen.getByRole("dialog", { name: "お知らせの閲覧" })).toHaveTextContent("すべてのお知らせ");
    expect(screen.getByRole("textbox", { name: "入力中の内容" })).toHaveValue("保存してから更新する内容");
  });
  it("shows the enabled business menu in either language without changing other navigation", () => {
    const onSection = vi.fn();
    const { rerender } = render(shell("home", onSection));
    expect(screen.queryByRole("button", { name: "会社の取り組み" })).not.toBeInTheDocument();
    store.businessEnabled = true;
    rerender(shell("home", onSection));
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "会社の取り組み" }));
    expect(onSection).toHaveBeenCalledWith("business");
    store.locale = "zh-CN";
    rerender(shell("business", onSection));
    expect(screen.getAllByRole("button", { name: "公司重点工作" })).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "入力中の内容" })).toHaveValue("保存してから更新する内容");
  });
  it("keeps ordinary navigation, announcements and page content without an available update", () => {
    render(shell());
    expect(screen.queryByRole("region", { name: /^アプリの更新/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "既存のお知らせ" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "ホーム" })).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "入力中の内容" })).toHaveValue("保存してから更新する内容");
  });

  it("places updates above sidebar Home and before announcements/content, retaining them across page navigation", () => {
    store.state.available = true;
    const onSection = vi.fn();
    const { rerender } = render(shell("home", onSection));
    const sidebar = screen.getByRole("complementary");
    const sidebarNotice = within(sidebar).getByRole("region", { name: "アプリの更新" });
    const home = within(sidebar).getByRole("button", { name: "ホーム" });
    expect(sidebarNotice.compareDocumentPosition(home) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const notices = screen.getAllByRole("region", { name: /^アプリの更新/ });
    expect(notices).toHaveLength(2);
    const banner = notices.find((notice) => !sidebar.contains(notice))!;
    const announcement = screen.getByRole("region", { name: "既存のお知らせ" });
    const input = screen.getByRole("textbox", { name: "入力中の内容" });
    expect(banner.compareDocumentPosition(announcement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(input, { target: { value: "入力を保持したまま移動" } });
    fireEvent.click(within(sidebar).getByRole("button", { name: "日報" }));
    expect(onSection).toHaveBeenCalledWith("report");
    rerender(shell("report", onSection));
    expect(screen.getAllByRole("button", { name: "更新する" })).toHaveLength(2);
    expect(input).toHaveValue("入力を保持したまま移動");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(store.apply).not.toHaveBeenCalled();
  });
});
