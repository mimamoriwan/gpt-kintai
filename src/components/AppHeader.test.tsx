import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader";

let height: number;
let position: string;
let onHeaderResize: ResizeObserverCallback;
let observer: ResizeObserver;
const reservedHeight = () => document.documentElement.style.getPropertyValue("--app-header-height");

beforeEach(() => {
  height = 120;
  position = "sticky";
  observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
  vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation((callback: ResizeObserverCallback) => {
    onHeaderResize = callback;
    return observer;
  }));
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => height);
  vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ position }) as CSSStyleDeclaration);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("app header scroll clearance", () => {
  it("reserves the measured sticky height and updates it after content and window resizing", () => {
    const { container } = render(<AppHeader>更新とお知らせ</AppHeader>);
    expect(observer.observe).toHaveBeenCalledWith(container.firstElementChild);
    expect(reservedHeight()).toBe("120px");

    height = 184;
    act(() => onHeaderResize([], observer));
    expect(reservedHeight()).toBe("184px");

    height = 96;
    fireEvent(window, new Event("resize"));
    expect(reservedHeight()).toBe("96px");
  });

  it("reserves no height when short-viewport styles make the header nonsticky", () => {
    position = "static";
    render(<AppHeader>更新とお知らせ</AppHeader>);
    expect(reservedHeight()).toBe("0px");

    position = "sticky";
    fireEvent(window, new Event("resize"));
    expect(reservedHeight()).toBe("120px");

    position = "static";
    act(() => onHeaderResize([], observer));
    expect(reservedHeight()).toBe("0px");
  });

  it("disconnects observation and removes the resize listener and scroll clearance on unmount", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<AppHeader>更新とお知らせ</AppHeader>);
    const listener = addListener.mock.calls.find(([event]) => event === "resize")?.[1];
    expect(listener).toBeTypeOf("function");
    expect(reservedHeight()).toBe("120px");

    unmount();

    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith("resize", listener);
    expect(reservedHeight()).toBe("");
    height = 240;
    fireEvent(window, new Event("resize"));
    expect(reservedHeight()).toBe("");
  });
});
