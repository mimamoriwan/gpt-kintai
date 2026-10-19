import { describe, expect, it } from "vitest";
import { addDays, mondayOf } from "./calendar";
describe("JST weekly calendar", () => {
  it.each([
    ["2026-10-18T14:59:59Z", "2026-10-12"],
    ["2026-10-18T15:00:00Z", "2026-10-19"],
    ["2026-10-23T15:00:00Z", "2026-10-19"],
    ["2026-01-01T00:00:00Z", "2025-12-29"]
  ])("uses Japanese midnight at %s", (now, expected) => expect(mondayOf(new Date(now))).toBe(expected));
  it("crosses month and year boundaries without local timezone offsets", () => { expect(addDays("2025-12-29", 6)).toBe("2026-01-04"); expect(addDays("2024-02-26", 4)).toBe("2024-03-01"); });
});
