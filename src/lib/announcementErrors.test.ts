import { describe, expect, it } from "vitest";
import { announcementErrorMessage } from "./announcementErrors";

describe("announcement recovery guidance", () => {
  it.each(["appCheck/throttled", "appCheck/initial-throttle", "app-check/throttled"])("explains %s without asking users to wait a day or lose their draft", (code) => {
    const error = Object.assign(new Error("Requests throttled due to previous 403 error. Attempts allowed again after 21h:20m:58s"), { code });
    const message = announcementErrorMessage(error, "ja");
    expect(message).toContain("件数や容量が原因ではありません");
    expect(message).toContain("この画面に保持");
    expect(message).toContain("控えてからページを再読み込み");
    expect(message).toContain("資料を選び直して");
    expect(message).not.toContain("21h");
    expect(announcementErrorMessage(error, "zh-CN")).toContain("刷新页面并重新选择附件");
  });

  it.each(["functions/unauthenticated", "storage/unauthenticated", "appCheck/fetch-network-error"])("keeps authentication failures distinct from file validation: %s", (code) => {
    const message = announcementErrorMessage(Object.assign(new Error("raw error"), { code }), "ja");
    expect(message).toContain("認証");
    expect(message).toContain("この画面に保持");
    expect(message).not.toContain("raw error");
  });

  it("asks users to check published announcements when the response is uncertain", () => {
    expect(announcementErrorMessage({ code: "functions/deadline-exceeded" }, "ja")).toContain("発信済みのお知らせを確認");
  });

  it("preserves specific file validation errors", () => {
    expect(announcementErrorMessage(new Error("資料.pdf は10MB以下にしてください。"), "ja")).toBe("資料.pdf は10MB以下にしてください。");
  });
});
