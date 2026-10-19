import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { LoginPage } from "./LoginPage";
import { recordAppCheckError, recordAppCheckSuccess } from "../lib/appCheckRecovery";

const login = vi.hoisted(() => vi.fn());

vi.mock("../auth", () => ({ useAuth: () => ({ login }) }));

beforeEach(() => {
  login.mockReset();
  recordAppCheckSuccess(true);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderLogin(locale: "ja" | "zh-CN" = "ja") {
  localStorage.setItem("gyoumulog-locale", locale);
  render(<I18nProvider><LoginPage /></I18nProvider>);
  const email = screen.getByLabelText(locale === "ja" ? "メールアドレス" : "电子邮箱");
  const password = screen.getByLabelText(locale === "ja" ? "パスワード" : "密码");
  fireEvent.change(email, { target: { value: "employee@example.com" } });
  fireEvent.change(password, { target: { value: "test-only-password" } });
  return { email, password };
}

describe.each(["ja", "zh-CN"] as const)("LoginPage errors in %s", (locale) => {
  it.each([
    ["auth/invalid-credential", "メールアドレスまたはパスワードを確認", "请检查邮箱地址或密码"],
    ["auth/network-request-failed", "インターネット接続を確認", "请检查网络连接后重试"],
    ["auth/timeout", "インターネット接続を確認", "请检查网络连接后重试"],
    ["auth/too-many-requests", "しばらく待ってから", "请稍候再试"],
    ["auth/user-disabled", "アカウントは無効", "账号已被停用"],
    ["auth/operation-not-allowed", "ログイン設定に問題", "登录设置有问题"],
    ["auth/invalid-api-key", "ログイン設定に問題", "登录设置有问题"],
    ["auth/configuration-not-found", "ログイン設定に問題", "登录设置有问题"],
    ["appCheck/throttled", "再ログインを繰り返さず", "请勿反复登录"],
    ["appCheck/fetch-network-error", "接続確認に失敗", "连接验证失败"],
    ["auth/captcha-check-failed", "接続確認に失敗", "连接验证失败"],
    ["auth/unrecognized", "ログインできませんでした", "登录失败"]
  ])("gives actionable feedback for %s without disclosing the raw error", async (code, ja, zh) => {
    login.mockRejectedValue({ code, message: "private server detail employee@example.com test-only-password" });
    const { email, password } = renderLogin(locale);

    fireEvent.click(screen.getByRole("button", { name: locale === "ja" ? "ログイン" : "登录" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(locale === "ja" ? ja : zh);
    expect(alert).not.toHaveTextContent("private server detail");
    expect(alert).not.toHaveTextContent("employee@example.com");
    expect(alert).not.toHaveTextContent("test-only-password");
    expect(email).toHaveValue("employee@example.com");
    expect(password).toHaveValue("test-only-password");
    expect(password).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: locale === "ja" ? "ログイン" : "登录" })).toBeEnabled();
  });
});

it.each(["ja", "zh-CN"] as const)("explains an App Check restriction recorded during login in %s", async (locale) => {
  login.mockImplementation(async () => {
    recordAppCheckError({ code: "appCheck/throttled" });
    throw { code: "auth/invalid-credential" };
  });
  const { password } = renderLogin(locale);
  fireEvent.click(screen.getByRole("button", { name: locale === "ja" ? "ログイン" : "登录" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(locale === "ja" ? "再ログインを繰り返さず" : "请勿反复登录");
  expect(screen.getByRole("alert")).toHaveTextContent(locale === "ja" ? "管理担当者" : "管理员");
  expect(password).toHaveValue("test-only-password");
  expect(login).toHaveBeenCalledOnce();
});

it("keeps credential guidance for a stale temporary connection error", async () => {
  recordAppCheckError({ code: "appCheck/fetch-network-error" });
  login.mockRejectedValue({ code: "auth/invalid-credential" });
  renderLogin();
  fireEvent.click(screen.getByRole("button", { name: "ログイン" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("メールアドレスまたはパスワードを確認");
});

it.each(["auth/invalid-email", "auth/wrong-password", "auth/user-not-found"])("uses the same credentials guidance for %s", async (code) => {
  login.mockRejectedValue({ code });
  renderLogin();

  fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("メールアドレスまたはパスワードを確認してください。");
});

it("updates an existing error when the user switches language", async () => {
  login.mockRejectedValue({ code: "auth/network-request-failed" });
  renderLogin();
  fireEvent.click(screen.getByRole("button", { name: "ログイン" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("インターネット接続を確認");

  fireEvent.click(screen.getByRole("button", { name: "中文" }));

  expect(screen.getByRole("alert")).toHaveTextContent("请检查网络连接后重试");
  expect(login).toHaveBeenCalledOnce();
});

it("clears the previous error while a retry is pending and restores the submit button on success", async () => {
  let finish!: () => void;
  login.mockRejectedValueOnce({ code: "auth/network-request-failed" });
  login.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  renderLogin();
  fireEvent.click(screen.getByRole("button", { name: "ログイン" }));
  await screen.findByRole("alert");

  fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "…" })).toBeDisabled();
  expect(login).toHaveBeenLastCalledWith("employee@example.com", "test-only-password");

  await act(async () => { finish(); });

  await waitFor(() => expect(screen.getByRole("button", { name: "ログイン" })).toBeEnabled());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each([new Error("private server detail"), "private server detail", null, { code: "<private server detail>" }])("uses a safe fallback for an unexpected failure %#", async (error) => {
  login.mockRejectedValue(error);
  renderLogin();

  fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("ログインできませんでした。");
  expect(alert).not.toHaveTextContent("private server detail");
  expect(alert).not.toHaveTextContent("メールアドレスまたはパスワード");
});
