import { describe, expect, it } from "vitest";
import { elapsedMinutes, formatElapsed, monthRange, safeFilename, todayJst } from "./format";

describe("format helpers", () => {
  it("calculates unadjusted elapsed minutes", () => { expect(elapsedMinutes(new Date("2026-07-27T00:00:00Z"), new Date("2026-07-27T02:48:59Z"))).toBe(168); });
  it("labels Japanese and Chinese elapsed time", () => { expect(formatElapsed(168, "ja")).toBe("2時間48分"); expect(formatElapsed(168, "zh-CN")).toBe("2小时48分钟"); });
  it("calculates leap-month range", () => { expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" }); });
  it("formats the Japan date", () => { expect(todayJst(new Date("2026-07-26T16:00:00Z"))).toBe("2026-07-27"); });
  it("sanitizes uploaded file names", () => { expect(safeFilename("見積 書?.pdf")).toBe("見積_書_.pdf"); });
});
