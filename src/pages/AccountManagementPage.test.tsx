import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AccountManagementPage } from "./AccountManagementPage";
import type { AccountManagementResult, ManagedAccount } from "../services/accountManagement";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), email: vi.fn(), reauth: vi.fn() }));
vi.mock("../auth", () => ({ useAuth: () => ({ profile: { uid: "owner" } }) }));
vi.mock("../services/accountManagement", () => ({
  getAccountManagement: mocks.get, setAccountRecovery: mocks.set, changeAccountEmail: mocks.email, reauthenticateAccountManager: mocks.reauth,
  accountErrorCode: (error: { code?: string }) => error?.code ?? "",
  accountErrorReason: (error: { details?: { reason?: string } }) => error?.details?.reason ?? ""
}));
const token = "a".repeat(43);
let accounts: ManagedAccount[];
const result = (): AccountManagementResult => ({ canManage: true, accounts: structuredClone(accounts) });
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  accounts = [
    { uid: "owner", displayName: "管理者", email: "owner@example.com", role: "employee_manager", recovery: { status: "off" } },
    { uid: "member", displayName: "従業員", email: "member@example.com", role: "employee", recovery: { status: "off" } },
    { uid: "president", displayName: "社長", email: "president@example.com", role: "president_viewer", recovery: { status: "off" } }
  ];
  mocks.get.mockReset().mockImplementation(async () => result());
  mocks.set.mockReset().mockImplementation(async (uid: string, enabled: boolean) => {
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    accounts.find((account) => account.uid === uid)!.recovery = { status: enabled ? "enabled" : "off", expiresAt };
    return enabled ? { token, expiresAt } : {};
  });
  mocks.email.mockReset().mockImplementation(async (uid: string, email: string) => {
    const account = accounts.find((account) => account.uid === uid)!;
    account.email = email;
    account.emailChangePending = false;
    delete account.pendingEmail;
  });
  mocks.reauth.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup(locale: "ja" | "zh-CN" = "ja") {
  localStorage.setItem("gyoumulog-locale", locale);
  const view = render(<I18nProvider><AccountManagementPage /></I18nProvider>);
  const card = await screen.findByRole("region", { name: "従業員" });
  return { ...view, card: within(card) };
}

describe.each(["ja", "zh-CN"] as const)("account management in %s", (locale) => {
  it("creates an in-memory one-time link, copies it and disables it", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    const { card } = await setup(locale);
    const store = vi.spyOn(Storage.prototype, "setItem");
    fireEvent.click(card.getByRole("button", { name: locale === "ja" ? "再発行をONにする" : "开启密码重设" }));
    const link = await card.findByLabelText(locale === "ja" ? "本人に伝える再設定リンク" : "转告本人的重设链接");
    expect(link).toHaveValue(`${window.location.origin}/#password-recovery=${token}`);
    fireEvent.click(card.getByRole("button", { name: locale === "ja" ? "リンクをコピー" : "复制链接" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(`${window.location.origin}/#password-recovery=${token}`));
    fireEvent.click(card.getByRole("button", { name: locale === "ja" ? "OFFにする" : "关闭" }));
    await waitFor(() => expect(card.queryByDisplayValue(`${window.location.origin}/#password-recovery=${token}`)).not.toBeInTheDocument());
    expect(mocks.set).toHaveBeenNthCalledWith(2, "member", false);
    expect(store).not.toHaveBeenCalled();
  });
});

it("never renders accounts when the server denies management permission", async () => {
  mocks.get.mockResolvedValue({ canManage: false, accounts });
  render(<I18nProvider><AccountManagementPage /></I18nProvider>);
  expect(await screen.findByText("この画面は、指定されたアカウント管理者だけが利用できます。")).toBeInTheDocument();
  expect(screen.queryByText("member@example.com")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "再発行をONにする" })).not.toBeInTheDocument();
});

