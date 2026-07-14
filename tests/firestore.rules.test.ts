import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { readFileSync } from "node:fs";

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-kintai-rules",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
    storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 }
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "attendance", "fang-record"), { userId: "fang", workDate: "2026-07-27" });
    await setDoc(doc(context.firestore(), "dailyReports", "manager-report"), { userId: "manager", reportDate: "2026-07-27" });
  });
});
afterAll(async () => env.cleanup());

describe("Firestore access control", () => {
  it("allows an employee to read only their own attendance", async () => {
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    const other = env.authenticatedContext("other", { role: "employee" }).firestore();
    await assertSucceeds(getDoc(doc(fang, "attendance", "fang-record")));
    await assertFails(getDoc(doc(other, "attendance", "fang-record")));
  });
  it("allows manager and president to read records", async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext("manager", { role: "employee_manager" }).firestore(), "attendance", "fang-record")));
    await assertSucceeds(getDoc(doc(env.authenticatedContext("president", { role: "president_viewer" }).firestore(), "attendance", "fang-record")));
  });
  it("denies all direct client writes including president writes", async () => {
    const president = env.authenticatedContext("president", { role: "president_viewer" }).firestore();
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    await assertFails(setDoc(doc(president, "dailyReports", "new"), { userId: "president" }));
    await assertFails(setDoc(doc(fang, "attendance", "new"), { userId: "fang" }));
  });
});

describe("Storage access control", () => {
  it("allows an employee to upload a valid own file and manager to read it", async () => {
    const fangStorage = env.authenticatedContext("fang", { role: "employee" }).storage();
    const object = ref(fangStorage, "reports/fang/report-1/photo.jpg");
    await assertSucceeds(uploadBytes(object, new Uint8Array([1, 2, 3]), { contentType: "image/jpeg" }));
    const managerStorage = env.authenticatedContext("manager", { role: "employee_manager" }).storage();
    await assertSucceeds(getBytes(ref(managerStorage, "reports/fang/report-1/photo.jpg")));
  });
  it("denies uploads to another employee path and executable content", async () => {
    const fangStorage = env.authenticatedContext("fang", { role: "employee" }).storage();
    await assertFails(uploadBytes(ref(fangStorage, "reports/other/report-1/photo.jpg"), new Uint8Array([1]), { contentType: "image/jpeg" }));
    await assertFails(uploadBytes(ref(fangStorage, "reports/fang/report-1/program.exe"), new Uint8Array([1]), { contentType: "application/octet-stream" }));
  });
  it("denies president uploads", async () => {
    const storage = env.authenticatedContext("president", { role: "president_viewer" }).storage();
    await assertFails(uploadBytes(ref(storage, "reports/president/report-1/photo.jpg"), new Uint8Array([1]), { contentType: "image/jpeg" }));
  });
});
