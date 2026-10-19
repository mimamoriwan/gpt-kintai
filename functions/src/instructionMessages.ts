import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

const documentId = z.string().trim().min(1).max(128).refine((value) => !value.includes("/") && value !== "." && value !== "..", "IDが正しくありません。");
const inputSchema = z.object({
  instructionId: documentId,
  recipientId: documentId,
  messageId: z.string().uuid(),
  body: z.string().trim().min(1, "返信を入力してください。").max(2000, "返信は2000文字以内で入力してください。")
});

/** Append an immutable, retry-safe message without changing confirmation/completion state. */
export async function sendInstructionMessage(firestore: Firestore, actorId: string | undefined, data: unknown) {
  if (!actorId) throw new HttpsError("unauthenticated", "ログインが必要です。");
  const input = inputSchema.parse(data);
  const profileRef = firestore.doc(`users/${actorId}`);
  const instructionRef = firestore.doc(`presidentInstructions/${input.instructionId}`);
  const messageRef = firestore.doc(`${instructionRef.path}/conversations/${input.recipientId}/messages/${input.messageId}`);
  const auditRef = firestore.collection("auditEvents").doc();
  return firestore.runTransaction(async (transaction) => {
    const [profileSnapshot, instructionSnapshot, messageSnapshot] = await Promise.all([
      transaction.get(profileRef), transaction.get(instructionRef), transaction.get(messageRef)
    ]);
    if (!profileSnapshot.exists || profileSnapshot.data()?.active === false) throw new HttpsError("permission-denied", "利用できないアカウントです。");
    if (!instructionSnapshot.exists) throw new HttpsError("not-found", "お知らせがありません。");
    const profile = profileSnapshot.data()!;
    const row = instructionSnapshot.data()!;
    const sameScope = profile.isDemo === true
      ? row.isDemo === true && String(row.demoDatasetId || "") === String(profile.demoDatasetId || "")
      : row.isDemo !== true;
    if (!sameScope) throw new HttpsError("permission-denied", "デモデータの範囲が一致しません。");
    if (!Array.isArray(row.recipientIds) || !row.recipientIds.includes(input.recipientId)
      || (actorId !== row.authorId && actorId !== input.recipientId)) {
      throw new HttpsError("permission-denied", "この会話には参加できません。");
    }
    const scope = profile.isDemo === true
      ? { isDemo: true, demoDatasetId: String(profile.demoDatasetId || ""), seedVersion: String(profile.seedVersion || "") }
      : { isDemo: false };
    if (scope.isDemo && (!scope.demoDatasetId || !scope.seedVersion)) throw new HttpsError("failed-precondition", "デモアカウント設定が不完全です。");
    if (messageSnapshot.exists) {
      const previous = messageSnapshot.data()!;
      if (previous.senderId !== actorId || previous.body !== input.body) throw new HttpsError("already-exists", "送信済みの返信は変更できません。");
      return { ok: true as const, id: input.messageId };
    }
    if (row.status !== "active" && row.status !== "completed") throw new HttpsError("failed-precondition", "取り消されたお知らせには返信できません。");
    const now = Timestamp.now();
    transaction.create(messageRef, {
      senderId: actorId, senderName: String(profile.displayName || actorId),
      body: input.body, createdAt: now, ...scope
    });
    transaction.create(auditRef, {
      actorId, subjectUserId: input.recipientId, entityType: "president_instruction", entityId: input.instructionId,
      action: "replied", after: { recipientId: input.recipientId, messageId: input.messageId }, createdAt: now, ...scope
    });
    return { ok: true as const, id: input.messageId };
  });
}
