import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMissedClockOutDraft, readMissedClockOutDraft, reloadWithMissedClockOutDraft } from "./attendanceRecovery";

const draft = {
  userId: "employee", attendanceId: "attendance-1", workDate: "2026-09-11",
  endedAtLocal: "2026-09-11T18:30", reason: "前日の終業打刻を忘れたため"
};

describe("missed clock-out reload recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-11T18:17:00Z"));
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  it("retains all fields before reloading and only reads them for their owner", () => {
    const reload = vi.fn(() => expect(readMissedClockOutDraft("employee")).toEqual({ ...draft, savedAt: Date.now() }));
    expect(reloadWithMissedClockOutDraft(draft, reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(readMissedClockOutDraft("another-employee")).toBeNull();
    clearMissedClockOutDraft("employee", "another-record");
    expect(readMissedClockOutDraft("employee")).not.toBeNull();
    clearMissedClockOutDraft("employee", "attendance-1");
    expect(readMissedClockOutDraft("employee")).toBeNull();
  });

  it.each([31 * 60 * 1000, -60 * 1000])("does not restore a draft outside its recovery window: %i ms", (timeShift) => {
    reloadWithMissedClockOutDraft(draft, vi.fn());
    vi.setSystemTime(Date.now() + timeShift);
    expect(readMissedClockOutDraft("employee")).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it.each(["setItem", "getItem"] as const)("does not reload when storage %s fails", (method) => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new DOMException("Storage unavailable"); });
    const reload = vi.fn();
    expect(reloadWithMissedClockOutDraft(draft, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload if storage silently discards the draft", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => undefined);
    const reload = vi.fn();
    expect(reloadWithMissedClockOutDraft(draft, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([{ reason: "x".repeat(5001) }, { workDate: "invalid" }])("does not reload if the retained input cannot be restored", (invalidFields) => {
    const reload = vi.fn();
    expect(reloadWithMissedClockOutDraft({ ...draft, ...invalidFields }, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(readMissedClockOutDraft("employee")).toBeNull();
  });

  it("ignores malformed stored data without breaking attendance", () => {
    reloadWithMissedClockOutDraft(draft, vi.fn());
    const key = window.sessionStorage.key(0)!;
    window.sessionStorage.setItem(key, "invalid JSON");
    expect(readMissedClockOutDraft("employee")).toBeNull();
  });
});
