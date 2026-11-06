import { beforeEach, describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { collectEvidence } from "./collect.js";
import type { Input } from "./domain.js";
type Row = Record<string, any>;
class Database {
  data = new Map<string, Row>(); reads: string[] = [];
  doc(path: string): any { return { get: async () => { this.reads.push(path); return { data: () => this.data.get(path) }; } }; }
  collection(name: string): any {
    const filters: [string, string, any][] = []; let max = Infinity;
    const q = { where: (key: string, op: string, value: any) => { filters.push([key, op, value]); return q; }, limit: (n: number) => { max = n; return q; }, get: async () => {
      this.reads.push(name);
      const docs = [...this.data].filter(([path, row]) => path.startsWith(name + "/") && filters.every(([key, op, value]) => { const actual = key.split(".").reduce((v, k) => v?.[k], row); return op === "==" ? actual === value : op === ">=" ? actual >= value : actual <= value; })).slice(0, max).map(([path, row]) => ({ id: path.split("/").at(-1), data: () => row }));
      return { docs, size: docs.length };
    } }; return q;
  }
}
const input: Input = { periodStart: "2026-10-01", periodEnd: "2026-10-28", userId: "", locale: "ja", sources: { daily: true, business: true, todo: true } };
const at = (date = "2026-10-02") => Date.parse(date + "T10:00:00+09:00");
let db: Database;
const collect = (i = input) => collectEvidence(db as unknown as Firestore, i, "owner", true);
beforeEach(() => {
  db = new Database();
  db.data.set("users/owner", { role: "employee_manager", active: true, displayName: "担当" });
  db.data.set("users/president", { role: "president_viewer", active: true, displayName: "社長" });
  db.data.set("businessSettings/company", { enabled: true, memberIds: ["owner", "president"] });
  db.data.set("dailyReports/real", { userId: "owner", userName: "担当", reportDate: "2026-10-02", status: "submitted", activities: "日報の最終文。", translatedFields: { findings: "翻訳済み所見" } });
  db.data.set("businessUpdates/post", { scopeId: "company", createdAt: at(), authorId: "president", authorName: "社長", initiativeId: "project", body: "社長が調達判断を投稿した。" });
  db.data.set("businessHistory/event", { scopeId: "company", createdAt: at(), actorId: "president", actorName: "社長", entityType: "initiative", entityId: "project", action: "status", before: { status: "in_progress" }, after: { name: "調達", status: "on_hold", milestones: [{ name: "見積り", completed: false }] } });
  db.data.set("weeklyTodoHistory/shared", { scopeId: "production", userId: "president", weekStart: "2026-09-28", kind: "review", snapshot: { at: at(), revision: 1, items: [{ id: "task", title: "見積り", goal: "見積りを取得", progress: 30, memo: "未着" }] } });
  db.data.set("weeklyTodoWeeks/private", { draft: { items: [{ memo: "PRIVATE DRAFT" }] } });
});
describe("period-specific multi-source collection", () => {
  it("includes the president without a daily report and never reads private draft storage", async () => {
    const result = await collect({ ...input, userId: "president" });
    expect(result.sources.map(s => s.kind)).toEqual(["business", "business", "todo"]);
    expect(JSON.stringify(result)).toContain("社長が調達判断を投稿した。");
    expect(result.sources.find(s => s.kind === "todo")?.progress).toBe(30);
    expect(db.reads.some(path => path.startsWith("weeklyTodoWeeks"))).toBe(false); expect(JSON.stringify(result)).not.toContain("PRIVATE DRAFT");
  });
  it("filters demo, unsubmitted, out-of-range and other-person records, preserving full text", async () => {
    const base = db.data.get("dailyReports/real")!;
    db.data.set("dailyReports/demo", { ...base, isDemo: true, activities: "DEMO" });
    db.data.set("dailyReports/draft", { ...base, status: "draft", activities: "DRAFT" });
    db.data.set("dailyReports/old", { ...base, reportDate: "2026-09-30", activities: "OLD" });
    db.data.set("dailyReports/other", { ...base, userId: "other", activities: "OTHER" });
    db.data.set("businessUpdates/future", { ...db.data.get("businessUpdates/post"), createdAt: at("2026-10-29"), body: "FUTURE" });
    const result = await collect({ ...input, userId: "owner" });
    expect(result.sources).toHaveLength(1); expect(result.sources[0].activities).toBe("日報の最終文。"); expect(result.sources[0].findings).toBe("翻訳済み所見");
    expect(JSON.stringify(await collect())).not.toMatch(/DEMO|DRAFT|OLD|FUTURE/);
  });
  it("uses immutable state at the recorded event instead of today's initiative state", async () => {
    db.data.set("businessInitiatives/project", { name: "FUTURE NAME", status: "completed", milestones: [{ completed: true }] });
    const result = await collect();
    const event = result.sources.find(s => s.recordId === "B:H:event")!;
    expect(event.findings).toContain('"statusAtEvent":"on_hold"'); expect(event.findings).toContain('"completed":false');
    expect(JSON.stringify(result)).not.toContain("FUTURE NAME"); expect(db.reads).not.toContain("businessInitiatives");
  });
  it("includes company theme edits while excluding settings history and other demo scopes", async () => {
    const event = db.data.get("businessHistory/event")!;
    db.data.set("businessHistory/theme", { ...event, entityType: "theme", entityId: "theme-a", after: { name: "来月の準備", description: "目標の整理" } });
    db.data.set("businessHistory/settings", { ...event, entityType: "settings", after: { memberIds: ["SECRET MEMBER IDS"] } });
    db.data.set("businessHistory/demo", { ...event, scopeId: "demo_other", after: { name: "DEMO ONLY" } });
    const result = await collect();
    expect(result.sources.some(s => s.category === "来月の準備")).toBe(true); expect(JSON.stringify(result)).not.toMatch(/SECRET MEMBER IDS|DEMO ONLY/);
  });
  it("combines revisions within each To Do and retains intermediate facts and withdrawal", async () => {
    const old = db.data.get("weeklyTodoHistory/shared")!;
    db.data.set("weeklyTodoHistory/later", { ...old, snapshot: { at: at("2026-10-09"), revision: 2, items: [{ id: "task", title: "見積り", goal: "取得", progress: 40, memo: "取り下げ", withdrawn: true }] } });
    const result = await collect(); const todo = result.sources.find(s => s.kind === "todo")!;
    expect(todo.activities).toContain("2026-10-02"); expect(todo.activities).toContain("2026-10-09"); expect(todo.activities).toContain("未着"); expect(todo.progress).toBeUndefined(); expect(todo.findings).toContain("取り下げ");
  });
  it("fails explicitly if a selected source is unavailable, rather than silently omitting it", async () => {
    db.data.set("businessSettings/company", { enabled: false, memberIds: ["owner"] });
    await expect(collect()).rejects.toMatchObject({ code: "failed-precondition" });
    expect((await collect({ ...input, sources: { daily: true, business: false, todo: false } })).sources).toHaveLength(1);
  });
  it("rejects demo subjects and an empty result or empty source selection", async () => {
    db.data.set("users/demo", { role: "employee", isDemo: true });
    await expect(collect({ ...input, userId: "demo" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(collect({ ...input, sources: { daily: false, business: false, todo: false } })).rejects.toMatchObject({ code: "invalid-argument" });
    db.data.clear(); await expect(collect({ ...input, sources: { daily: true, business: false, todo: false } })).rejects.toMatchObject({ code: "not-found" });
  });
});
