import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
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
    const demoMetadata = { isDemo: true, demoDatasetId: "demo-set", seedVersion: "test" };
    await setDoc(doc(context.firestore(), "attendance", "fang-record"), { userId: "fang", workDate: "2026-07-27" });
    await setDoc(doc(context.firestore(), "users", "demo-fang"), {
      displayName: "方 蕊（デモ）",
      email: "non.ya0910+fang-demo@gmail.com",
      role: "employee",
      ...demoMetadata
    });
    await setDoc(doc(context.firestore(), "attendance", "demo-attendance"), {
      userId: "demo-fang",
      workDate: "2026-07-15",
      ...demoMetadata
    });
    await setDoc(doc(context.firestore(), "dailyReports", "demo-report"), {
      userId: "demo-fang",
      reportDate: "2026-07-15",
      ...demoMetadata
    });
    await setDoc(doc(context.firestore(), "workLogs", "demo-log"), {
      userId: "demo-fang",
      workDate: "2026-07-15",
      tagLabel: "商品発掘",
      text: "架空の商品候補を調査",
      ...demoMetadata
    });
    await setDoc(doc(context.firestore(), "users", "demo-fang", "workTags", "demo-tag"), {
      userId: "demo-fang",
      label: "商品発掘",
      active: true,
      order: 1,
      ...demoMetadata
    });
    await setDoc(doc(context.firestore(), "dailyReports", "manager-report"), { userId: "manager", reportDate: "2026-07-27" });
    await setDoc(doc(context.firestore(), "dailyReportAutomations", "fang_2026-07-27"), {
      userId: "fang",
      workDate: "2026-07-27",
      status: "blocked_no_memo",
      isDemo: false
    });
    await setDoc(doc(context.firestore(), "dailyReportAutomations", "other_2026-07-27"), {
      userId: "other",
      workDate: "2026-07-27",
      status: "failed",
      isDemo: false
    });
    await setDoc(doc(context.firestore(), "dailyReportAutomations", "demo-fang_2026-07-15"), {
      userId: "demo-fang",
      workDate: "2026-07-15",
      status: "created",
      ...demoMetadata
    });
    await setDoc(doc(context.firestore(), "presidentInstructions", "instruction-fang"), { authorId: "president", recipientIds: ["fang", "manager"], recipientStates: { fang: { status: "pending" }, manager: { status: "pending" } }, status: "active", isDemo: false });
    await setDoc(doc(context.firestore(), "presidentInstructions", "instruction-other"), { authorId: "president", recipientIds: ["other"], recipientStates: { other: { status: "pending" } }, status: "active", isDemo: false });
    await setDoc(doc(context.firestore(), "presidentInstructions", "instruction-by-fang"), { authorId: "fang", recipientIds: ["manager"], recipientStates: { manager: { status: "pending" } }, status: "active", isDemo: false });
    await setDoc(doc(context.firestore(), "presidentInstructions", "instruction-demo"), { authorId: "demo-president", recipientIds: ["demo-fang"], recipientStates: { "demo-fang": { status: "pending" } }, status: "active", ...demoMetadata });
    await setDoc(doc(context.firestore(), "workLogs", "fang-log"), { userId: "fang", workDate: "2026-07-27", tagLabel: "商品発掘", text: "商品を調査" });
    await setDoc(doc(context.firestore(), "companyHolidayOverrides", "2026-07-31"), { date: "2026-07-31", dayType: "company_holiday", label: "会社休業日" });
    await setDoc(doc(context.firestore(), "calendarEvents", "shared-event"), {
      date: "2026-08-03",
      title: "3人で定例会",
      participants: [{ userId: "fang", displayName: "方" }, { userId: "manager", displayName: "管理者" }, { userId: "president", displayName: "社長" }],
      createdBy: "manager",
      isDemo: false
    });
    await setDoc(doc(context.firestore(), "calendarEvents", "demo-event"), {
      date: "2026-08-03",
      title: "デモ予定",
      participants: [{ userId: "demo-fang", displayName: "方（デモ）" }],
      createdBy: "demo-fang",
      ...demoMetadata
    });
    await setDoc(doc(context.firestore(), "calendarMembers", "real-president"), { displayName: "社長", linkedUserId: "", active: true, order: 30, isDemo: false });
    await setDoc(doc(context.firestore(), "calendarMembers", "demo-president"), { displayName: "社長（デモ）", linkedUserId: "", active: true, order: 30, ...demoMetadata });
    await setDoc(doc(context.firestore(), "products", "product-1"), { name: "候補調味料", jan: "4901234567894", status: "new", isDemo: false });
    await setDoc(doc(context.firestore(), "products", "demo-product"), {
      name: "DEMO 架空香味ソース",
      jan: "4900000000016",
      status: "new",
      ...demoMetadata
    });
    await setDoc(doc(context.firestore(), "productObservations", "fang-observation"), { productId: "product-1", userId: "fang", reasonOriginal: "中国で人気が出そう", isDemo: false });
    await setDoc(doc(context.firestore(), "productObservations", "demo-observation"), {
      productId: "demo-product",
      userId: "demo-fang",
      reasonOriginal: "包装颜色很醒目",
      ...demoMetadata
    });
    await setDoc(doc(context.firestore(), "productObservations", "other-observation"), { productId: "product-1", userId: "other", reasonOriginal: "別の視点", isDemo: false });
    await setDoc(doc(context.firestore(), "productRevisions", "revision-1"), { productId: "product-1", changedBy: "manager", reason: "JAN訂正" });
    await setDoc(doc(context.firestore(), "dutyDefinitions", "market-research"), { title: "中国市場向け商品調査", active: true });
    await setDoc(doc(context.firestore(), "employmentBases", "fang"), { userId: "fang", dutyDefinitionIds: ["market-research"] });
    await setDoc(doc(context.firestore(), "employmentBases", "other"), { userId: "other", dutyDefinitionIds: [] });
    await setDoc(doc(context.firestore(), "sourceDocumentReferences", "reason-letter"), { title: "申請理由書", url: "https://drive.google.com/example" });
    await setDoc(doc(context.firestore(), "weeklyPlans", "fang_2026-07-27"), { userId: "fang", weekStart: "2026-07-27", status: "confirmed" });
    await setDoc(doc(context.firestore(), "weeklyPlans", "other_2026-07-27"), { userId: "other", weekStart: "2026-07-27", status: "confirmed" });
    await setDoc(doc(context.firestore(), "weeklyReports", "fang_2026-07-27"), { userId: "fang", weekStart: "2026-07-27", status: "finalized" });
    await setDoc(doc(context.firestore(), "weeklyMeetings", "fang_2026-07-27"), { userId: "fang", weekStart: "2026-07-27", finalized: true });
    await setDoc(doc(context.firestore(), "nonWorkingReasons", "fang_2026-07-30"), { userId: "fang", workDate: "2026-07-30", reasonType: "paid_leave" });
    await setDoc(doc(context.firestore(), "evidenceReferences", "fang-work"), { subjectUserId: "fang", visibility: "work", title: "商品調査資料" });
    await setDoc(doc(context.firestore(), "evidenceReferences", "fang-confidential"), { subjectUserId: "fang", visibility: "confidential", title: "雇用資料" });
    await setDoc(doc(context.firestore(), "evidenceReferences", "other-work"), { subjectUserId: "other", visibility: "work", title: "他人の資料" });
    await setDoc(doc(context.firestore(), "monthlyEvidencePackages", "fang_2026-07"), { userId: "fang", month: "2026-07", versions: [] });
    await setDoc(doc(context.firestore(), "renewalChecklists", "fang"), { userId: "fang", residenceExpiryDate: "2027-07-26" });
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

  it("limits announcements to their author, recipients, and matching demo scope", async () => {
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    const other = env.authenticatedContext("other", { role: "employee" }).firestore();
    const manager = env.authenticatedContext("manager", { role: "employee_manager" }).firestore();
    const president = env.authenticatedContext("president", { role: "president_viewer" }).firestore();
    const demoFang = env.authenticatedContext("demo-fang", { role: "employee", isDemo: true, demoDatasetId: "demo-set" }).firestore();
    await assertSucceeds(getDoc(doc(fang, "presidentInstructions", "instruction-fang")));
    await assertFails(getDoc(doc(other, "presidentInstructions", "instruction-fang")));
    await assertSucceeds(getDoc(doc(president, "presidentInstructions", "instruction-fang")));
    await assertFails(getDoc(doc(manager, "presidentInstructions", "instruction-other")));
    await assertSucceeds(getDoc(doc(fang, "presidentInstructions", "instruction-by-fang")));
    await assertSucceeds(getDoc(doc(manager, "presidentInstructions", "instruction-by-fang")));
    await assertFails(getDoc(doc(president, "presidentInstructions", "instruction-demo")));
    await assertSucceeds(getDoc(doc(demoFang, "presidentInstructions", "instruction-demo")));
    await assertSucceeds(getDocs(query(collection(fang, "presidentInstructions"), where("recipientIds", "array-contains", "fang"), where("isDemo", "==", false))));
    await assertSucceeds(getDocs(query(collection(president, "presidentInstructions"), where("authorId", "==", "president"), where("isDemo", "==", false))));
    await assertFails(setDoc(doc(president, "presidentInstructions", "direct-president"), { recipientIds: ["fang"], isDemo: false }));
    await assertFails(updateDoc(doc(fang, "presidentInstructions", "instruction-fang"), { status: "completed" }));
  });
  it("denies all direct client writes including president writes", async () => {
    const president = env.authenticatedContext("president", { role: "president_viewer" }).firestore();
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    await assertFails(setDoc(doc(president, "dailyReports", "new"), { userId: "president" }));
    await assertFails(setDoc(doc(fang, "attendance", "new"), { userId: "fang" }));
  });
  it("shows automatic-report state only to its owner and viewers while keeping it server-owned", async () => {
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    const other = env.authenticatedContext("other", { role: "employee" }).firestore();
    const manager = env.authenticatedContext("manager", { role: "employee_manager" }).firestore();
    const demoFang = env.authenticatedContext("demo-fang", { role: "employee", isDemo: true, demoDatasetId: "demo-set" }).firestore();

    await assertSucceeds(getDoc(doc(fang, "dailyReportAutomations", "fang_2026-07-27")));
    await assertFails(getDoc(doc(other, "dailyReportAutomations", "fang_2026-07-27")));
    await assertSucceeds(getDoc(doc(manager, "dailyReportAutomations", "fang_2026-07-27")));
    await assertFails(getDoc(doc(fang, "dailyReportAutomations", "demo-fang_2026-07-15")));
    await assertSucceeds(getDoc(doc(demoFang, "dailyReportAutomations", "demo-fang_2026-07-15")));
    await assertSucceeds(getDocs(query(collection(fang, "dailyReportAutomations"), where("userId", "==", "fang"))));
    await assertFails(setDoc(doc(fang, "dailyReportAutomations", "direct"), {
      userId: "fang",
      workDate: "2026-07-28",
      status: "created"
    }));
    await assertFails(updateDoc(doc(fang, "dailyReportAutomations", "fang_2026-07-27"), { status: "created" }));
  });
  it("keeps AI draft cache and generation counters server-only", async () => {
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    const manager = env.authenticatedContext("manager", { role: "employee_manager" }).firestore();
    const usageId = "fang_2026-07-25";
    await assertFails(getDoc(doc(fang, "aiDailyDraftUsage", usageId)));
    await assertFails(getDoc(doc(manager, "aiDailyDraftUsage", usageId)));
    await assertFails(setDoc(doc(fang, "aiDailyDraftUsage", usageId), { successfulGenerations: 0 }));
  });
  it("keeps normal and demo employee records in separate scopes", async () => {
    const normal = env.authenticatedContext("fang", { role: "employee" }).firestore();
    const demo = env.authenticatedContext("demo-fang", {
      role: "employee",
      isDemo: true,
      demoDatasetId: "demo-set"
    }).firestore();
    const wrongDemo = env.authenticatedContext("demo-fang", {
      role: "employee",
      isDemo: true,
      demoDatasetId: "another-demo-set"
    }).firestore();

    await assertFails(getDoc(doc(normal, "attendance", "demo-attendance")));
    await assertFails(getDoc(doc(normal, "products", "demo-product")));
    await assertSucceeds(getDoc(doc(demo, "attendance", "demo-attendance")));
    await assertSucceeds(getDoc(doc(demo, "dailyReports", "demo-report")));
    await assertSucceeds(getDoc(doc(demo, "products", "demo-product")));
    await assertSucceeds(getDoc(doc(demo, "productObservations", "demo-observation")));
    await assertFails(getDoc(doc(demo, "attendance", "fang-record")));
    await assertFails(getDoc(doc(demo, "products", "product-1")));
    await assertFails(getDoc(doc(wrongDemo, "attendance", "demo-attendance")));
    await assertFails(getDoc(doc(wrongDemo, "products", "demo-product")));
  });
  it("allows scope-aware shared product and observation lists", async () => {
    const normal = env.authenticatedContext("fang", { role: "employee" }).firestore();
    const demo = env.authenticatedContext("demo-fang", {
      role: "employee",
      isDemo: true,
      demoDatasetId: "demo-set"
    }).firestore();

    await assertSucceeds(getDocs(query(collection(normal, "products"), where("isDemo", "==", false))));
    await assertSucceeds(getDocs(query(
      collection(demo, "products"),
      where("isDemo", "==", true),
      where("demoDatasetId", "==", "demo-set")
    )));
    await assertFails(getDocs(query(collection(normal, "products"), where("isDemo", "==", true))));
    await assertFails(getDocs(query(collection(demo, "products"), where("isDemo", "==", false))));

    await assertSucceeds(getDocs(query(collection(demo, "attendance"), where("userId", "==", "demo-fang"))));
    await assertSucceeds(getDocs(query(collection(demo, "dailyReports"), where("userId", "==", "demo-fang"))));
    await assertSucceeds(getDocs(query(collection(demo, "workLogs"), where("userId", "==", "demo-fang"))));
    await assertSucceeds(getDocs(query(collection(normal, "productObservations"), where("isDemo", "==", false))));
    await assertSucceeds(getDocs(query(
      collection(demo, "productObservations"),
      where("isDemo", "==", true),
      where("demoDatasetId", "==", "demo-set")
    )));
  });
  it("requires exact demo metadata on employee-managed demo records", async () => {
    const demo = env.authenticatedContext("demo-fang", {
      role: "employee",
      isDemo: true,
      demoDatasetId: "demo-set"
    }).firestore();
    const metadata = { isDemo: true, demoDatasetId: "demo-set", seedVersion: "test" };

    await assertSucceeds(setDoc(doc(demo, "users", "demo-fang", "workTags", "new-demo-tag"), {
      userId: "demo-fang",
      label: "市場調査",
      active: true,
      order: 2,
      ...metadata
    }));
    await assertFails(setDoc(doc(demo, "users", "demo-fang", "workTags", "missing-demo-mark"), {
      userId: "demo-fang",
      label: "不正タグ",
      active: true,
      order: 3
    }));
    await assertSucceeds(setDoc(doc(demo, "workLogs", "new-demo-log"), {
      userId: "demo-fang",
      workDate: "2026-07-15",
      tagLabel: "市場調査",
      text: "架空の売場を確認",
      ...metadata
    }));
    await assertFails(setDoc(doc(demo, "workLogs", "wrong-demo-log"), {
      userId: "demo-fang",
      workDate: "2026-07-15",
      tagLabel: "市場調査",
      text: "別データセット",
      isDemo: true,
      demoDatasetId: "another-demo-set",
      seedVersion: "test"
    }));
  });
  it("allows viewers to inspect demo records without granting direct writes", async () => {
    const manager = env.authenticatedContext("manager", { role: "employee_manager" }).firestore();
    const president = env.authenticatedContext("president", { role: "president_viewer" }).firestore();
    await assertSucceeds(getDoc(doc(manager, "attendance", "demo-attendance")));
    await assertSucceeds(getDoc(doc(president, "products", "demo-product")));
    await assertFails(setDoc(doc(manager, "dailyReports", "demo-direct"), {
      userId: "demo-fang",
      isDemo: true,
      demoDatasetId: "demo-set"
    }));
    await assertFails(setDoc(doc(president, "products", "demo-direct"), {
      name: "不正な直接登録",
      isDemo: true,
      demoDatasetId: "demo-set"
    }));
  });
  it("shares the company calendar with signed-in users but denies every direct client write", async () => {
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    const manager = env.authenticatedContext("manager", { role: "employee_manager" }).firestore();
    const anonymous = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(fang, "companyHolidayOverrides", "2026-07-31")));
    await assertSucceeds(getDoc(doc(manager, "companyHolidayOverrides", "2026-07-31")));
    await assertFails(getDoc(doc(anonymous, "companyHolidayOverrides", "2026-07-31")));
    await assertFails(setDoc(doc(fang, "companyHolidayOverrides", "2026-08-03"), { date: "2026-08-03", dayType: "company_holiday" }));
    await assertFails(setDoc(doc(manager, "companyHolidayOverrides", "2026-08-03"), { date: "2026-08-03", dayType: "company_holiday" }));
  });
  it("shares work events only inside the matching data scope and denies direct writes", async () => {
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    const manager = env.authenticatedContext("manager", { role: "employee_manager" }).firestore();
    const president = env.authenticatedContext("president", { role: "president_viewer" }).firestore();
    const demo = env.authenticatedContext("demo-fang", { role: "employee", isDemo: true, demoDatasetId: "demo-set" }).firestore();
    const wrongDemo = env.authenticatedContext("demo-fang", { role: "employee", isDemo: true, demoDatasetId: "wrong-set" }).firestore();
    const anonymous = env.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(fang, "calendarEvents", "shared-event")));
    await assertSucceeds(getDoc(doc(manager, "calendarEvents", "shared-event")));
    await assertSucceeds(getDoc(doc(president, "calendarEvents", "shared-event")));
    await assertFails(getDoc(doc(anonymous, "calendarEvents", "shared-event")));
    await assertFails(getDoc(doc(fang, "calendarEvents", "demo-event")));
    await assertSucceeds(getDoc(doc(demo, "calendarEvents", "demo-event")));
    await assertFails(getDoc(doc(demo, "calendarEvents", "shared-event")));
    await assertFails(getDoc(doc(wrongDemo, "calendarEvents", "demo-event")));

    await assertSucceeds(getDocs(query(
      collection(fang, "calendarEvents"),
      where("isDemo", "==", false),
      where("date", ">=", "2026-07-27"),
      where("date", "<=", "2026-09-06")
    )));
    await assertSucceeds(getDocs(query(
      collection(demo, "calendarEvents"),
      where("isDemo", "==", true),
      where("demoDatasetId", "==", "demo-set"),
      where("date", ">=", "2026-07-27"),
      where("date", "<=", "2026-09-06")
    )));
    await assertFails(setDoc(doc(fang, "calendarEvents", "direct"), { date: "2026-08-04", title: "直接登録", isDemo: false }));
    await assertFails(updateDoc(doc(manager, "calendarEvents", "shared-event"), { title: "直接変更" }));
    await assertFails(deleteDoc(doc(president, "calendarEvents", "shared-event")));
    await assertFails(getDoc(doc(fang, "calendarMembers", "real-president")));
    await assertFails(getDoc(doc(manager, "calendarMembers", "real-president")));
    await assertFails(getDoc(doc(demo, "calendarMembers", "demo-president")));
    await assertFails(setDoc(doc(manager, "calendarMembers", "direct"), { displayName: "直接登録" }));
  });
  it("allows employees to manage only their own personal tags and work logs", async () => {
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    const other = env.authenticatedContext("other", { role: "employee" }).firestore();
    await assertSucceeds(setDoc(doc(fang, "users", "fang", "workTags", "custom"), { userId: "fang", label: "食品卸", active: true, order: 1 }));
    await assertFails(setDoc(doc(other, "users", "fang", "workTags", "bad"), { userId: "other", label: "不正", active: true, order: 2 }));
    const ownLog = await assertSucceeds(addDoc(collection(fang, "workLogs"), {
      userId: "fang",
      workDate: "2026-07-27",
      tagLabel: "食品卸",
      text: "候補商品を確認",
      attachments: [{ id: "file-1", name: "見積書.pdf", size: 1000, storagePath: "reports/fang/work-log/file.pdf" }]
    }));
    await assertFails(addDoc(collection(fang, "workLogs"), {
      userId: "fang",
      workDate: "2026-07-27",
      tagLabel: "食品卸",
      text: "添付件数が多すぎる記録",
      attachments: Array.from({ length: 6 }, (_, index) => ({ id: `file-${index}`, name: `${index}.pdf` }))
    }));
    await assertSucceeds(updateDoc(ownLog, { text: "候補商品を確認し、条件を追記", updatedAt: new Date() }));
    await assertFails(updateDoc(ownLog, { userId: "other", text: "所有者を変更" }));
    await assertFails(updateDoc(doc(other, "workLogs", ownLog.id), { text: "他人による変更" }));
    await assertSucceeds(deleteDoc(ownLog));
    await assertFails(deleteDoc(doc(other, "workLogs", "fang-log")));
    await assertSucceeds(getDocs(query(collection(fang, "workLogs"), where("userId", "==", "fang"), where("workDate", "==", "2026-07-27"))));
  });

  it("shares product facts and observations within the same company data scope", async () => {
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    const other = env.authenticatedContext("other", { role: "employee" }).firestore();
    const manager = env.authenticatedContext("manager", { role: "employee_manager" }).firestore();
    const president = env.authenticatedContext("president", { role: "president_viewer" }).firestore();
    const anonymous = env.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(fang, "products", "product-1")));
    await assertSucceeds(getDoc(doc(other, "products", "product-1")));
    await assertFails(getDoc(doc(anonymous, "products", "product-1")));
    await assertSucceeds(getDoc(doc(fang, "productObservations", "fang-observation")));
    await assertSucceeds(getDoc(doc(fang, "productObservations", "other-observation")));
    await assertSucceeds(getDoc(doc(other, "productObservations", "fang-observation")));
    await assertSucceeds(getDoc(doc(manager, "productObservations", "other-observation")));
    await assertSucceeds(getDoc(doc(president, "productObservations", "other-observation")));
  });

  it("keeps product revisions manager-only and denies all direct product writes", async () => {
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    const manager = env.authenticatedContext("manager", { role: "employee_manager" }).firestore();
    const president = env.authenticatedContext("president", { role: "president_viewer" }).firestore();

    await assertFails(getDoc(doc(fang, "productRevisions", "revision-1")));
    await assertSucceeds(getDoc(doc(manager, "productRevisions", "revision-1")));
    await assertSucceeds(getDoc(doc(president, "productRevisions", "revision-1")));
    await assertFails(setDoc(doc(fang, "products", "bad"), { name: "不正" }));
    await assertFails(setDoc(doc(manager, "products", "bad"), { name: "直接変更" }));
    await assertFails(setDoc(doc(president, "products", "bad"), { name: "社長変更" }));
  });

  it("lets employees read only their own weekly and monthly workflow records", async () => {
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    await assertSucceeds(getDoc(doc(fang, "weeklyPlans", "fang_2026-07-27")));
    await assertFails(getDoc(doc(fang, "weeklyPlans", "other_2026-07-27")));
    await assertSucceeds(getDoc(doc(fang, "weeklyReports", "fang_2026-07-27")));
    await assertSucceeds(getDoc(doc(fang, "weeklyMeetings", "fang_2026-07-27")));
    await assertSucceeds(getDoc(doc(fang, "nonWorkingReasons", "fang_2026-07-30")));
    await assertSucceeds(getDoc(doc(fang, "monthlyEvidencePackages", "fang_2026-07")));
  });

  it("separates work evidence from confidential employment and renewal records", async () => {
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    const manager = env.authenticatedContext("manager", { role: "employee_manager" }).firestore();
    const president = env.authenticatedContext("president", { role: "president_viewer" }).firestore();

    await assertSucceeds(getDoc(doc(fang, "dutyDefinitions", "market-research")));
    await assertSucceeds(getDoc(doc(fang, "employmentBases", "fang")));
    await assertFails(getDoc(doc(fang, "employmentBases", "other")));
    await assertSucceeds(getDoc(doc(fang, "evidenceReferences", "fang-work")));
    await assertFails(getDoc(doc(fang, "evidenceReferences", "fang-confidential")));
    await assertFails(getDoc(doc(fang, "evidenceReferences", "other-work")));
    await assertFails(getDoc(doc(fang, "sourceDocumentReferences", "reason-letter")));
    await assertFails(getDoc(doc(fang, "renewalChecklists", "fang")));

    await assertSucceeds(getDoc(doc(manager, "sourceDocumentReferences", "reason-letter")));
    await assertSucceeds(getDoc(doc(manager, "renewalChecklists", "fang")));
    await assertSucceeds(getDoc(doc(president, "sourceDocumentReferences", "reason-letter")));
    await assertFails(getDoc(doc(president, "renewalChecklists", "fang")));
  });

  it("keeps workflow writes on validated server functions for all three roles", async () => {
    const fang = env.authenticatedContext("fang", { role: "employee" }).firestore();
    const manager = env.authenticatedContext("manager", { role: "employee_manager" }).firestore();
    const president = env.authenticatedContext("president", { role: "president_viewer" }).firestore();
    await assertFails(setDoc(doc(fang, "weeklyPlans", "direct"), { userId: "fang" }));
    await assertFails(setDoc(doc(manager, "weeklyReports", "direct"), { userId: "fang" }));
    await assertFails(setDoc(doc(president, "evidenceReferences", "direct"), { subjectUserId: "president" }));
    await assertFails(setDoc(doc(manager, "renewalChecklists", "direct"), { userId: "fang" }));
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

  it("allows every signed-in author to attach files that only the author and recipients can read", async () => {
    const presidentStorage = env.authenticatedContext("president", { role: "president_viewer" }).storage();
    const path = "president-instructions/instruction-fang/president/72211f85-file.pdf";
    await assertSucceeds(uploadBytes(ref(presidentStorage, path), new Uint8Array([0x25, 0x50, 0x44, 0x46]), { contentType: "application/pdf" }));

    const fangStorage = env.authenticatedContext("fang", { role: "employee" }).storage();
    const otherStorage = env.authenticatedContext("other", { role: "employee" }).storage();
    const managerStorage = env.authenticatedContext("manager", { role: "employee_manager" }).storage();
    await assertSucceeds(getBytes(ref(fangStorage, path)));
    await assertSucceeds(getBytes(ref(managerStorage, path)));
    await assertFails(getBytes(ref(otherStorage, path)));
    await assertSucceeds(uploadBytes(ref(fangStorage, "president-instructions/new-announcement/fang/employee-file.pdf"), new Uint8Array([0x25, 0x50, 0x44, 0x46]), { contentType: "application/pdf" }));
    await assertFails(uploadBytes(ref(fangStorage, "president-instructions/new-announcement/other/not-allowed.pdf"), new Uint8Array([1]), { contentType: "application/pdf" }));
  });

  it("keeps demo instruction attachments inside their matching dataset", async () => {
    const demoPresidentStorage = env.authenticatedContext("demo-president", { role: "president_viewer", isDemo: true, demoDatasetId: "demo-set" }).storage();
    const path = "demo/demo-set/president-instructions/instruction-demo/demo-president/72211f85-file.pdf";
    await assertSucceeds(uploadBytes(ref(demoPresidentStorage, path), new Uint8Array([0x25, 0x50, 0x44, 0x46]), { contentType: "application/pdf" }));

    const demoFangStorage = env.authenticatedContext("demo-fang", { role: "employee", isDemo: true, demoDatasetId: "demo-set" }).storage();
    const wrongDemoStorage = env.authenticatedContext("demo-fang", { role: "employee", isDemo: true, demoDatasetId: "another-demo-set" }).storage();
    const normalPresidentStorage = env.authenticatedContext("president", { role: "president_viewer" }).storage();
    await assertSucceeds(getBytes(ref(demoFangStorage, path)));
    await assertSucceeds(uploadBytes(ref(demoFangStorage, "demo/demo-set/president-instructions/new-announcement/demo-fang/employee-file.pdf"), new Uint8Array([0x25, 0x50, 0x44, 0x46]), { contentType: "application/pdf" }));
    await assertFails(getBytes(ref(wrongDemoStorage, path)));
    await assertFails(getBytes(ref(normalPresidentStorage, path)));
  });

  it("allows only the owner to upload product JPEGs and all normal users to read them", async () => {
    const fangStorage = env.authenticatedContext("fang", { role: "employee" }).storage();
    const path = "products/fang/observation-1/front-photo.jpg";
    await assertSucceeds(uploadBytes(ref(fangStorage, path), new Uint8Array([1, 2, 3]), { contentType: "image/jpeg" }));

    const otherStorage = env.authenticatedContext("other", { role: "employee" }).storage();
    const managerStorage = env.authenticatedContext("manager", { role: "employee_manager" }).storage();
    const presidentStorage = env.authenticatedContext("president", { role: "president_viewer" }).storage();
    await assertSucceeds(getBytes(ref(otherStorage, path)));
    await assertSucceeds(getBytes(ref(managerStorage, path)));
    await assertSucceeds(getBytes(ref(presidentStorage, path)));
    await assertFails(uploadBytes(ref(fangStorage, "products/other/observation-1/front.jpg"), new Uint8Array([1]), { contentType: "image/jpeg" }));
    await assertFails(uploadBytes(ref(fangStorage, "products/fang/observation-1/front.png"), new Uint8Array([1]), { contentType: "image/png" }));
  });

  it("rejects product images over one megabyte", async () => {
    const fangStorage = env.authenticatedContext("fang", { role: "employee" }).storage();
    await assertFails(uploadBytes(
      ref(fangStorage, "products/fang/observation-large/front.jpg"),
      new Uint8Array(1024 * 1024 + 1),
      { contentType: "image/jpeg" }
    ));
  });

  it("separates normal and demo storage paths", async () => {
    const normalStorage = env.authenticatedContext("fang", { role: "employee" }).storage();
    const demoStorage = env.authenticatedContext("demo-fang", {
      role: "employee",
      isDemo: true,
      demoDatasetId: "demo-set"
    }).storage();
    const wrongDemoStorage = env.authenticatedContext("demo-fang", {
      role: "employee",
      isDemo: true,
      demoDatasetId: "another-demo-set"
    }).storage();
    const reportPath = "demo/demo-set/reports/demo-fang/report-1/photo.jpg";
    const productPath = "demo/demo-set/products/demo-fang/observation-1/front.jpg";

    await assertSucceeds(uploadBytes(ref(demoStorage, reportPath), new Uint8Array([1, 2]), { contentType: "image/jpeg" }));
    await assertSucceeds(uploadBytes(ref(demoStorage, productPath), new Uint8Array([1, 2]), { contentType: "image/jpeg" }));
    await assertSucceeds(getBytes(ref(demoStorage, reportPath)));
    await assertFails(getBytes(ref(normalStorage, reportPath)));
    await assertFails(getBytes(ref(wrongDemoStorage, reportPath)));
    await assertFails(uploadBytes(ref(demoStorage, "reports/demo-fang/report-2/photo.jpg"), new Uint8Array([1]), { contentType: "image/jpeg" }));
    await assertFails(uploadBytes(
      ref(demoStorage, "demo/another-demo-set/reports/demo-fang/report-2/photo.jpg"),
      new Uint8Array([1]),
      { contentType: "image/jpeg" }
    ));
  });

  it("lets viewers read demo files but keeps the president read-only", async () => {
    const demoStorage = env.authenticatedContext("demo-fang", {
      role: "employee",
      isDemo: true,
      demoDatasetId: "demo-set"
    }).storage();
    const path = "demo/demo-set/products/demo-fang/observation-2/front.jpg";
    await assertSucceeds(uploadBytes(ref(demoStorage, path), new Uint8Array([1]), { contentType: "image/jpeg" }));

    const managerStorage = env.authenticatedContext("manager", { role: "employee_manager" }).storage();
    const presidentStorage = env.authenticatedContext("president", { role: "president_viewer" }).storage();
    await assertSucceeds(getBytes(ref(managerStorage, path)));
    await assertSucceeds(getBytes(ref(presidentStorage, path)));
    await assertFails(uploadBytes(
      ref(presidentStorage, "demo/demo-set/products/president/observation-1/front.jpg"),
      new Uint8Array([1]),
      { contentType: "image/jpeg" }
    ));
  });
});
