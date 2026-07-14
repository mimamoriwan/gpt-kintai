import { httpsCallable } from "firebase/functions";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryConstraint
} from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytes
} from "firebase/storage";
import { db, functions, storage } from "../firebase";
import { compressImage, validateFiles, validHttpUrl } from "../lib/files";
import { safeFilename } from "../lib/format";
import type {
  Attachment,
  AttendanceRecord,
  Category,
  DailyReport,
  ReportFields,
  ReportLanguage,
  Role,
  UserProfile,
  WorkMode
} from "../types";

type Unsubscribe = () => void;

export function watchAttendance(
  userId: string | null,
  canViewAll: boolean,
  callback: (rows: AttendanceRecord[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const constraints: QueryConstraint[] = [];
  if (userId && !canViewAll) constraints.push(where("userId", "==", userId));
  constraints.push(orderBy("startedAt", "desc"));
  return onSnapshot(query(collection(db, "attendance"), ...constraints), (snapshot) => {
    callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AttendanceRecord));
  }, (error) => onError?.(error));
}

export function watchReports(
  userId: string | null,
  canViewAll: boolean,
  callback: (rows: DailyReport[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const constraints: QueryConstraint[] = [];
  if (userId && !canViewAll) constraints.push(where("userId", "==", userId));
  constraints.push(orderBy("reportDate", "desc"));
  return onSnapshot(query(collection(db, "dailyReports"), ...constraints), (snapshot) => {
    callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as DailyReport));
  }, (error) => onError?.(error));
}

export function watchUsers(callback: (users: UserProfile[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, "users"), orderBy("displayName")), (snapshot) => {
    callback(snapshot.docs.map((item) => item.data() as UserProfile));
  });
}

export function watchCategories(callback: (categories: Category[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, "categories"), orderBy("order")), (snapshot) => {
    callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Category));
  });
}

export async function clockIn(workMode: WorkMode): Promise<string> {
  const call = httpsCallable<{ workMode: WorkMode }, { id: string }>(functions, "clockIn");
  return (await call({ workMode })).data.id;
}

export async function clockOut(): Promise<void> {
  const call = httpsCallable<Record<string, never>, { id: string }>(functions, "clockOut");
  await call({});
}

export async function correctAttendance(input: {
  id: string;
  startedAt: string;
  endedAt?: string;
  reason: string;
}): Promise<void> {
  const call = httpsCallable<typeof input, { ok: true }>(functions, "correctAttendance");
  await call(input);
}

export async function submitReport(input: {
  reportId?: string;
  reportDate: string;
  sourceLanguage: ReportLanguage;
  fields: ReportFields;
  attachments: Attachment[];
  correctionReason?: string;
}): Promise<{ id: string; translationStatus: string }> {
  const call = httpsCallable<typeof input, { id: string; translationStatus: string }>(functions, "submitDailyReport", { timeout: 120_000 });
  return (await call(input)).data;
}

export async function retryTranslation(reportId: string): Promise<void> {
  const call = httpsCallable<{ reportId: string }, { ok: true }>(functions, "retryReportTranslation", { timeout: 120_000 });
  await call({ reportId });
}

export async function markReviewed(entityType: "attendance" | "daily_report", entityId: string): Promise<void> {
  const call = httpsCallable<{ entityType: string; entityId: string }, { ok: true }>(functions, "markReviewed");
  await call({ entityType, entityId });
}

export async function uploadReportFiles(userId: string, reportKey: string, files: File[], existing: Attachment[]): Promise<Attachment[]> {
  const preparedFiles: File[] = [];
  for (const file of files) preparedFiles.push(await compressImage(file));
  const validation = validateFiles(preparedFiles, existing);
  if (validation) throw new Error(validation);
  const output: Attachment[] = [];
  for (const file of preparedFiles) {
    const id = crypto.randomUUID();
    const path = `reports/${userId}/${reportKey}/${id}-${safeFilename(file.name)}`;
    const objectRef = ref(storage, path);
    await uploadBytes(objectRef, file, {
      contentType: file.type,
      customMetadata: { ownerId: userId, reportKey }
    });
    output.push({
      id,
      name: file.name,
      contentType: file.type,
      size: file.size,
      storagePath: path,
      downloadUrl: await getDownloadURL(objectRef)
    });
  }
  return output;
}

export function makeLinkAttachment(url: string): Attachment {
  if (!validHttpUrl(url)) throw new Error("http または https のリンクを入力してください。");
  return {
    id: crypto.randomUUID(),
    name: new URL(url).hostname,
    contentType: "text/uri-list",
    size: 0,
    linkUrl: url
  };
}

export async function inviteUser(input: { email: string; displayName: string; role: Role; locale: string }): Promise<{ uid: string; resetLink: string }> {
  const call = httpsCallable<typeof input, { uid: string; resetLink: string }>(functions, "inviteUser");
  return (await call(input)).data;
}

export async function deactivateUser(uid: string, disabled: boolean): Promise<void> {
  const call = httpsCallable<{ uid: string; disabled: boolean }, { ok: true }>(functions, "setUserDisabled");
  await call({ uid, disabled });
}

export async function saveCategory(input: Partial<Category> & Pick<Category, "labelJa" | "labelZh">): Promise<void> {
  const call = httpsCallable<typeof input, { id: string }>(functions, "saveCategory");
  await call(input);
}

export async function exportMonth(month: string, userId?: string): Promise<{ json: string; csv: string; manifest: string }> {
  const call = httpsCallable<{ month: string; userId?: string }, { json: string; csv: string; manifest: string }>(functions, "exportMonthlyBackup", { timeout: 120_000 });
  return (await call({ month, userId })).data;
}
