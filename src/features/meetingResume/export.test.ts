import { afterEach, describe, expect, it, vi } from "vitest";
import { buildResume } from "./model";
import { printResume } from "./export";
import type { DailyReport, UserProfile } from "../../types";
const resume = buildResume({ owner: { uid: "owner" } as UserProfile, userId: "owner", from: "2026-10-01", to: "2026-10-28", locale: "ja", createdDate: "2026-10-28", reports: [{ id: "one", userId: "owner", reportDate: "2026-10-02", status: "submitted", activities: "印刷確認" + "本文".repeat(150) + "活動の最終文。", findings: "所見".repeat(150) + "所見の最終文。", nextPlan: "次の対応".repeat(150) + "対応の最終文。", category: "営業" }] as DailyReport[] });
afterEach(() => { document.querySelectorAll("iframe").forEach(f => f.remove()); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("isolated resume printing", () => {
  it("prints just the standalone document and removes the frame after printing", async () => {
    vi.useFakeTimers();
    const pending = printResume(resume, "ja");
    const frame = document.querySelector("iframe")!;
    expect(frame.srcdoc).toContain("印刷確認" + "本文".repeat(150) + "活動の最終文。");
    expect(frame.srcdoc).toContain("所見".repeat(150) + "所見の最終文。");
    expect(frame.srcdoc).toContain("次の対応".repeat(150) + "対応の最終文。");
    expect(frame.srcdoc).not.toContain("sidebar");
    const print = vi.spyOn(frame.contentWindow!, "print").mockImplementation(() => undefined);
    vi.spyOn(frame.contentWindow!, "focus").mockImplementation(() => undefined);
    frame.dispatchEvent(new Event("load"));
    await pending;
    expect(print).toHaveBeenCalledOnce();
    frame.contentWindow!.dispatchEvent(new Event("afterprint"));
    expect(document.querySelector("iframe")).toBeNull();
  });
  it("reports a failed load instead of leaving printing permanently busy", async () => {
    vi.useFakeTimers();
    const pending = printResume(resume, "ja");
    const assertion = expect(pending).rejects.toThrow("読み込み");
    vi.advanceTimersByTime(10001);
    await assertion;
    expect(document.querySelector("iframe")).toBeNull();
  });
});
