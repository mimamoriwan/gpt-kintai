import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { PasswordRecoveryPage } from "./PasswordRecoveryPage";

const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../services/accountManagement", () => ({
  completeAccountRecovery: mocks.complete,
  accountErrorCode: (error: { code?: string }) => error?.code ?? "",
  accountErrorReason: (error: { details?: { reason?: string } }) => error?.details?.reason ?? ""
}));
const token = "a".repeat(43);
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); mocks.complete.mockReset().mockResolvedValue({ email: "member@example.com" }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(locale: "ja" | "zh-CN" = "ja", password = "new-password-123", done = vi.fn()) {
  localStorage.setItem("gyoumulog-locale", locale);
  const view = render(<I18nProvider><PasswordRecoveryPage token={token} onDone={done} /></I18nProvider>);
  const input = screen.getByLabelText(locale === "ja" ? "新しいパスワード" : "新密码");
  const confirmation = screen.getByLabelText(locale === "ja" ? "新しいパスワード（確認）" : "确认新密码");
  fireEvent.change(input, { target: { value: password } });
  fireEvent.change(confirmation, { target: { value: password } });
  return { ...view, input, confirmation, done, submit: () => fireEvent.submit(input.closest("form")!) };
}

describe.each(["ja", "zh-CN"] as const)("password recovery in %s", (locale) => {
  it("validates length and matching confirmation before sending the password", () => {
    const { input, confirmation, submit } = setup(locale, "short");
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(locale === "ja" ? "12〜128文字" : "12至128个字符");
    fireEvent.change(input, { target: { value: "valid-password-123" } });
    fireEvent.change(confirmation, { target: { value: "different-password" } });
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(locale === "ja" ? "一致しません" : "不一致");
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("hides passwords, clears them on success and offers a separate return to login", async () => {
    const { input, submit, done } = setup(locale, " new password ");
    const store = vi.spyOn(Storage.prototype, "setItem");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "new-password");
    submit();
    expect(await screen.findByRole("status")).toHaveTextContent("member@example.com");
    expect(mocks.complete).toHaveBeenCalledWith(token, " new password ");
    expect(screen.queryByLabelText(locale === "ja" ? "新しいパスワード" : "新密码")).not.toBeInTheDocument();
    expect(done).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: locale === "ja" ? "ログイン画面に戻る" : "返回登录页面" }));
    expect(done).toHaveBeenCalledOnce();
  });
});

it("rejects malformed links without contacting the server", () => {
  render(<I18nProvider><PasswordRecoveryPage token="invalid-token" onDone={vi.fn()} /></I18nProvider>);
  expect(screen.getByRole("alert")).toHaveTextContent("無効、使用済み、または期限切れ");
  expect(screen.queryByLabelText("新しいパスワード")).not.toBeInTheDocument();
  expect(mocks.complete).not.toHaveBeenCalled();
});

it("prevents duplicate submission and locks the chosen password for an uncertain retry", async () => {
  let reject!: (cause: unknown) => void;
  mocks.complete.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const { input, confirmation, submit } = setup();
  act(() => { submit(); submit(); });
  expect(mocks.complete).toHaveBeenCalledOnce();
  expect(input).toBeDisabled();
  await act(async () => reject({ code: "functions/unavailable", message: "private-secret", details: { reason: "recovery-retry-same-password" } }));
  expect(screen.getByRole("alert")).toHaveTextContent("同じパスワードで再試行");
  expect(screen.getByRole("alert")).not.toHaveTextContent("private-secret");
  expect(input).toHaveValue("new-password-123");
  expect(input).toBeDisabled();
  expect(confirmation).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "同じパスワードで再試行" }));
  await screen.findByRole("status");
  expect(mocks.complete).toHaveBeenNthCalledWith(2, token, "new-password-123");
});

it("allows editing a rejected password and translates the guidance", async () => {
  mocks.complete.mockRejectedValueOnce({ details: { reason: "password-policy" } });
  const { input, submit } = setup();
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("設定条件を満たしていません");
  expect(input).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "中文" }));
  expect(screen.getByRole("alert")).toHaveTextContent("此密码不符合设置要求");
});

it("allows correcting a password mismatch when resuming an earlier interrupted attempt", async () => {
  mocks.complete.mockRejectedValueOnce({ details: { reason: "recovery-password-mismatch" } });
  const { input, confirmation, submit } = setup();
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("最初に設定を試みた新しいパスワード");
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { value: "original-password" } });
  fireEvent.change(confirmation, { target: { value: "original-password" } });
  submit();
  await screen.findByRole("status");
  expect(mocks.complete).toHaveBeenNthCalledWith(2, token, "original-password");
});

it("removes the form for an unavailable link and does not reopen it if returning fails", async () => {
  mocks.complete.mockRejectedValueOnce({ details: { reason: "recovery-link-unavailable" } });
  const done = vi.fn().mockRejectedValue(new Error("private-secret"));
  const { submit } = setup("ja", "new-password-123", done);
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("期限切れ");
  fireEvent.click(screen.getByRole("button", { name: "ログイン画面に戻る" }));
  expect(await screen.findByRole("alert")).not.toHaveTextContent("private-secret");
  expect(screen.queryByLabelText("新しいパスワード")).not.toBeInTheDocument();
});

it("discards a stale successful result when another link replaces the page", async () => {
  let resolve!: (value: { email: string }) => void;
  mocks.complete.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { submit, rerender } = setup();
  submit();
  rerender(<I18nProvider><PasswordRecoveryPage token={"b".repeat(43)} onDone={vi.fn()} /></I18nProvider>);
  await act(async () => resolve({ email: "private@example.com" }));
  expect(screen.queryByText("private@example.com")).not.toBeInTheDocument();
  expect(screen.getByLabelText("新しいパスワード")).toHaveValue("");
});
