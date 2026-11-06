import { randomUUID } from "node:crypto";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import OpenAI from "openai";
import { z } from "zod";
import { error as logError } from "firebase-functions/logger";
import { getAccountManagement } from "../accountRecovery.js";
import { BriefValidationError, inputSchema, MODEL, type Progress } from "./domain.js";
import { collectEvidence } from "./collect.js";
import { generateBrief } from "./pipeline.js";
import { createMeetingAsk } from "./openai.js";
import { deadline, FUNCTION_TIMEOUT_SECONDS, LEASE_TIMEOUT_MS, WORK_TIMEOUT_MS } from "./limits.js";

const key = defineSecret("OPENAI_API_KEY");
export const generateMeetingResume = onCall({
  region: "asia-northeast1", maxInstances: 1, concurrency: 5, memory: "1GiB", timeoutSeconds: FUNCTION_TIMEOUT_SECONDS,
  invoker: "public", enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true", secrets: [key]
}, async (request, response) => {
  const db = getFirestore(), auth = getAuth();
  const authorize = async () => {
    const result = await getAccountManagement(request.auth, {}, { db, auth });
    if (!result.canManage) throw new HttpsError("permission-denied", "この機能は本人専用です。");
  };
  await authorize();
  const inputResult = inputSchema.safeParse(request.data);
  if (!inputResult.success) throw new HttpsError("invalid-argument", "期間・対象者・情報源を確認してください。");
  const input = inputResult.data, uid = request.auth!.uid, leaseId = randomUUID();
  const lock = db.doc(`meetingResumeLocks/${uid}`);
  await db.runTransaction(async tx => {
    const existing = (await tx.get(lock)).data();
    if (existing?.expiresAt?.toMillis() > Date.now()) throw new HttpsError("already-exists", "会議レジュメを作成中です。完了を待ってください。");
    tx.set(lock, { leaseId, expiresAt: Timestamp.fromMillis(Date.now() + LEASE_TIMEOUT_MS) });
  });
  const budget = deadline(WORK_TIMEOUT_MS, "会議資料の作成が全体の制限時間に達しました。既存の編集内容は保持しています。期間または対象者を分けて再作成してください。", response?.signal);
  const signal = budget.signal, startedAt = Date.now(); let stage: Progress["stage"] = "collecting";
  const progress = async (p: Progress) => { signal.throwIfAborted(); stage = p.stage; if (response) await response.sendChunk(p); };
  try {
    await progress({ stage: "collecting" });
    const collected = await collectEvidence(db, input, uid, process.env.BUSINESS_FEATURE_ENABLED === "true");
    const apiKey = key.value();
    if (!apiKey) throw new HttpsError("failed-precondition", "AIの設定を確認してください。");
    const ask = createMeetingAsk(apiKey, uid, signal);
    const brief = await generateBrief(input, collected.sources, ask, progress);
    await authorize(); // Never return business content after the owner's access has been revoked.
    if (input.sources.business) {
      const settings = (await db.doc("businessSettings/company").get()).data();
      if (!settings?.enabled || !settings.memberIds?.includes(uid)) throw new HttpsError("permission-denied", "会社の取り組みの共有設定が変更されました。再作成してください。");
    }
    signal.throwIfAborted();
    return { brief, sources: collected.sources, notices: collected.notices, model: MODEL, generatedAt: new Date().toISOString(), input };
  } catch (error) {
    // Metadata only: never log provider messages, prompts, report contents or credentials.
    logError("meeting_resume_failed", { operationId: leaseId, stage, elapsedMs: Date.now() - startedAt,
      kind: error instanceof HttpsError ? error.code : error instanceof z.ZodError ? "invalid-output" : error instanceof OpenAI.APIError ? "provider-error" : "unexpected",
      ...(error instanceof BriefValidationError ? { validationIssues: error.validationIssues } : {}),
      ...(error instanceof OpenAI.APIError ? { status: error.status ?? null, providerRequestId: error.requestID ?? null } : {}) });
    if (signal.aborted) {
      if (signal.reason instanceof HttpsError) throw signal.reason;
      throw new HttpsError("cancelled", "会議資料の作成を中止しました。既存の編集内容は保持しています。");
    }
    if (error instanceof HttpsError) throw error;
    if (error instanceof z.ZodError) throw new HttpsError("data-loss", "AI資料の形式を検証できませんでした。再作成してください。");
    const status = error instanceof OpenAI.APIError ? error.status : undefined;
    throw new HttpsError(status === 429 ? "resource-exhausted" : "unavailable", status === 429 ? "AIの利用上限に達しています。時間をおいて再試行してください。" : "AI整理を完了できませんでした。既存の編集内容は保持しています。通信・AI設定を確認して再試行してください。");
  } finally {
    budget.dispose();
    await db.runTransaction(async tx => { if ((await tx.get(lock)).data()?.leaseId === leaseId) tx.delete(lock); }).catch(() => undefined);
  }
});
