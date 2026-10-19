import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppCheckRecoveryNotice } from "./AppCheckRecoveryNotice";

const store = vi.hoisted(() => ({
  state: null as null | "temporary" | "throttled",
  listeners: new Set<() => void>(),
  locale: "ja"
}));

vi.mock("../i18n", () => ({ useI18n: () => ({ locale: store.locale }) }));
vi.mock("../lib/appCheckRecovery", () => ({
  getAppCheckRecoveryState: () => store.state,
  subscribeToAppCheckRecovery: (listener: () => void) => {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  }
}));

function publish(state: typeof store.state) {
  act(() => {
    store.state = state;
    store.listeners.forEach((listener) => listener());
  });
}

function renderNotice(onReload = vi.fn()) {
  render(<><AppCheckRecoveryNotice onReload={onReload} /><textarea aria-label="未保存の日報" defaultValue="保存前の日報" /></>);
  return onReload;
}

beforeEach(() => {
  store.state = null;
  store.locale = "ja";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("App Check recovery notice", () => {
  it("keeps the draft and focus after eight hours and a throttling error, without reloading", () => {
    vi.useFakeTimers();
    const reload = renderNotice();
    const draft = screen.getByRole("textbox", { name: "未保存の日報" });
    draft.focus();
    fireEvent.change(draft, { target: { value: "8時間後も残す入力" } });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(8 * 60 * 60 * 1000); });
    publish("throttled");

    expect(screen.getByRole("region", { name: "接続の確認が必要です" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("保存・同期が止まっている可能性");
    expect(screen.getByText(/入力中の内容を別の場所へコピー/)).toBeInTheDocument();
    expect(screen.getByText("ログインを繰り返すだけでは、この接続制限は解除されません。")).toBeInTheDocument();
    expect(screen.getByText(/再読み込み後も続く場合は、管理担当者へ連絡/)).toBeInTheDocument();
    expect(draft).toHaveValue("8時間後も残す入力");
    expect(draft).toHaveFocus();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(8 * 60 * 60 * 1000); });
    expect(screen.getByRole("region", { name: "接続の確認が必要です" })).toBeInTheDocument();
    expect(draft).toHaveValue("8時間後も残す入力");
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads only after opening confirmation, checking consent and pressing reload", () => {
    store.state = "throttled";
    const reload = renderNotice();
    const entry = screen.getByRole("button", { name: "再読み込みを確認" });
    expect(entry).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(entry);
    expect(entry).toHaveAttribute("aria-expanded", "true");
    const confirmReload = screen.getByRole("button", { name: "再読み込みする" });
    expect(confirmReload).toBeDisabled();
    fireEvent.click(confirmReload);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(/再読み込みでは入力中の内容は保存されません/)).toBeInTheDocument();
    const consent = screen.getByRole("checkbox", { name: "入力中の内容をコピーし、再読み込みしてもよいことを確認しました" });
    fireEvent.click(consent);
    expect(confirmReload).toBeEnabled();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(confirmReload);
    expect(reload).toHaveBeenCalledOnce();
  });

  it.each(["cancel", "toggle", "escape"])("%s leaves the draft intact and clears consent before reopening", (method) => {
    store.state = "temporary";
    const reload = renderNotice();
    const entry = screen.getByRole("button", { name: "再読み込みを確認" });
    fireEvent.click(entry);
    const consent = screen.getByRole("checkbox");
    fireEvent.click(consent);
    if (method === "cancel") fireEvent.click(screen.getByRole("button", { name: "入力に戻る" }));
    else if (method === "toggle") fireEvent.click(entry);
    else fireEvent.keyDown(consent, { key: "Escape" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "未保存の日報" })).toHaveValue("保存前の日報");
    expect(entry).toHaveFocus();
    fireEvent.click(entry);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "再読み込みする" })).toBeDisabled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("clears the notice after successful verification without changing the draft, and resets consent for a later failure", () => {
    store.state = "temporary";
    const reload = renderNotice();
    fireEvent.click(screen.getByRole("button", { name: "再読み込みを確認" }));
    fireEvent.click(screen.getByRole("checkbox"));
    publish(null);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "未保存の日報" })).toHaveValue("保存前の日報");
    publish("throttled");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再読み込みを確認" }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(reload).not.toHaveBeenCalled();
  });

  it.each(["temporary", "throttled"] as const)("localizes %s recovery guidance and confirmation in Simplified Chinese", (state) => {
    store.locale = "zh-CN";
    store.state = state;
    const reload = renderNotice();
    expect(screen.getByRole("region", { name: "需要确认连接" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(state === "temporary" ? "应用的连接验证失败" : "应用的连接验证暂时受到限制");
    expect(screen.getByRole("status")).toHaveTextContent("保存或同步也可能已暂停");
    expect(screen.getByText(/请先将正在输入的内容复制到其他地方/)).toBeInTheDocument();
    expect(screen.getByText(/如果重新加载后仍有问题，请联系管理员/)).toBeInTheDocument();
    if (state === "throttled") expect(screen.getByText("仅反复登录无法解除此连接验证限制。")).toBeInTheDocument();
    else expect(screen.queryByText("仅反复登录无法解除此连接验证限制。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认重新加载" }));
    expect(screen.getByText(/重新加载不会保存正在输入的内容/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "已复制正在输入的内容，确认可以重新加载" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "重新加载页面" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "返回输入页面" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});
