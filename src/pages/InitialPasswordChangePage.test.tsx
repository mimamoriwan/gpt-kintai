import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { InitialPasswordChangePage } from "./InitialPasswordChangePage";

const auth = vi.hoisted(() => ({
  completeInitialPasswordChange: vi.fn(),
  passwordChangeNeedsReauth: false,
  logout: vi.fn()
}));
vi.mock("../auth", () => ({ useAuth: () => auth }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  auth.completeInitialPasswordChange.mockReset().mockResolvedValue(undefined);
  auth.logout.mockReset().mockResolvedValue(undefined);
  auth.passwordChangeNeedsReauth = false;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(locale: "ja" | "zh-CN" = "ja", password = "new-password", confirmation = password) {
  localStorage.setItem("gyoumulog-locale", locale);
  const view = render(<I18nProvider><InitialPasswordChangePage /></I18nProvider>);
  const input = screen.getByLabelText(locale === "ja" ? "新しいパスワード" : "新密码");
  const confirm = screen.getByLabelText(locale === "ja" ? "新しいパスワード（確認）" : "确认新密码");
  fireEvent.change(input, { target: { value: password } });
  fireEvent.change(confirm, { target: { value: confirmation } });
  const submit = () => fireEvent.submit(input.closest("form")!);
  return { ...view, input, confirm, submit };
}

describe.each(["ja", "zh-CN"] as const)("initial password page in %s", (locale) => {
  it("requires matching passwords before contacting the server", () => {
    const { submit } = setup(locale, "first-password", "other-password");
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(locale === "ja" ? "一致しません" : "不一致");
    expect(auth.completeInitialPasswordChange).not.toHaveBeenCalled();
  });

  it.each(["12345", "x".repeat(129)])("validates the password length before submitting (%#)", (password) => {
    const { submit } = setup(locale, password);
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(locale === "ja" ? "6〜128文字" : "6至128个字符");
    expect(auth.completeInitialPasswordChange).not.toHaveBeenCalled();
  });

  it("keeps both fields hidden and clears them after successful completion without persisting passwords", async () => {
    const { input, confirm, submit } = setup(locale, " new password ");
    const store = vi.spyOn(Storage.prototype, "setItem");
    expect(input).toHaveAttribute("type", "password");
    expect(confirm).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "new-password");
    expect(confirm).toHaveAttribute("autocomplete", "new-password");

    submit();
    expect(await screen.findByRole("status")).toHaveTextContent(locale === "ja" ? "設定が完了" : "设置已完成");
    expect(auth.completeInitialPasswordChange).toHaveBeenCalledWith(" new password ");
    expect(input).toHaveValue("");
    expect(confirm).toHaveValue("");
    expect(store).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("explains recent-login requirements without exposing private error details", async () => {
    auth.completeInitialPasswordChange.mockRejectedValue({
      code: "functions/failed-precondition",
      details: { reason: "recent-login-required", password: "private-secret" },
      message: "private-secret"
    });
    const { input, submit } = setup(locale);
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(locale === "ja" ? "現在有効なパスワード" : "当前有效的密码");
    expect(alert).toHaveTextContent(locale === "ja" ? "入力した新しいパスワード" : "当时输入的新密码");
    expect(alert).not.toHaveTextContent(locale === "ja" ? "仮パスワードでログイン" : "使用临时密码登录");
    expect(alert).not.toHaveTextContent("private-secret");
    expect(input).toHaveValue("new-password");

    fireEvent.click(screen.getByRole("button", { name: locale === "ja" ? "ログイン画面に戻る" : "返回登录页面" }));
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(input).toHaveValue("");
  });
});

it("preserves the chosen password for an uncertain response and prevents duplicate submissions", async () => {
  let reject!: (error: unknown) => void;
  auth.completeInitialPasswordChange.mockImplementationOnce(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }));
  const { input, confirm, submit } = setup();
  act(() => { submit(); submit(); });
  expect(auth.completeInitialPasswordChange).toHaveBeenCalledOnce();
  expect(input).toBeDisabled();
  expect(confirm).toBeDisabled();

  await act(async () => { reject({ code: "functions/unavailable", details: { reason: "password-change-retry-same-password" } }); });
  expect(screen.getByRole("alert")).toHaveTextContent("最初に入力した新しいパスワード");
  expect(input).toHaveValue("new-password");
  expect(input).toBeEnabled();
  submit();
  await screen.findByRole("status");
  expect(auth.completeInitialPasswordChange).toHaveBeenCalledTimes(2);
});

it("offers authentication renewal after the password was saved and sign-in failed", async () => {
  auth.passwordChangeNeedsReauth = true;
  auth.completeInitialPasswordChange.mockRejectedValueOnce({ code: "auth/password-change-reauth-required" });
  const { submit } = setup();
  expect(screen.getByRole("button", { name: "新しいパスワードでログイン" })).toBeEnabled();
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("パスワードの変更は完了しています");
  submit();
  expect(await screen.findByRole("status")).toHaveTextContent("設定が完了");
});

it.each([
  ["password-matches-temporary", "仮パスワードとは異なる"],
  ["password-policy", "設定条件を満たしていません"],
  ["password-setup-not-ready", "仮パスワードを準備"],
  ["password-setup-expired", "再発行を依頼"],
  ["password-change-in-progress", "しばらく待ち"],
  ["password-change-conflict", "最初に入力した新しいパスワード"],
  ["password-setup-unavailable", "管理担当者に確認"],
  ["password-too-short", "6〜128文字"]
])("gives useful guidance for %s", async (reason, message) => {
  auth.completeInitialPasswordChange.mockRejectedValue({ code: "functions/failed-precondition", details: { reason } });
  const { submit } = setup();
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
});

it("switches existing error guidance to Chinese and safely handles unexpected errors", async () => {
  auth.completeInitialPasswordChange.mockRejectedValue({ code: "private-secret", message: "private-secret" });
  const { submit } = setup();
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("パスワード設定を完了できませんでした");
  fireEvent.click(screen.getByRole("button", { name: "中文" }));
  expect(screen.getByRole("alert")).toHaveTextContent("未能完成密码设置");
  expect(screen.getByRole("alert")).not.toHaveTextContent("private-secret");
});
