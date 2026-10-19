import { describe, expect, it } from "vitest";
import { reportDateJst, reportItemHash, reportLogs } from "./reportLink.js";
import type { TodoItem } from "./domain.js";

const item: TodoItem = { id: "a", title: "資料の確認", goal: "金曜までに確認", progress: 50, memo: "半分まで確認", sourceLocale: "ja", memoLocale: "ja", withdrawn: false };
describe("daily report transfer content", () => {
  it("uses Japan time across midnight and a year boundary", () => {
    expect(reportDateJst(Date.parse("2026-12-31T14:59:59Z"))).toBe("2026-12-31");
    expect(reportDateJst(Date.parse("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });
  it("preserves long text and emoji without exceeding the existing memo limit", () => {
    const long = { ...item, goal: "目標".repeat(1000), memo: "続報🙂".repeat(1000) };
    const logs = reportLogs("production", "a", "2026-10-19", "2026-10-19", long);
    expect(logs.length).toBeGreaterThan(1);
    expect(logs.every(log => log.text.length <= 1200)).toBe(true);
    const restored = logs.map(log => log.text.replace(/^【\d+\/\d+】\n/, "")).join("");
    expect(restored).toContain(long.goal); expect(restored).toContain(long.memo);
    for (const log of logs) expect(/\p{Surrogate}/u.test(log.text)).toBe(false);
  });
  it("normalizes surrounding whitespace and changes identities for another date or update", () => {
    expect(reportItemHash({ ...item, memo: " 半分まで確認 " })).toBe(reportItemHash(item));
    const first = reportLogs("production", "a", "2026-10-19", "2026-10-19", item)[0].id;
    expect(reportLogs("production", "a", "2026-10-19", "2026-10-20", item)[0].id).not.toBe(first);
    expect(reportLogs("production", "a", "2026-10-19", "2026-10-19", { ...item, progress: 100 })[0].id).not.toBe(first);
  });
});
