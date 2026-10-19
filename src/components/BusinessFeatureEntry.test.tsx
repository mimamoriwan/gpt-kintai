import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { BusinessFeatureEntry, businessIdFromHash, useBusinessEntry } from "./BusinessFeatureEntry";
import type { UserProfile } from "../types";

const state = vi.hoisted(() => ({ enabled: true, failPage: false, locale: "ja" }));
vi.mock("../features/business/api", () => ({ get businessFeatureAvailable() { return state.enabled; } }));
vi.mock("../i18n", () => ({ useI18n: () => ({ locale: state.locale }) }));
vi.mock("../features/business/BusinessPage", () => ({ default: function Page({ profile }: { profile: UserProfile }) {
  const [text, setText] = useState("");
  if (state.failPage) throw new Error("temporary feature failure");
  return <section><h1>{profile.displayName}</h1><input aria-label="business input" value={text} onChange={(event) => setText(event.target.value)} /></section>;
} }));

const profile = { uid: "yasushi", displayName: "ヤスシ", role: "employee_manager", active: true, locale: "ja" } as UserProfile;
beforeEach(() => {
  state.enabled = true;
  state.failPage = false;
  state.locale = "ja";
  window.history.replaceState(null, "", "/");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("business entry and session routing", () => {
  it("accepts only a business ID and never arbitrary sections, URLs or escaped path segments", () => {
    expect(businessIdFromHash("#business/initiative_01-abc")).toBe("initiative_01-abc");
    for (const hash of ["#admin", "https://example.com/#business/x", "#business/https://evil.test", "#business/%2Fsecret", "#business/x/y", "#business/", `#business/${"a".repeat(129)}`]) {
      expect(businessIdFromHash(hash)).toBeUndefined();
    }
  });

  it("retains a fresh link across login and clears it and its announcement on logout and same-account login", () => {
    window.history.replaceState(null, "", "/#business/initiative-1");
    const onNavigate = vi.fn();
    const { result, rerender } = renderHook(({ uid }) => useBusinessEntry(uid, onNavigate), { initialProps: { uid: undefined as string | undefined } });
    rerender({ uid: "yasushi" });
    expect(onNavigate).toHaveBeenLastCalledWith("business");
    expect(result.current.initialInitiativeId).toBe("initiative-1");
    act(() => result.current.createAnnouncement({ key: "request-1", title: "会社の取り組み", body: "https://example.test/#business/initiative-1" }));
    expect(result.current.announcementDraft?.key).toBe("request-1");
    rerender({ uid: undefined });
    expect(result.current.announcementDraft).toBeUndefined();
    expect(result.current.initialInitiativeId).toBeUndefined();
    expect(window.location.hash).toBe("");
    rerender({ uid: "yasushi" });
    expect(onNavigate).toHaveBeenLastCalledWith("home");
    expect(result.current.initialInitiativeId).toBeUndefined();
    expect(result.current.announcementDraft).toBeUndefined();
  });

  it("does not transfer a previous account link or delayed draft callback to another account", () => {
    window.history.replaceState(null, "", "/#business/initiative-1");
    const onNavigate = vi.fn();
    const { result, rerender } = renderHook(({ uid }) => useBusinessEntry(uid, onNavigate), { initialProps: { uid: "yasushi" } });
    const oldCallback = result.current.createAnnouncement;
    rerender({ uid: "president" });
    act(() => oldCallback({ key: "late", title: "old draft", body: "old account" }));
    expect(onNavigate).toHaveBeenLastCalledWith("home");
    expect(result.current.initialInitiativeId).toBeUndefined();
    expect(result.current.announcementDraft).toBeUndefined();
    expect(window.location.hash).toBe("");
  });

  it("follows an explicit new link and clears it on normal menu navigation", () => {
    const onNavigate = vi.fn();
    const { result } = renderHook(() => useBusinessEntry("yasushi", onNavigate));
    act(() => {
      window.history.replaceState(null, "", "/#business/second");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.initialInitiativeId).toBe("second");
    expect(onNavigate).toHaveBeenLastCalledWith("business");
    act(() => result.current.clearRoute());
    expect(result.current.initialInitiativeId).toBeUndefined();
    expect(window.location.hash).toBe("");
  });

  it("never opens disabled business links or accepts draft requests", () => {
    state.enabled = false;
    window.history.replaceState(null, "", "/#business/initiative-1");
    const onNavigate = vi.fn();
    const { result } = renderHook(() => useBusinessEntry("yasushi", onNavigate));
    act(() => result.current.createAnnouncement({ key: "request", title: "disabled", body: "disabled" }));
    expect(onNavigate).not.toHaveBeenCalledWith("business");
    expect(result.current.initialInitiativeId).toBeUndefined();
    expect(result.current.announcementDraft).toBeUndefined();
    render(<BusinessFeatureEntry profile={profile} onCreateAnnouncement={vi.fn()} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("contains a feature error, retries it, and resets input when the account changes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.failPage = true;
    const { rerender } = render(<><h2>Existing application</h2><BusinessFeatureEntry profile={profile} onCreateAnnouncement={vi.fn()} /></>);
    expect(await screen.findByRole("alert")).toHaveTextContent("会社の取り組みを表示できませんでした");
    expect(screen.getByRole("heading", { name: "Existing application" })).toBeVisible();
    state.failPage = false;
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    const input = await screen.findByRole("textbox", { name: "business input" });
    fireEvent.change(input, { target: { value: "private edit" } });
    rerender(<><h2>Existing application</h2><BusinessFeatureEntry profile={{ ...profile, uid: "president", displayName: "社長" }} onCreateAnnouncement={vi.fn()} /></>);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "business input" })).toHaveValue(""));
    expect(screen.getByRole("heading", { name: "社長" })).toBeVisible();
  });
});
