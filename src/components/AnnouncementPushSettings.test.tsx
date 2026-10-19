import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementPushSettings } from "./AnnouncementPushSettings";
const f = vi.hoisted(() => ({ enabled: false, locale: "ja", environment: "supported", role: "employee", enable: vi.fn(async () => {}), disable: vi.fn(async () => {}), test: vi.fn(async () => {}) }));
vi.mock("../auth", () => ({ useAuth: () => ({ profile: { uid: "owner", role: f.role } }) }));
vi.mock("../i18n", () => ({ useI18n: () => ({ locale: f.locale }) }));
vi.mock("../lib/pushStorage", () => ({ getPushState: async () => ({ enabled: f.enabled, userId: "owner" }) }));
vi.mock("../services/announcementPush", () => ({ getPushEnvironment: () => f.environment, enableAnnouncementPush: f.enable, disableAnnouncementPush: f.disable, sendAnnouncementPushTest: f.test }));
beforeEach(() => { vi.clearAllMocks(); f.enabled = false; f.locale = "ja"; f.environment = "supported"; f.role = "employee"; f.enable.mockResolvedValue(); f.test.mockResolvedValue(); vi.stubGlobal("Notification", { permission: "default" }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("notification settings", () => {
  it.each(["employee", "employee_manager", "president_viewer"])("allows %s to opt in only on a tap", async role => {
    f.role = role; render(<AnnouncementPushSettings />);
    expect(f.enable).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "通知を許可する" }));
    expect(f.enable).toHaveBeenCalledWith("owner", "ja");
    expect(await screen.findByRole("status")).toHaveTextContent("通知設定が完了");
  });
  it("explains unsupported, Home Screen and not configured states", () => {
    f.environment = "home-screen"; const { rerender } = render(<AnnouncementPushSettings />);
    expect(screen.getByText(/Safariの共有メニュー/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通知を許可する" })).toBeDisabled();
    f.environment = "not-configured"; rerender(<AnnouncementPushSettings />);
    expect(screen.getByText(/通知機能の準備中/)).toBeInTheDocument();
    f.environment = "unsupported"; rerender(<AnnouncementPushSettings />);
    expect(screen.getByText(/この環境では通知を利用できません/)).toBeInTheDocument();
  });
  it("guides a denied permission to Settings without repeatedly requesting it", () => {
    vi.stubGlobal("Notification", { permission: "denied" }); render(<AnnouncementPushSettings />);
    expect(screen.getByText(/「設定」→「通知」/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通知を許可する" })).toBeDisabled();
    expect(f.enable).not.toHaveBeenCalled();
  });
  it("shows registration failure instead of claiming success", async () => {
    f.enable.mockRejectedValue(new Error("offline")); render(<AnnouncementPushSettings />);
    fireEvent.click(screen.getByRole("button", { name: "通知を許可する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("完了しませんでした");
    expect(screen.getByText("通知OFF")).toBeInTheDocument();
  });
  it("offers test and opt-out in Chinese, distinguishing acceptance from receipt", async () => {
    f.enabled = true; f.locale = "zh-CN"; render(<AnnouncementPushSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "发送测试通知" }));
    expect(f.test).toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("请确认此设备是否收到");
    fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));
    expect(f.disable).toHaveBeenCalled();
  });
  it.each(["ja", "zh-CN"])("separates a short test interval from permission or delivery failure (%s)", async locale => {
    f.enabled = true; f.locale = locale;
    vi.stubGlobal("Notification", { permission: "granted" });
    f.test.mockRejectedValue(Object.assign(new Error("rate limited"), { code: "functions/resource-exhausted" }));
    render(<AnnouncementPushSettings />);
    fireEvent.click(await screen.findByRole("button", { name: locale === "ja" ? "テスト通知を送る" : "发送测试通知" }));
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(locale === "ja" ? "前回のテスト送信から1分経っていません" : "距离上次测试发送不足1分钟");
    expect(notice).not.toHaveTextContent(locale === "ja" ? "通信と通知の許可を確認" : "请检查网络和通知权限");
    expect(screen.getByText(locale === "ja" ? "通知ON" : "已开启")).toBeInTheDocument();
  });
});
