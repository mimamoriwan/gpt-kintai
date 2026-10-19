import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { ZodError } from "zod";
import { deliverAnnouncementPush, registerPushDevice, testPushDevice, unregisterPushDevice } from "./announcementPush.js";

const options = { region: "asia-northeast1", enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true", invoker: "public" as const, maxInstances: 5 };
async function safe<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof ZodError) throw new HttpsError("invalid-argument", "通知設定の入力を確認してください。");
    // SDK errors can contain registration tokens. Never return or log raw errors.
    throw new HttpsError("internal", "通知設定を処理できませんでした。再度お試しください。");
  }
}
export const registerAnnouncementPushDevice = onCall(options, request => safe(() => registerPushDevice(getFirestore(), request.auth, request.data)));
export const unregisterAnnouncementPushDevice = onCall(options, request => safe(() => unregisterPushDevice(getFirestore(), request.data)));
export const testAnnouncementPushDevice = onCall(options, request => safe(() => testPushDevice(getFirestore(), getMessaging(), request.auth, request.data)));
export const notifyNewAnnouncement = onDocumentCreated({ region: "asia-northeast1", document: "presidentInstructions/{instructionId}", retry: true, maxInstances: 5 },
  event => deliverAnnouncementPush(getFirestore(), getMessaging(), event.params.instructionId));
