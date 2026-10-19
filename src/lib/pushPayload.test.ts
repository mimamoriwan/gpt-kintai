import { describe, expect, it } from "vitest";
import { parsePushPayload, pushNotificationOptions } from "./pushPayload";
import { announcementIdFromHash } from "./announcementPushRoute";
const payload = { type: "announcement", instructionId: "post-1", eventId: "announcement-post-1", userId: "owner", locale: "ja", body: "private", title: "private" };
describe("notification payload and route", () => {
  it("uses only generic content in both languages and discards post content", () => {
    for (const locale of ["ja", "zh-CN"]) {
      const parsed = parsePushPayload({ ...payload, locale })!;
      expect(parsed).not.toHaveProperty("body");
      const rendered = pushNotificationOptions(parsed);
      expect(JSON.stringify(rendered)).not.toContain("private");
      expect(rendered.options.tag).toBe("announcement-post-1");
      expect(rendered.options.renotify).toBe(false);
      expect(rendered.options.data).toEqual({ instructionId: "post-1", userId: "owner" });
    }
  });
  it.each([{ instructionId: "../private" }, { eventId: "https://evil.example" }, { userId: "a/b" }, { type: "other" }, { instructionId: "" }])("rejects malformed payloads %j", change => {
    expect(parsePushPayload({ ...payload, ...change })).toBeNull();
  });
  it("accepts only a single opaque announcement ID in a link", () => {
    expect(announcementIdFromHash("#announcement=post-1")).toBe("post-1");
    for (const raw of ["#announcement=../private", "#announcement=https://evil.example", "#announcement=x&user=y", "#password-recovery=x"]) expect(announcementIdFromHash(raw)).toBeNull();
  });
});
