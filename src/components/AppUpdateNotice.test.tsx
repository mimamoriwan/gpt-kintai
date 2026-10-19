import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdateNotice, AppUpdateProvider } from "./AppUpdateNotice";

const store = vi.hoisted(() => ({
  state: { available: false, applying: false, failed: false },
  listeners: new Set<() => void>(),
  apply: vi.fn<() => Promise<void>>(),
  locale: "ja"
}));

vi.mock("../i18n", () => ({ useI18n: () => ({ locale: store.locale }) }));
vi.mock("../pwaUpdate", () => ({
  getAppUpdateState: () => store.state,
  subscribeToAppUpdate: (listener: () => void) => {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  },
  applyAppUpdate: () => store.apply()
}));

function publish(state: Partial<typeof store.state>) {
  act(() => {
    store.state = { ...store.state, ...state };
    store.listeners.forEach((listener) => listener());
  });
}

function renderUpdateNotices() {
  return render(<AppUpdateProvider>
    <input aria-label="未保存メモ" defaultValue="保存前の入力" />
    <AppUpdateNotice placement="sidebar" />
    <AppUpdateNotice placement="banner" />
  </AppUpdateProvider>);
}

function openFrom(placement: "sidebar" | "banner") {
  const notice = document.querySelector<HTMLElement>(`.app-update-${placement}`)!;
  const entry = within(notice).getByRole("button");
  entry.focus();
  fireEvent.click(entry);
  return { entry, dialog: screen.getByRole("dialog") };
}

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

beforeEach(() => {
  store.state = { available: false, applying: false, failed: false };
  store.locale = "ja";
  // The real update store publishes applying synchronously before awaiting the
  // service worker. Components depend on this to prevent duplicate activation.
  store.apply.mockReset().mockImplementation(async () => {
    publish({ applying: true, failed: false });
  });
  // jsdom lacks native dialog methods. These mocks only exercise React's open,
  // cancel and return-focus wiring; browser QA covers focus trapping/inertness.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
      this.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    }
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    }
  });
});

afterEach(() => {
  cleanup();
  for (const [name, descriptor] of [["showModal", originalShowModal], ["close", originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

describe("manual app update notice", () => {
  it("shows persistent sidebar and page notices without opening a dialog or disturbing input", () => {
    renderUpdateNotices();
    const input = screen.getByRole("textbox", { name: "未保存メモ" });
    input.focus();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    publish({ available: true });

    expect(screen.getAllByRole("region", { name: /^アプリの更新/ })).toHaveLength(2);
    expect(screen.getAllByText("未更新")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "更新する" })).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("「更新する」を押してからご利用ください。");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveValue("保存前の入力");
    fireEvent.change(input, { target: { value: "更新待ちでも入力を続けられる" } });
    expect(input).toHaveValue("更新待ちでも入力を続けられる");
    expect(screen.getAllByRole("button", { name: "更新する" })).toHaveLength(2);
    expect(store.apply).not.toHaveBeenCalled();
  });

  it.each(["sidebar", "banner"] as const)("opens the same shared confirmation from the %s and requires explicit consent", (placement) => {
    store.state.available = true;
    renderUpdateNotices();
    const { dialog } = openFrom(placement);
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(dialog).toHaveAccessibleName("更新の準備はできましたか？");
    expect(dialog).toHaveAccessibleDescription(/入力中の内容は、更新操作では保存されません/);
    expect(within(dialog).getByText(/ほかのGyoumuLogのタブ/)).toBeInTheDocument();
    expect(within(dialog).getByText(/送信・添付のアップロード・AI処理/)).toBeInTheDocument();
    expect(within(dialog).getByText(/正式提出する必要はありません/)).toBeInTheDocument();
    const update = within(dialog).getByRole("button", { name: "更新して開き直す" });
    expect(update).toBeDisabled();
    fireEvent.click(update);
    expect(store.apply).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "準備ができたので、更新して構いません" }));
    expect(update).toBeEnabled();
    fireEvent.click(update);
    expect(store.apply).toHaveBeenCalledOnce();
  });

  it.each(["return", "close", "escape"] as const)("%s cancellation retains both notices and input, restores focus, and resets consent", (method) => {
    store.state.available = true;
    renderUpdateNotices();
    const { entry, dialog } = openFrom("sidebar");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    if (method === "escape") {
      const cancel = new Event("cancel", { cancelable: true });
      fireEvent(dialog, cancel);
      expect(cancel.defaultPrevented).toBe(true);
    } else {
      fireEvent.click(within(dialog).getByRole("button", { name: method === "return" ? "入力に戻る" : "更新の確認を閉じる" }));
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(entry).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "未保存メモ" })).toHaveValue("保存前の入力");
    expect(screen.getAllByRole("button", { name: "更新する" })).toHaveLength(2);
    const reopened = openFrom("banner").dialog;
    expect(reopened).toBe(dialog);
    expect(within(reopened).getByRole("checkbox")).not.toBeChecked();
    expect(within(reopened).getByRole("button", { name: "更新して開き直す" })).toBeDisabled();
    expect(store.apply).not.toHaveBeenCalled();
  });

  it("prevents repeat activation and dismissal through every entry while applying", () => {
    store.state.available = true;
    renderUpdateNotices();
    const { dialog } = openFrom("banner");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "更新して開き直す" }));

    const applyingButtons = screen.getAllByRole("button", { name: "更新中…" });
    expect(applyingButtons).toHaveLength(3);
    for (const button of applyingButtons) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(within(dialog).getByRole("checkbox")).toBeDisabled();
    for (const name of ["入力に戻る", "更新の確認を閉じる"]) {
      const button = within(dialog).getByRole("button", { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByRole("status")).toHaveTextContent("画面は自動で開き直されます");
    expect(store.apply).toHaveBeenCalledOnce();
  });

  it("shows asynchronous failure in both notices and allows a newly confirmed retry", async () => {
    store.state.available = true;
    renderUpdateNotices();
    const { dialog } = openFrom("sidebar");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "更新して開き直す" }));

    publish({ applying: false, failed: true });

    expect(within(dialog).getByRole("alert")).toHaveTextContent("更新を完了できませんでした");
    expect(screen.getAllByText("通信状態を確認して、もう一度更新してください。")).toHaveLength(2);
    expect(within(dialog).getByRole("checkbox")).not.toBeChecked();
    const retry = within(dialog).getByRole("button", { name: "もう一度更新する" });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(store.apply).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole("button", { name: "入力に戻る" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(retry);
    await waitFor(() => expect(store.apply).toHaveBeenCalledTimes(2));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "更新中…" })).toBeDisabled();
  });

  it("localizes both notices, preparation, failure, and return controls in Chinese", () => {
    store.locale = "zh-CN";
    store.state.available = true;
    renderUpdateNotices();
    expect(screen.getAllByRole("region", { name: "应用有新版本" })).toHaveLength(2);
    expect(screen.getAllByText("待更新")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("请点击“更新”后再使用。");
    const { entry, dialog } = openFrom("banner");
    expect(dialog).toHaveAccessibleName("准备好更新了吗？");
    expect(within(dialog).getByText(/关闭其他GyoumuLog标签页/)).toBeInTheDocument();
    expect(within(dialog).getByText(/无需为了更新而正式提交日报/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "已完成准备，可以重新加载" }));
    publish({ failed: true });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("未能完成更新");
    expect(within(dialog).getByRole("checkbox")).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "重试更新" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "返回输入页面" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(entry).toHaveFocus();
    expect(screen.getAllByRole("button", { name: "重试更新" })).toHaveLength(2);
    expect(store.apply).not.toHaveBeenCalled();
  });
});
