import { describe, expect, it } from "vitest";
import { filterDemoScope, recordIsVisibleInDemoScope } from "./demo";
import type { DemoRecordMetadata, UserProfile } from "../types";

const manager: UserProfile = { uid: "manager", email: "m@example.jp", displayName: "管理", role: "employee_manager", locale: "ja", active: true };
const demoEmployee: UserProfile = { ...manager, uid: "demo", role: "employee", isDemo: true, demoDatasetId: "fang-demo-2026-06" };
type TestRecord = DemoRecordMetadata & { id: string };
const normal: TestRecord = { id: "normal" };
const demo: TestRecord = { id: "demo", isDemo: true, demoDatasetId: "fang-demo-2026-06" };
const otherDemo: TestRecord = { id: "other", isDemo: true, demoDatasetId: "other" };

describe("demo scope", () => {
  it("keeps demo rows out of the normal manager view", () => {
    expect(filterDemoScope([normal, demo], manager, false)).toEqual([normal]);
  });

  it("shows only demo rows when a manager enables demo mode", () => {
    expect(filterDemoScope([normal, demo], manager, true)).toEqual([demo]);
  });

  it("confines a demo employee to its own dataset", () => {
    expect(recordIsVisibleInDemoScope(demo, demoEmployee, false)).toBe(true);
    expect(recordIsVisibleInDemoScope(otherDemo, demoEmployee, false)).toBe(false);
    expect(recordIsVisibleInDemoScope(normal, demoEmployee, false)).toBe(false);
  });
});
