import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AuthRecoveryPage } from "./AuthRecoveryPage";

const auth = vi.hoisted(() => ({
  profile: null as { active: boolean } | null,
  profileError: "unavailable" as "unavailable" | "missing" | "session-unavailable" | null,
  retryProfile: vi.fn(),
  logout: vi.fn()
}));
vi.mock("../auth", () => ({ useAuth: () => auth }));

beforeEach(() => {
  localStorage.clear();
  auth.profile = null;
  auth.profileError = "unavailable";
  auth.retryProfile.mockReset();
  auth.logout.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("authenticated profile recovery", () => {
  it.each(["ja", "zh-CN"])("offers token-read recovery in %s without claiming the password changed", (locale) => {
    localStorage.setItem("gyoumulog-locale", locale);
    auth.profileError = "session-unavailable";
    render(<I18nProvider><AuthRecoveryPage /></I18nProvider>);
    expect(screen.getByRole("heading")).toHaveTextContent(locale === "ja" ? "ログイン状態を確認できません" : "无法确认登录状态");
    expect(screen.getByRole("status")).toHaveTextContent(locale === "ja" ? "現在有効なパスワード" : "当前有效的密码");
    expect(screen.getByRole("status")).not.toHaveTextContent(locale === "ja" ? "パスワード変更後" : "修改密码后");
    expect(screen.getByRole("button", { name: locale === "ja" ? "ログイン画面に戻る" : "返回登录页面" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: locale === "ja" ? "もう一度読み込む" : "重新读取" }));
    expect(auth.retryProfile).toHaveBeenCalledOnce();
    expect(auth.logout).not.toHaveBeenCalled();
  });
  it.each(["ja", "zh-CN"])("returns to login when session recovery is unavailable in %s", async (locale) => {
    localStorage.setItem("gyoumulog-locale", locale);
    auth.profileError = "session-unavailable";
    render(<I18nProvider><AuthRecoveryPage /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: locale === "ja" ? "ログイン画面に戻る" : "返回登录页面" }));
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(auth.retryProfile).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: locale === "ja" ? "ログイン画面に戻る" : "返回登录页面" })).toBeEnabled());
  });
  it("offers a profile retry without asking for credentials again", () => {
    render(<I18nProvider><AuthRecoveryPage /></I18nProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("ログインは完了しています");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));
    expect(auth.retryProfile).toHaveBeenCalledOnce();
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it("explains a missing profile and allows retry after registration", () => {
    auth.profileError = "missing";
    render(<I18nProvider><AuthRecoveryPage /></I18nProvider>);
    expect(screen.getByRole("heading", { name: "利用者情報が登録されていません" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("管理担当者");
    expect(screen.getByRole("button", { name: "もう一度読み込む" })).toBeEnabled();
  });

  it("explains inactive accounts without suggesting a retry will reactivate them", () => {
    auth.profile = { active: false };
    auth.profileError = null;
    render(<I18nProvider><AuthRecoveryPage /></I18nProvider>);
    expect(screen.getByRole("heading", { name: "アカウントの利用が停止されています" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "もう一度読み込む" })).not.toBeInTheDocument();
  });

  it("switches recovery guidance and actions to Chinese", () => {
    render(<I18nProvider><AuthRecoveryPage /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByRole("status")).toHaveTextContent("已完成登录");
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(auth.retryProfile).toHaveBeenCalledOnce();
  });

  it("keeps recovery available when switching accounts fails", async () => {
    auth.logout.mockRejectedValue(new Error("private transport detail"));
    render(<I18nProvider><AuthRecoveryPage /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "別のアカウントでログイン" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ログアウトできませんでした");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private transport detail");
    expect(screen.getByRole("button", { name: "もう一度読み込む" })).toBeEnabled();
  });
});
