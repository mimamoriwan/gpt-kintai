import { describe, expect, it } from "vitest";
import { assertTimeRange, csvEscape, jstDate, reportInputSchema } from "./domain.js";

describe("report validation", () => {
  const base = {
    reportDate: "2026-07-27",
    sourceLanguage: "zh-CN",
    fields: { category: "product_discovery", area: "東京都", destinations: "食品会社", activities: "商品調査", findings: "候補を発見", nextPlan: "見積依頼" },
    attachments: []
  };
  it("accepts a valid bilingual report", () => { expect(reportInputSchema.parse(base).sourceLanguage).toBe("zh-CN"); });
  it("rejects non-http links", () => { expect(() => reportInputSchema.parse({ ...base, attachments: [{ id: "1", name: "bad", contentType: "text/uri-list", size: 0, linkUrl: "javascript:alert(1)" }] })).toThrow(); });
  it("requires a correction reason when supplied to be meaningful", () => { expect(() => reportInputSchema.parse({ ...base, correctionReason: "x" })).toThrow(); });
});

describe("time and export helpers", () => {
  it("uses Japan date boundaries", () => { expect(jstDate(new Date("2026-07-26T15:01:00Z"))).toBe("2026-07-27"); });
  it("rejects an end before start", () => { expect(() => assertTimeRange(new Date("2026-07-27T10:00:00Z"), new Date("2026-07-27T09:00:00Z"))).toThrow(); });
  it("escapes CSV values", () => { expect(csvEscape('A,"B"')).toBe('"A,""B"""'); });
});
