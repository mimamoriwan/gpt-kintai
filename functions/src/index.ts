import { createHash, randomBytes } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2";
import OpenAI from "openai";
import { z } from "zod";
import { assertTimeRange, csvEscape, jstDate, parseIsoDateTime, reportFieldsSchema, reportInputSchema, roles, workModes } from "./domain.js";

initializeApp();
setGlobalOptions({ region: "asia-northeast1", maxInstances: 5, memory: "256MiB" });

const firestore = getFirestore();
const openAIKey = defineSecret("OPENAI_API_KEY");
const managerRoles = new Set(["employee_manager"]);
const viewerRoles = new Set(["employee_manager", "president_viewer"]);
const callableOptions = { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" } as const;

type AuthContext = { uid: string; token: Record<string, unknown> };

function requireAuth(auth: AuthContext | undefined): AuthContext {
  if (!auth) throw new HttpsError("unauthenticated", "ログインが必要です。");
  return auth;
}

function roleOf(auth: AuthContext): string { return typeof auth.token.role === "string" ? auth.token.role : "employee"; }
function requireManager(auth: AuthContext): void { if (!managerRoles.has(roleOf(auth))) throw new HttpsError("permission-denied", "管理者権限が必要です。"); }
function requireViewer(auth: AuthContext): void { if (!viewerRoles.has(roleOf(auth))) throw new HttpsError("permission-denied", "閲覧権限が必要です。"); }

async function userProfile(uid: string) {
  const snapshot = await firestore.doc(`users/${uid}`).get();
  if (!snapshot.exists || snapshot.data()?.active === false) throw new HttpsError("permission-denied", "利用できないアカウントです。");
  return snapshot.data()!;
}

function toHttpsError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof z.ZodError) throw new HttpsError("invalid-argument", error.issues[0]?.message || "入力内容を確認してください。");
  const message = error instanceof Error ? error.message : "処理できませんでした。";
  throw new HttpsError("internal", message);
}

export const clockIn = onCall(callableOptions, async (request) => {
  try {
    const auth = requireAuth(request.auth);
    const input = z.object({ workMode: z.enum(workModes) }).parse(request.data);
    if (roleOf(auth) === "president_viewer") throw new HttpsError("permission-denied", "閲覧専用アカウントです。");
    const profile = await userProfile(auth.uid);
    const active = await firestore.collection("attendance").where("userId", "==", auth.uid).where("status", "==", "active").limit(1).get();
    if (!active.empty) throw new HttpsError("already-exists", "すでに始業中です。");
    const ref = firestore.collection("attendance").doc();
    const now = FieldValue.serverTimestamp();
    await ref.create({
      userId: auth.uid,
      userName: profile.displayName,
      workMode: input.workMode,
      workDate: jstDate(),
      status: "active",
      startedAt: now,
      corrected: false,
      needsReview: false,
      createdAt: now,
      updatedAt: now
    });
    return { id: ref.id };
  } catch (error) { return toHttpsError(error); }
});

export const clockOut = onCall(callableOptions, async (request) => {
  try {
    const auth = requireAuth(request.auth);
    const active = await firestore.collection("attendance").where("userId", "==", auth.uid).where("status", "==", "active").limit(2).get();
    if (active.empty) throw new HttpsError("not-found", "始業中の記録がありません。");
    if (active.size > 1) throw new HttpsError("failed-precondition", "複数の始業中記録があります。管理者へ連絡してください。");
    await active.docs[0].ref.update({ endedAt: FieldValue.serverTimestamp(), status: "completed", updatedAt: FieldValue.serverTimestamp() });
    return { id: active.docs[0].id };
  } catch (error) { return toHttpsError(error); }
});

