import { describe, expect, it } from "vitest";
import { contentVersion, initiativeInput, mergeMilestones, scopeOf } from "./domain.js";

const step = (index: number, archived = false) => ({ id: `s${index}`, name: `節目${index}`, order: index, archived });
const input = { id: "work", expectedVersion: 0, name: "販売基盤", description: "説明", sourceLocale: "ja", referenceLinks: [], themeId: "theme", assigneeIds: [], status: "not_started", plannedStartMonth: "", plannedEndMonth: "", targetMemo: "9月末", milestones: [step(1)] };
describe("business input and content revisions", () => {
  it("requires 1–3 active milestones while retaining archived entries within a 100-entry total limit", () => {
    expect(() => initiativeInput.parse({ ...input, milestones: [] })).toThrow(/有効な節目/);
    expect(() => initiativeInput.parse({ ...input, milestones: [step(1, true)] })).toThrow(/有効な節目/);
    expect(initiativeInput.parse({ ...input, milestones: [step(1)] }).milestones).toHaveLength(1);
    expect(initiativeInput.parse({ ...input, milestones: [step(1), step(2), step(3)] }).milestones).toHaveLength(3);
    expect(() => initiativeInput.parse({ ...input, milestones: [step(1), step(2), step(3), step(4)] })).toThrow(/有効な節目/);
    expect(initiativeInput.parse({ ...input, milestones: [step(1), step(2), step(3), step(4, true)] }).milestones).toHaveLength(4);
    expect(initiativeInput.parse({ ...input, milestones: Array.from({ length: 100 }, (_, index) => step(index, index > 0)) }).milestones).toHaveLength(100);
    expect(() => initiativeInput.parse({ ...input, milestones: Array.from({ length: 101 }, (_, index) => step(index, index > 0)) })).toThrow();
  });
  it.each([["", ""], ["2026-09", "2026-09"], ["2026-12", "2027-02"]])("accepts optional, one-month and year-crossing periods: %s–%s", (start, end) => {
    expect(initiativeInput.parse({ ...input, plannedStartMonth: start, plannedEndMonth: end }).targetMemo).toBe("9月末");
  });
  it.each([["2026-09", ""], ["", "2026-10"], ["2026-10", "2026-09"], ["2026-13", "2027-02"], ["2026-9", "2027-02"]])("rejects invalid period %s–%s", (start, end) => {
    expect(() => initiativeInput.parse({ ...input, plannedStartMonth: start, plannedEndMonth: end })).toThrow();
  });
  it("rejects unsafe links, slash identifiers, duplicate milestones and injected completion", () => {
    expect(() => initiativeInput.parse({ ...input, id: "a/b" })).toThrow();
    expect(() => initiativeInput.parse({ ...input, referenceLinks: ["javascript:alert(1)"] })).toThrow();
    const step = { id: "s1", name: "節目", order: 0, archived: false };
    expect(() => initiativeInput.parse({ ...input, milestones: [step, step] })).toThrow();
    expect(() => initiativeInput.parse({ ...input, milestones: [{ ...step, completed: true }] })).toThrow();
  });
  it("preserves milestone identity and completion across reorder/rename, forbids deletion", () => {
    const before = [{ id: "a", name: "A", order: 0, archived: false, completed: true, updatedAt: 1, updatedBy: "president" }, { id: "b", name: "B", order: 1, archived: false, completed: false, updatedAt: 1, updatedBy: "manager" }];
    const result = mergeMilestones([{ id: "b", name: "新B", order: 0, archived: false }, { id: "a", name: "A", order: 1, archived: true }], before, "manager", 2);
    expect(result[0].completed).toBe(false);
    expect(result[1].completed).toBe(true);
    expect(result[1].archived).toBe(true);
    expect(() => mergeMilestones([], before, "manager", 2)).toThrow(/アーカイブ/);
  });
  it("only translatable source changes invalidate cached translations", () => {
    const row = { ...input, milestones: [{ id: "a", name: "A", order: 0, archived: false, completed: false }, { id: "b", name: "B", order: 1, archived: false, completed: false }] };
    const hash = contentVersion("initiative", row);
    expect(contentVersion("initiative", { ...row, status: "completed", plannedStartMonth: "2026-10", milestones: [{ ...row.milestones[1], order: 0, archived: true }, { ...row.milestones[0], order: 1, completed: true }] })).toBe(hash);
    expect(contentVersion("initiative", { ...row, name: "新名称" })).not.toBe(hash);
    expect(contentVersion("initiative", { ...row, milestones: [{ ...row.milestones[0], name: "新節目" }, row.milestones[1]] })).not.toBe(hash);
  });
  it("separates demo datasets while keeping normal accounts together", () => {
    expect(scopeOf({ company: "CBC麻布台" })).toBe(scopeOf({ company: "CBC寧遠" }));
    expect(scopeOf({ isDemo: true, demoDatasetId: "one" })).not.toBe(scopeOf({ isDemo: true, demoDatasetId: "two" }));
    expect(() => scopeOf({ isDemo: true })).toThrow();
  });
});
