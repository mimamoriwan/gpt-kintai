import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireWorkAuth } from "./passwordChange.js";

const inputSchema = z.object({
  reportId: z.string().min(1).max(260).refine((value) => !value.includes("/")),
  commentIds: z.array(z.string().min(1).max(128)).min(1).max(100)
});

export async function acknowledgeDailyReportReplies(
  auth: { uid: string; token: Record<string, unknown> } | undefined,
  data: unknown,
  db: Firestore
): Promise<{ ok: true }> {
  const validated = await requireWorkAuth(auth, async (uid) => (await db.doc(`users/${uid}`).get()).data());
  const input = inputSchema.parse(data);
  const ref = db.doc(`dailyReports/${input.reportId}`);
  await db.runTransaction(async (transaction) => {
    // Check the current profile and report inside the transaction before any write.
    const profileSnapshot = await transaction.get(db.doc(`users/${validated.uid}`));
    await requireWorkAuth(auth, async () => profileSnapshot.data());
    const profile = profileSnapshot.data()!;
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", "日報がありません。");
    const report = snapshot.data()!;
    const sameScope = profile.isDemo === true
      ? report.isDemo === true && String(report.demoDatasetId || "") === String(profile.demoDatasetId || "")
      : report.isDemo !== true;
    if (report.userId !== validated.uid || !sameScope) throw new HttpsError("permission-denied", "本人の日報だけ確認できます。");
    if (report.status === "provisional") throw new HttpsError("failed-precondition", "提出済みの日報だけ確認できます。");
    const replies = new Set((Array.isArray(report.comments) ? report.comments : [])
      .filter((comment: Record<string, unknown>) => comment.authorId !== validated.uid &&
        (comment.authorRole === "employee_manager" || comment.authorRole === "president_viewer"))
      .map((comment: Record<string, unknown>) => comment.id));
    if (input.commentIds.some((id) => !replies.has(id))) throw new HttpsError("invalid-argument", "確認するコメントを再取得してください。");
    // Merge only displayed IDs; comments arriving during confirmation stay unread.
    transaction.update(ref, { commentsReadIds: FieldValue.arrayUnion(...new Set(input.commentIds)) });
  });
  return { ok: true };
}
