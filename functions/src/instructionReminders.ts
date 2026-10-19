import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";

export const INSTRUCTION_REMINDER_COOLDOWN_MS = 5 * 60 * 1000;

const reminderInputSchema = z.object({
  instructionId: z.string().trim().min(1, "お知らせを選択してください。").max(128).refine((value) => !value.includes("/"), "お知らせのIDが正しくありません。")
});

function nextReminderCount(value: unknown): number {
  return (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0) + 1;
}

/** Persist a reminder event for the app's realtime listener, without sending external messages. */
export async function sendInstructionReminder(firestore: Firestore, actorId: string | undefined, data: unknown) {
  if (!actorId) throw new HttpsError("unauthenticated", "ログインが必要です。");
  const { instructionId } = reminderInputSchema.parse(data);
  const profileRef = firestore.doc(`users/${actorId}`);
  const instructionRef = firestore.doc(`presidentInstructions/${instructionId}`);
  const auditRef = firestore.collection("auditEvents").doc();

  return firestore.runTransaction(async (transaction) => {
    // Read both records in the transaction so disabling an author, acknowledging,
    // cancelling, or another reminder cannot race a stale authorization/update.
    const [profileSnapshot, instructionSnapshot] = await Promise.all([
      transaction.get(profileRef), transaction.get(instructionRef)
    ]);
    if (!profileSnapshot.exists || profileSnapshot.data()?.active === false) {
      throw new HttpsError("permission-denied", "利用できないアカウントです。");
    }
    const profile = profileSnapshot.data()!;
    if (!instructionSnapshot.exists) throw new HttpsError("not-found", "お知らせがありません。");
    const row = instructionSnapshot.data()!;
    const sameScope = profile.isDemo === true
      ? row.isDemo === true && String(row.demoDatasetId || "") === String(profile.demoDatasetId || "")
      : row.isDemo !== true;
    if (!sameScope) throw new HttpsError("permission-denied", "デモデータの範囲が一致しません。");
    if (row.authorId !== actorId) throw new HttpsError("permission-denied", "発信者本人だけが再通知できます。");
    if (row.status !== "active") throw new HttpsError("failed-precondition", "有効なお知らせだけ再通知できます。");

    const scope = profile.isDemo === true
      ? { isDemo: true, demoDatasetId: String(profile.demoDatasetId || ""), seedVersion: String(profile.seedVersion || "") }
      : { isDemo: false };
    if (scope.isDemo && (!scope.demoDatasetId || !scope.seedVersion)) {
      throw new HttpsError("failed-precondition", "デモアカウント設定が不完全です。");
    }

    const recipientStates = { ...row.recipientStates };
    const recipientIds = [...new Set<string>(Array.isArray(row.recipientIds) ? row.recipientIds.filter((id: unknown) => typeof id === "string") : [])]
      .filter((id) => recipientStates[id]?.status === "pending");
    if (!recipientIds.length) throw new HttpsError("failed-precondition", "未確認の対象者はいません。");

    const now = Timestamp.now();
    if (row.lastReminderAt instanceof Timestamp && now.toMillis() - row.lastReminderAt.toMillis() < INSTRUCTION_REMINDER_COOLDOWN_MS) {
      throw new HttpsError("resource-exhausted", "再通知は5分以上あけて行ってください。");
    }
    for (const id of recipientIds) {
      const state = recipientStates[id];
      recipientStates[id] = { ...state, lastRemindedAt: now, reminderCount: nextReminderCount(state.reminderCount) };
    }
    const reminderCount = nextReminderCount(row.reminderCount);
    transaction.update(instructionRef, { recipientStates, lastReminderAt: now, reminderCount, updatedAt: now });
    transaction.create(auditRef, {
      actorId, subjectUserId: actorId, entityType: "president_instruction", entityId: instructionId,
      action: "reminded", after: { recipientIds, recipientCount: recipientIds.length, reminderCount },
      createdAt: now, ...scope
    });
    return { ok: true as const, recipientCount: recipientIds.length };
  });
}