it("requires confirmation when replacing an active link after reload", async () => {
  accounts[1].recovery = { status: "enabled", expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const { card } = await setup();
  expect(card.getByText(/発行済みリンクは再表示できません/)).toBeInTheDocument();
  fireEvent.click(card.getByRole("button", { name: "新しいリンクを再発行" }));
  expect(mocks.set).not.toHaveBeenCalled();
  fireEvent.click(card.getByRole("button", { name: "古いリンクを無効にして再発行" }));
  await card.findByLabelText("本人に伝える再設定リンク");
  expect(mocks.set).toHaveBeenCalledOnce();
});

it("requires recent owner authentication and an explicit action retry", async () => {
  mocks.set.mockRejectedValueOnce({ details: { reason: "recent-login-required" }, message: "private-secret" });
  const { card } = await setup();
  fireEvent.click(card.getByRole("button", { name: "再発行をONにする" }));
  const password = await screen.findByLabelText("あなたの現在のパスワード");
  fireEvent.change(password, { target: { value: "owner-password" } });
  fireEvent.submit(password.closest("form")!);
  await screen.findByText("本人確認ができました。目的の操作をもう一度実行してください。");
  expect(mocks.reauth).toHaveBeenCalledWith("owner-password", "owner@example.com");
  expect(mocks.set).toHaveBeenCalledOnce();
  expect(screen.queryByDisplayValue("owner-password")).not.toBeInTheDocument();
  expect(screen.queryByText("private-secret")).not.toBeInTheDocument();
  fireEvent.click(card.getByRole("button", { name: "再発行をONにする" }));
  await card.findByLabelText("本人に伝える再設定リンク");
  expect(mocks.set).toHaveBeenCalledTimes(2);
});

it("confirms the account and exact email, retaining the address for an uncertain retry", async () => {
  mocks.email.mockRejectedValueOnce({ details: { reason: "email-change-retry-same-address" } });
  const { card } = await setup();
  fireEvent.click(card.getByRole("button", { name: "メールアドレスを変更" }));
  fireEvent.change(card.getByLabelText("新しいメールアドレス"), { target: { value: "new@example.com" } });
  fireEvent.click(card.getByRole("button", { name: "変更内容を確認" }));
  expect(mocks.email).not.toHaveBeenCalled();
  expect(card.getByText("new@example.com")).toBeInTheDocument();
  fireEvent.click(card.getByRole("button", { name: "このメールアドレスに変更" }));
  const retry = await card.findByRole("button", { name: "同じメールアドレスで再試行" });
  expect(card.queryByRole("button", { name: "入力に戻る" })).not.toBeInTheDocument();
  await waitFor(() => expect(retry).toBeEnabled());
  fireEvent.click(retry);
  await card.findByText("メールアドレスを変更しました。本人へ新しいメールアドレスを伝えてください。");
  expect(mocks.email).toHaveBeenNthCalledWith(2, "member", "new@example.com");
});

it("removes a link when reloading finds completed recovery", async () => {
  const { card } = await setup();
  fireEvent.click(card.getByRole("button", { name: "再発行をONにする" }));
  await card.findByLabelText("本人に伝える再設定リンク");
  accounts[1].recovery = { status: "completed" };
  fireEvent.click(screen.getByRole("button", { name: "状態を再読み込み" }));
  await card.findByText("再設定が完了し、自動的にOFFになりました。");
  expect(card.queryByLabelText("本人に伝える再設定リンク")).not.toBeInTheDocument();
});

it("does not apply a stale permission response after a newer load denies access", async () => {
  let resolve!: (value: AccountManagementResult) => void;
  mocks.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValue({ canManage: false });
  render(<I18nProvider><AccountManagementPage /></I18nProvider>);
  fireEvent(document, new Event("visibilitychange"));
  await screen.findByText("この画面は、指定されたアカウント管理者だけが利用できます。");
  await act(async () => resolve(result()));
  expect(screen.queryByText("member@example.com")).not.toBeInTheDocument();
});

it("ignores duplicate activation while the first request is pending", async () => {
  let resolve!: (value: object) => void;
  mocks.set.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { card } = await setup();
  const button = card.getByRole("button", { name: "再発行をONにする" });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(mocks.set).toHaveBeenCalledOnce();
  expect(button).toBeDisabled();
  await act(async () => resolve({ token, expiresAt: new Date(Date.now() + 60_000).toISOString() }));
});

it("refreshes every 30 seconds only while the page is visible", async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => { render(<I18nProvider><AccountManagementPage /></I18nProvider>); });
  expect(mocks.get).toHaveBeenCalledOnce();
  visibility.mockReturnValue("hidden");
  await act(async () => { vi.advanceTimersByTime(30_000); });
  expect(mocks.get).toHaveBeenCalledOnce();
  visibility.mockReturnValue("visible");
  await act(async () => { vi.advanceTimersByTime(30_000); });
  expect(mocks.get).toHaveBeenCalledTimes(2);
});

it("keeps a newly issued link until a delayed status readback makes it visible", async () => {
  const { card } = await setup();
  let resolve!: (value: AccountManagementResult) => void;
  mocks.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  fireEvent.click(card.getByRole("button", { name: "再発行をONにする" }));
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  await act(async () => resolve(result()));
  expect(await card.findByLabelText("本人に伝える再設定リンク")).toHaveValue(`${window.location.origin}/#password-recovery=${token}`);
});

it("reauthenticates the owner using the authoritative email after a partial self-email change", async () => {
  accounts[0].email = "owner-new@example.com";
  accounts[0].emailChangePending = true;
  mocks.set.mockRejectedValueOnce({ details: { reason: "recent-login-required" } });
  const { card } = await setup();
  fireEvent.click(card.getByRole("button", { name: "再発行をONにする" }));
  const password = await screen.findByLabelText("あなたの現在のパスワード");
  fireEvent.change(password, { target: { value: "owner-password" } });
  fireEvent.submit(password.closest("form")!);
  await screen.findByText("本人確認ができました。目的の操作をもう一度実行してください。");
  expect(mocks.reauth).toHaveBeenCalledWith("owner-password", "owner-new@example.com");
});

it.each(["member@example.com", "new@example.com"])("resumes a pending email change after remount with current Auth email %s", async (currentEmail) => {
  accounts[1].email = currentEmail;
  accounts[1].emailChangePending = true;
  accounts[1].pendingEmail = "new@example.com";
  const { card } = await setup();
  expect(card.getByText(/メールアドレスの変更が未完了/)).toHaveTextContent("変更先：new@example.com");
  fireEvent.click(card.getByRole("button", { name: "メールアドレスを変更" }));
  const input = card.getByLabelText("新しいメールアドレス");
  expect(input).toHaveValue("new@example.com");
  expect(input).toHaveAttribute("readonly");
  const confirm = card.getByRole("button", { name: "変更内容を確認" });
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  fireEvent.click(card.getByRole("button", { name: "同じメールアドレスで再試行" }));
  await card.findByText("メールアドレスを変更しました。本人へ新しいメールアドレスを伝えてください。");
  expect(mocks.email).toHaveBeenCalledOnce();
  expect(mocks.email).toHaveBeenCalledWith("member", "new@example.com");
});