export const correctAttendance = onCall(callableOptions, async (request) => {
  try {
    const auth = requireAuth(request.auth);
    const input = z.object({ id: z.string().min(1), startedAt: z.string(), endedAt: z.string().optional(), reason: z.string().min(3).max(500) }).parse(request.data);
    const ref = firestore.doc(`attendance/${input.id}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new HttpsError("not-found", "勤怠記録がありません。");
    const before = snapshot.data()!;
    if (before.userId !== auth.uid && !managerRoles.has(roleOf(auth))) throw new HttpsError("permission-denied", "この記録は修正できません。");
    const start = parseIsoDateTime(input.startedAt);
    const end = input.endedAt ? parseIsoDateTime(input.endedAt) : undefined;
    assertTimeRange(start, end);
    const after = { startedAt: Timestamp.fromDate(start), endedAt: end ? Timestamp.fromDate(end) : FieldValue.delete(), status: end ? "completed" : "active", corrected: true, correctionReason: input.reason, needsReview: true, reviewedAt: FieldValue.delete(), reviewedBy: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() };
    const batch = firestore.batch();
    batch.update(ref, after);
    const audit = firestore.collection("auditEvents").doc();
    batch.create(audit, { actorId: auth.uid, subjectUserId: before.userId, entityType: "attendance", entityId: input.id, action: "corrected", reason: input.reason, before: serializable(before), after: { startedAt: start.toISOString(), endedAt: end?.toISOString() }, createdAt: FieldValue.serverTimestamp() });
    await batch.commit();
    return { ok: true };
  } catch (error) { return toHttpsError(error); }
});

export const submitDailyReport = onCall({ ...callableOptions, secrets: [openAIKey], timeoutSeconds: 120 }, async (request) => {
  try {
    const auth = requireAuth(request.auth);
    if (roleOf(auth) === "president_viewer") throw new HttpsError("permission-denied", "閲覧専用アカウントです。");
    const input = reportInputSchema.parse(request.data);
    const profile = await userProfile(auth.uid);
    const ref = input.reportId ? firestore.doc(`dailyReports/${input.reportId}`) : firestore.collection("dailyReports").doc();
    const previous = await ref.get();
    if (previous.exists && previous.data()?.userId !== auth.uid) throw new HttpsError("permission-denied", "この日報は修正できません。");
    if (previous.exists && !input.correctionReason) throw new HttpsError("invalid-argument", "修正理由を入力してください。");
    const now = FieldValue.serverTimestamp();
    const revision = previous.exists ? Number(previous.data()?.revision || 1) + 1 : 1;
    const reviewStatus = previous.exists ? "needs_review" : auth.uid === profile.uid && roleOf(auth) === "employee_manager" ? "not_required" : "unreviewed";
    const base = {
      userId: auth.uid,
      userName: profile.displayName,
      reportDate: input.reportDate,
      sourceLanguage: input.sourceLanguage,
      ...input.fields,
      attachments: input.attachments,
      status: "submitted",
      reviewStatus,
      translationStatus: input.sourceLanguage === "ja" ? "not_required" : "pending",
      translationAttempts: previous.exists ? Number(previous.data()?.translationAttempts || 0) : 0,
      revision,
      submittedAt: now,
      updatedAt: now,
      ...(previous.exists ? {} : { createdAt: now })
    };
    const batch = firestore.batch();
    if (previous.exists) {
      const revisionRef = ref.collection("revisions").doc(String(previous.data()?.revision || 1).padStart(4, "0"));
      batch.create(revisionRef, { reportId: ref.id, revision: previous.data()?.revision || 1, before: serializable(previous.data()), reason: input.correctionReason, changedBy: auth.uid, changedAt: now });
      const audit = firestore.collection("auditEvents").doc();
      batch.create(audit, { actorId: auth.uid, subjectUserId: auth.uid, entityType: "daily_report", entityId: ref.id, action: "corrected", reason: input.correctionReason, createdAt: now });
    }
    batch.set(ref, base, { merge: true });
    await batch.commit();
    if (input.sourceLanguage === "zh-CN") {
      const translated = await translateAndUpdate(ref.id, auth.uid, input.fields).catch(async (error: unknown) => {
        await ref.update({ translationStatus: "failed", translationError: safeError(error), updatedAt: FieldValue.serverTimestamp() });
        return false;
      });
      return { id: ref.id, translationStatus: translated ? "completed" : "failed" };
    }
    return { id: ref.id, translationStatus: "not_required" };
  } catch (error) { return toHttpsError(error); }
});

export const retryReportTranslation = onCall({ ...callableOptions, secrets: [openAIKey], timeoutSeconds: 120 }, async (request) => {
  try {
    const auth = requireAuth(request.auth);
    const { reportId } = z.object({ reportId: z.string().min(1) }).parse(request.data);
    const ref = firestore.doc(`dailyReports/${reportId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new HttpsError("not-found", "日報がありません。");
    const report = snapshot.data()!;
    if (report.userId !== auth.uid && !managerRoles.has(roleOf(auth))) throw new HttpsError("permission-denied", "再実行できません。");
    if (Number(report.translationAttempts || 0) >= 5) throw new HttpsError("resource-exhausted", "この日報のAI実行上限に達しました。");
    await ref.update({ translationStatus: "pending", translationError: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    await translateAndUpdate(reportId, report.userId, reportFieldsSchema.parse(report));
    return { ok: true };
  } catch (error) { return toHttpsError(error); }
});

async function translateAndUpdate(reportId: string, uid: string, fields: z.infer<typeof reportFieldsSchema>): Promise<boolean> {
  const apiKey = openAIKey.value();
  if (!apiKey) throw new Error("OpenAI APIキーが設定されていません。");
  await firestore.doc(`dailyReports/${reportId}`).update({ translationAttempts: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: "gpt-5.6-luna",
    reasoning: { effort: "low" },
    safety_identifier: createHash("sha256").update(uid).digest("hex").slice(0, 32),
    input: [
      { role: "system", content: "Translate the supplied Chinese business report fields into natural, factual Japanese. Preserve company names, product names, quantities, uncertainty, and line breaks. Do not add facts. Return only a JSON object with keys area, destinations, activities, findings, nextPlan." },
      { role: "user", content: JSON.stringify(fields) }
    ]
  });
  const parsed = reportFieldsSchema.omit({ category: true }).parse(JSON.parse(response.output_text));
  await firestore.doc(`dailyReports/${reportId}`).update({ translatedFields: parsed, translationStatus: "completed", translationError: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
  return true;
}

export const markReviewed = onCall(callableOptions, async (request) => {
  try {
    const auth = requireAuth(request.auth); requireManager(auth);
    const input = z.object({ entityType: z.enum(["attendance", "daily_report"]), entityId: z.string().min(1) }).parse(request.data);
    const collectionName = input.entityType === "attendance" ? "attendance" : "dailyReports";
    const ref = firestore.doc(`${collectionName}/${input.entityId}`);
    if (!(await ref.get()).exists) throw new HttpsError("not-found", "記録がありません。");
    await ref.update({ ...(input.entityType === "attendance" ? { needsReview: false } : { reviewStatus: "reviewed" }), reviewedAt: FieldValue.serverTimestamp(), reviewedBy: auth.uid, updatedAt: FieldValue.serverTimestamp() });
    return { ok: true };
  } catch (error) { return toHttpsError(error); }
});

export const inviteUser = onCall(callableOptions, async (request) => {
  try {
    const auth = requireAuth(request.auth); requireManager(auth);
    const input = z.object({ email: z.string().email(), displayName: z.string().min(1).max(100), role: z.enum(roles), locale: z.enum(["ja", "zh-CN"]) }).parse(request.data);
    const temporaryPassword = `${randomBytes(18).toString("base64url")}A1!`;
    const user = await getAuth().createUser({ email: input.email, displayName: input.displayName, password: temporaryPassword, emailVerified: false });
    await getAuth().setCustomUserClaims(user.uid, { role: input.role });
    await firestore.doc(`users/${user.uid}`).set({ uid: user.uid, email: input.email, displayName: input.displayName, role: input.role, locale: input.locale, active: true, createdAt: FieldValue.serverTimestamp() });
    const resetLink = await getAuth().generatePasswordResetLink(input.email);
    return { uid: user.uid, resetLink };
  } catch (error) { return toHttpsError(error); }
});

export const setUserDisabled = onCall(callableOptions, async (request) => {
  try {
    const auth = requireAuth(request.auth); requireManager(auth);
    const input = z.object({ uid: z.string().min(1), disabled: z.boolean() }).parse(request.data);
    if (input.uid === auth.uid) throw new HttpsError("failed-precondition", "自分自身は無効化できません。");
    await getAuth().updateUser(input.uid, { disabled: input.disabled });
    await firestore.doc(`users/${input.uid}`).update({ active: !input.disabled, updatedAt: FieldValue.serverTimestamp() });
    return { ok: true };
  } catch (error) { return toHttpsError(error); }
});

export const saveCategory = onCall(callableOptions, async (request) => {
  try {
    const auth = requireAuth(request.auth); requireManager(auth);
    const input = z.object({ id: z.string().optional(), labelJa: z.string().min(1).max(80), labelZh: z.string().min(1).max(80), active: z.boolean().default(true), order: z.number().int().min(0).max(1000).default(100) }).parse(request.data);
    const ref = input.id ? firestore.doc(`categories/${input.id}`) : firestore.collection("categories").doc();
    await ref.set({ labelJa: input.labelJa, labelZh: input.labelZh, active: input.active, order: input.order, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { id: ref.id };
  } catch (error) { return toHttpsError(error); }
});

export const exportMonthlyBackup = onCall({ ...callableOptions, timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  try {
    const auth = requireAuth(request.auth); requireViewer(auth);
    const input = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), userId: z.string().optional() }).parse(request.data);
    let attendanceQuery: FirebaseFirestore.Query = firestore.collection("attendance").where("workDate", ">=", `${input.month}-01`).where("workDate", "<=", `${input.month}-31`);
    let reportQuery: FirebaseFirestore.Query = firestore.collection("dailyReports").where("reportDate", ">=", `${input.month}-01`).where("reportDate", "<=", `${input.month}-31`);
    if (input.userId) { attendanceQuery = attendanceQuery.where("userId", "==", input.userId); reportQuery = reportQuery.where("userId", "==", input.userId); }
    const [attendance, reports] = await Promise.all([attendanceQuery.get(), reportQuery.get()]);
    const attendanceRows = attendance.docs.map((doc) => ({ id: doc.id, ...serializable(doc.data()) }));
    const reportRows = reports.docs.map((doc) => ({ id: doc.id, ...serializable(doc.data()) }));
    const csvRows = [["種別","日付","氏名","勤務区分","始業","終業","カテゴリ","訪問先","業務内容","結果・気づき","修正回数"]];
    for (const row of attendanceRows) csvRows.push(["勤怠", row.workDate, row.userName, row.workMode, row.startedAt, row.endedAt || "", "", "", "", "", row.corrected ? "1" : "0"]);
    for (const row of reportRows) csvRows.push(["日報", row.reportDate, row.userName, "", "", "", row.category, row.destinations, row.activities, row.findings, String(Math.max(0, Number(row.revision) - 1))]);
    const attachmentRows = [["日付","氏名","ファイル名","種類","サイズ","保存先","リンク"]];
    for (const row of reportRows) for (const item of Array.isArray(row.attachments) ? row.attachments : []) attachmentRows.push([row.reportDate, row.userName, item.name, item.contentType, String(item.size), item.storagePath || "", item.linkUrl || ""]);
    return {
      json: JSON.stringify({ exportedAt: new Date().toISOString(), month: input.month, attendance: attendanceRows, dailyReports: reportRows }, null, 2),
      csv: "\uFEFF" + csvRows.map((row) => row.map(csvEscape).join(",")).join("\r\n"),
      manifest: "\uFEFF" + attachmentRows.map((row) => row.map(csvEscape).join(",")).join("\r\n")
    };
  } catch (error) { return toHttpsError(error); }
});

function serializable(value: any): any {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializable(item)]));
  return value;
}

function safeError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : "Translation failed"; }
