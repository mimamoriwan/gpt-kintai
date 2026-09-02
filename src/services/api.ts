import { httpsCallable } from "firebase/functions";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type QueryConstraint
} from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytes
} from "firebase/storage";
import { db, functions, prepareCallableSecurityContext, storage } from "../firebase";
import { compressImage, validateFiles, validHttpUrl } from "../lib/files";
import { calendarEventPayload } from "../lib/calendar";
import { invokeWithVerifiedSecurityContext } from "../lib/callable";
import { safeFilename } from "../lib/format";
import { compressProductImage, fileToDataUrl } from "../lib/product";
import type {
  Attachment,
  AnnouncementRecipient,
  AttendanceRecord,
  AuditEvent,
  CalendarEvent,
  CalendarEventInput,
  CalendarMember,
  CalendarMemberInput,
  Category,
  CompanyDayType,
  CompanyHolidayOverride,
  DailyReport,
  DailyReportAutomation,
  DutyDefinition,
  EmploymentBasis,
  EvidenceReference,
  MonthlyEvidencePackage,
  NonWorkingReason,
  PresidentInstruction,
  InstructionPriority,
  Product,
  ProductFacts,
  ProductImageAnalysis,
  ProductObservation,
  ProductPhoto,
  ProductPhotoKind,
  ProductRevision,
  ProductSource,
  ProductStatus,
  ReportFields,
  ReportLanguage,
  RenewalChecklist,
  Role,
  UserProfile,
  WeeklyMeetingRecord,
  WeeklyPlan,
  WeeklyReport,
  WeeklyReportSections,
  SourceDocumentReference,
  WorkLogEntry,
  WorkTag,
  WorkMode
} from "../types";
import type { GeneratedReportDraft } from "../types";

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

export function watchDailyReportAutomations(
  userId: string | null,
  canViewAll: boolean,
  callback: (rows: DailyReportAutomation[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const constraints: QueryConstraint[] = [];
  if (userId && !canViewAll) constraints.push(where("userId", "==", userId));
  constraints.push(orderBy("workDate", "desc"));
  return onSnapshot(query(collection(db, "dailyReportAutomations"), ...constraints), (snapshot) => {
    callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as DailyReportAutomation));
  }, (error) => onError?.(error));
}

export function watchPresidentInstructions(
  profile: UserProfile,
  callback: (rows: PresidentInstruction[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const scopeConstraints: QueryConstraint[] = [where("isDemo", "==", profile.isDemo === true)];
  if (profile.isDemo === true) scopeConstraints.push(where("demoDatasetId", "==", profile.demoDatasetId ?? "__missing_demo_dataset__"));
  const rows = new Map<"incoming" | "sent", PresidentInstruction[]>();
  const emit = () => {
    const merged = new Map<string, PresidentInstruction>();
    for (const group of rows.values()) for (const item of group) merged.set(item.id, item);
    callback([...merged.values()].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)));
  };
  const subscribe = (kind: "incoming" | "sent", audience: QueryConstraint) => onSnapshot(
    query(collection(db, "presidentInstructions"), audience, ...scopeConstraints, orderBy("createdAt", "desc")),
    (snapshot) => {
      rows.set(kind, snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as PresidentInstruction));
      emit();
    },
    (error) => onError?.(error)
  );
  const unsubscribeIncoming = subscribe("incoming", where("recipientIds", "array-contains", profile.uid));
  const unsubscribeSent = subscribe("sent", where("authorId", "==", profile.uid));
  return () => {
    unsubscribeIncoming();
    unsubscribeSent();
  };
}

export async function getAnnouncementRecipients(): Promise<AnnouncementRecipient[]> {
  const call = httpsCallable<Record<string, never>, { recipients: AnnouncementRecipient[] }>(functions, "listAnnouncementRecipients");
  return (await call({})).data.recipients;
}

export interface PresidentInstructionInput {
  instructionId: string;
  title: string;
  body: string;
  priority: InstructionPriority;
  dueDate: string;
  recipientIds: string[];
  attachments: Attachment[];
}

export async function createPresidentInstruction(input: PresidentInstructionInput): Promise<{ id: string; translationStatus: "completed" | "failed" }> {
  const call = httpsCallable<PresidentInstructionInput, { id: string; translationStatus: "completed" | "failed" }>(functions, "createPresidentInstruction", { timeout: 120_000 });
  return (await call(input)).data;
}

export async function acknowledgePresidentInstruction(instructionId: string): Promise<void> {
  const call = httpsCallable<{ instructionId: string }, { ok: true }>(functions, "acknowledgePresidentInstruction");
  await call({ instructionId });
}

export async function completePresidentInstruction(instructionId: string, completionNote: string): Promise<void> {
  const call = httpsCallable<{ instructionId: string; completionNote: string }, { ok: true }>(functions, "completePresidentInstruction");
  await call({ instructionId, completionNote });
}

export async function cancelPresidentInstruction(instructionId: string, reason: string): Promise<void> {
  const call = httpsCallable<{ instructionId: string; reason: string }, { ok: true }>(functions, "cancelPresidentInstruction");
  await call({ instructionId, reason });
}

export async function replacePresidentInstruction(instructionId: string, reason: string, replacement: PresidentInstructionInput): Promise<{ id: string; translationStatus: "completed" | "failed" }> {
  const call = httpsCallable<{ instructionId: string; reason: string; replacement: PresidentInstructionInput }, { id: string; translationStatus: "completed" | "failed" }>(functions, "replacePresidentInstruction", { timeout: 120_000 });
  return (await call({ instructionId, reason, replacement })).data;
}

export async function retryPresidentInstructionTranslation(instructionId: string): Promise<void> {
  const call = httpsCallable<{ instructionId: string }, { ok: true }>(functions, "retryPresidentInstructionTranslation", { timeout: 120_000 });
  await call({ instructionId });
}

export async function uploadPresidentInstructionFiles(profile: UserProfile, instructionId: string, files: File[], existing: Attachment[]): Promise<Attachment[]> {
  const preparedFiles: File[] = [];
  for (const file of files) preparedFiles.push(file.type.startsWith("image/") || /\.hei[cf]$/i.test(file.name) ? await compressProductImage(file) : file);
  const validation = validateFiles(preparedFiles, existing);
  if (validation) throw new Error(validation);
  const output: Attachment[] = [];
  for (const file of preparedFiles) {
    const id = crypto.randomUUID();
    const prefix = profile.isDemo
      ? `demo/${profile.demoDatasetId}/president-instructions/${instructionId}/${profile.uid}`
      : `president-instructions/${instructionId}/${profile.uid}`;
    const path = `${prefix}/${id}-${safeFilename(file.name)}`;
    const objectRef = ref(storage, path);
    await uploadBytes(objectRef, file, {
      contentType: file.type,
      customMetadata: {
        ownerId: profile.uid,
        instructionId,
        ...(profile.isDemo ? { isDemo: "true", demoDatasetId: profile.demoDatasetId || "" } : {})
      }
    });
    output.push({ id, name: file.name, contentType: file.type, size: file.size, storagePath: path });
  }
  return output;
}

export function presidentInstructionAttachmentUrl(storagePath: string): Promise<string> {
  return getDownloadURL(ref(storage, storagePath));
}

export function watchAiUsageEvents(
  callback: (rows: AuditEvent[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(db, "auditEvents"), where("entityType", "==", "daily_report_draft")),
    (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as AuditEvent)),
    (error) => onError?.(error)
  );
}

export function watchProducts(
  profile: UserProfile,
  canViewAll: boolean,
  callback: (rows: Product[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const productsRef = collection(db, "products");
  const productsQuery = canViewAll
    ? productsRef
    : profile.isDemo
      ? query(
          productsRef,
          where("isDemo", "==", true),
          where("demoDatasetId", "==", profile.demoDatasetId ?? "__missing_demo_dataset__")
        )
      : query(productsRef, where("isDemo", "==", false));
  return onSnapshot(productsQuery, (snapshot) => {
    const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Product);
    rows.sort((a, b) => (b.latestDiscoveredAt || "").localeCompare(a.latestDiscoveredAt || ""));
    callback(rows);
  }, (error) => onError?.(error));
}

export function watchProductObservations(
  profile: UserProfile,
  canViewAll: boolean,
  callback: (rows: ProductObservation[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const observationsRef = collection(db, "productObservations");
  const observationsQuery = canViewAll
    ? observationsRef
    : profile.isDemo
      ? query(
          observationsRef,
          where("isDemo", "==", true),
          where("demoDatasetId", "==", profile.demoDatasetId ?? "__missing_demo_dataset__")
        )
      : query(observationsRef, where("isDemo", "==", false));
  return onSnapshot(observationsQuery, (snapshot) => {
    const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ProductObservation);
    rows.sort((a, b) => b.discoveredDate.localeCompare(a.discoveredDate) || ((b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)));
    callback(rows);
  }, (error) => onError?.(error));
}

export function watchProductRevisions(callback: (rows: ProductRevision[]) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(collection(db, "productRevisions"), (snapshot) => {
    const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ProductRevision);
    rows.sort((a, b) => (b.changedAt?.toMillis?.() || 0) - (a.changedAt?.toMillis?.() || 0));
    callback(rows);
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

export function watchCompanyHolidayOverrides(callback: (rows: CompanyHolidayOverride[]) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(collection(db, "companyHolidayOverrides"), (snapshot) => {
    const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as CompanyHolidayOverride);
    rows.sort((a, b) => a.date.localeCompare(b.date));
    callback(rows);
  }, (error) => onError?.(error));
}

export function watchCalendarEvents(
  profile: UserProfile,
  fromDate: string,
  toDate: string,
  callback: (rows: CalendarEvent[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const scopeConstraints: QueryConstraint[] = profile.isDemo
    ? [where("isDemo", "==", true), where("demoDatasetId", "==", profile.demoDatasetId || "__missing_demo_dataset__")]
    : [where("isDemo", "==", false)];
  return onSnapshot(query(
    collection(db, "calendarEvents"),
    ...scopeConstraints,
    where("date", ">=", fromDate),
    where("date", "<=", toDate),
    orderBy("date", "asc")
  ), (snapshot) => {
    callback(snapshot.docs.map((item) => {
      const data = item.data();
      const participants = Array.isArray(data.participants) ? data.participants.map((participant: { memberId?: string; userId?: string; displayName?: string }) => ({
        memberId: String(participant.memberId || participant.userId || ""),
        displayName: String(participant.displayName || ""),
        ...(participant.userId ? { userId: participant.userId } : {})
      })) : [];
      return {
        id: item.id,
        ...data,
        groupId: String(data.groupId || item.id),
        eventType: data.eventType || "work",
        startDate: String(data.startDate || data.date || ""),
        endDate: String(data.endDate || data.date || ""),
        startTime: String(data.startTime || ""),
        endTime: String(data.endTime || ""),
        memo: String(data.memo || ""),
        participants
      } as CalendarEvent;
    }));
  }, (error) => onError?.(error));
}

export async function getCalendarMembers(includeInactive = false): Promise<CalendarMember[]> {
  const call = httpsCallable<{ includeInactive?: boolean }, { members: CalendarMember[] }>(functions, "listCalendarMembers");
  return (await call({ includeInactive })).data.members;
}

export async function saveCalendarMember(input: CalendarMemberInput): Promise<{ id: string }> {
  const call = httpsCallable<CalendarMemberInput, { id: string }>(functions, "saveCalendarMember");
  return (await call(input)).data;
}

export async function saveCalendarEvent(input: CalendarEventInput): Promise<{ id: string; groupId: string }> {
  const call = httpsCallable<CalendarEventInput, { id: string; groupId: string }>(functions, "saveCalendarEvent");
  return (await call(calendarEventPayload(input))).data;
}

export async function deleteCalendarEvent(id: string, groupId?: string): Promise<void> {
  const call = httpsCallable<{ id: string; groupId?: string }, { ok: true }>(functions, "deleteCalendarEvent");
  await call({ id, ...(groupId ? { groupId } : {}) });
}

export function watchWorkTags(userId: string, callback: (tags: WorkTag[]) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(db, "users", userId, "workTags"), orderBy("order")), (snapshot) => {
    callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as WorkTag));
  }, (error) => onError?.(error));
}

export function watchWorkLogs(userId: string, workDate: string, callback: (logs: WorkLogEntry[]) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(db, "workLogs"), where("userId", "==", userId), where("workDate", "==", workDate)), (snapshot) => {
    const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as WorkLogEntry);
    rows.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
    callback(rows);
  }, (error) => onError?.(error));
}

function demoWriteFields(source?: { isDemo?: boolean; demoDatasetId?: string; seedVersion?: string }) {
  return source?.isDemo === true && source.demoDatasetId && source.seedVersion
    ? { isDemo: true, demoDatasetId: source.demoDatasetId, seedVersion: source.seedVersion }
    : {};
}

export async function saveWorkTag(userId: string, label: string, order = Date.now(), demo?: { isDemo?: boolean; demoDatasetId?: string; seedVersion?: string }): Promise<string> {
  const ref = doc(collection(db, "users", userId, "workTags"));
  await setDoc(ref, { userId, label: label.trim(), active: true, order, ...demoWriteFields(demo), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return ref.id;
}

export async function addWorkLog(
  input: { userId: string; workDate: string; tagId: string; tagLabel: string; text: string; isDemo?: boolean; demoDatasetId?: string; seedVersion?: string },
  profile: UserProfile,
  files: File[] = [],
  attachments: Attachment[] = []
): Promise<string> {
  const { isDemo, demoDatasetId, seedVersion, ...record } = input;
  const logRef = doc(collection(db, "workLogs"));
  const uploaded = files.length ? await uploadWorkLogFiles(profile, logRef.id, files, attachments) : [];
  const combinedAttachments = [...attachments, ...uploaded];
  const validation = validateFiles([], combinedAttachments);
  if (validation) throw new Error(validation);
  await setDoc(logRef, {
    ...record,
    userName: profile.displayName,
    attachments: combinedAttachments,
    ...demoWriteFields({ isDemo, demoDatasetId, seedVersion }),
    text: input.text.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return logRef.id;
}

export async function removeWorkLog(id: string): Promise<void> {
  await deleteDoc(doc(db, "workLogs", id));
}

export async function updateWorkLog(
  id: string,
  input: { tagId: string; tagLabel: string; text: string },
  profile: UserProfile,
  files: File[] = [],
  attachments: Attachment[] = []
): Promise<void> {
  const uploaded = files.length ? await uploadWorkLogFiles(profile, id, files, attachments) : [];
  const combinedAttachments = [...attachments, ...uploaded];
  const validation = validateFiles([], combinedAttachments);
  if (validation) throw new Error(validation);
  await updateDoc(doc(db, "workLogs", id), {
    tagId: input.tagId,
    tagLabel: input.tagLabel,
    text: input.text.trim(),
    attachments: combinedAttachments,
    updatedAt: serverTimestamp()
  });
}

export async function generateReportDraft(reportDate: string, sourceLanguage: ReportLanguage, hasTravel: boolean): Promise<GeneratedReportDraft> {
  const call = httpsCallable<{ reportDate: string; sourceLanguage: ReportLanguage; hasTravel: boolean }, GeneratedReportDraft>(functions, "generateDailyReportDraft", { timeout: 180_000 });
  return (await call({ reportDate, sourceLanguage, hasTravel })).data;
}

export type ManualClockInDetails = {
  startedAt: string;
  reason: string;
};

export async function clockIn(workMode: WorkMode, manual?: ManualClockInDetails): Promise<string> {
  const call = httpsCallable<
    { workMode: WorkMode; startedAt?: string; reason?: string },
    { id: string }
  >(functions, "clockIn");
  return (await invokeWithVerifiedSecurityContext(
    prepareCallableSecurityContext,
    () => call({ workMode, ...manual })
  )).data.id;
}

export async function clockOut(): Promise<void> {
  const call = httpsCallable<Record<string, never>, { id: string }>(functions, "clockOut");
  await invokeWithVerifiedSecurityContext(
    prepareCallableSecurityContext,
    () => call({})
  );
}

export async function correctAttendance(input: {
  id: string;
  startedAt: string;
  endedAt?: string;
  reason: string;
  correctionKind?: "record_edit" | "missed_clock_out";
}): Promise<void> {
  const call = httpsCallable<typeof input, { ok: true }>(functions, "correctAttendance");
  await invokeWithVerifiedSecurityContext(
    prepareCallableSecurityContext,
    () => call(input)
  );
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
  return (await invokeWithVerifiedSecurityContext(
    prepareCallableSecurityContext,
    () => call(input)
  )).data;
}

export async function retryTranslation(reportId: string): Promise<void> {
  const call = httpsCallable<{ reportId: string }, { ok: true }>(functions, "retryReportTranslation", { timeout: 120_000 });
  await call({ reportId });
}

export async function markReviewed(entityType: "attendance" | "daily_report", entityId: string): Promise<void> {
  const call = httpsCallable<{ entityType: string; entityId: string }, { ok: true }>(functions, "markReviewed");
  await call({ entityType, entityId });
}

export async function addDailyReportComment(reportId: string, body: string): Promise<void> {
  const call = httpsCallable<{ reportId: string; body: string }, { id: string }>(functions, "addDailyReportComment");
  await call({ reportId, body });
}

export async function uploadReportFiles(profile: UserProfile, reportKey: string, files: File[], existing: Attachment[]): Promise<Attachment[]> {
  const preparedFiles: File[] = [];
  for (const file of files) preparedFiles.push(await compressImage(file));
  const validation = validateFiles(preparedFiles, existing);
  if (validation) throw new Error(validation);
  const output: Attachment[] = [];
  for (const file of preparedFiles) {
    const id = crypto.randomUUID();
    const prefix = profile.isDemo
      ? `demo/${profile.demoDatasetId}/reports/${profile.uid}`
      : `reports/${profile.uid}`;
    const path = `${prefix}/${reportKey}/${id}-${safeFilename(file.name)}`;
    const objectRef = ref(storage, path);
    await uploadBytes(objectRef, file, {
      contentType: file.type,
      customMetadata: { ownerId: profile.uid, reportKey, ...(profile.isDemo ? { isDemo: "true", demoDatasetId: profile.demoDatasetId || "" } : {}) }
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

async function uploadWorkLogFiles(profile: UserProfile, workLogId: string, files: File[], existing: Attachment[]): Promise<Attachment[]> {
  const preparedFiles: File[] = [];
  for (const file of files) preparedFiles.push(await compressImage(file));
  const validation = validateFiles(preparedFiles, existing);
  if (validation) throw new Error(validation);
  const output: Attachment[] = [];
  for (const file of preparedFiles) {
    const id = crypto.randomUUID();
    const prefix = profile.isDemo
      ? `demo/${profile.demoDatasetId}/reports/${profile.uid}`
      : `reports/${profile.uid}`;
    const path = `${prefix}/work-log-${workLogId}/${id}-${safeFilename(file.name)}`;
    const objectRef = ref(storage, path);
    await uploadBytes(objectRef, file, {
      contentType: file.type,
      customMetadata: {
        ownerId: profile.uid,
        workLogId,
        ...(profile.isDemo ? { isDemo: "true", demoDatasetId: profile.demoDatasetId || "" } : {})
      }
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

export async function analyzeProductPhotos(
  draftId: string,
  files: Partial<Record<ProductPhotoKind, File>>
): Promise<ProductImageAnalysis> {
  const images = await Promise.all(Object.entries(files).map(async ([kind, original]) => {
    const file = await compressProductImage(original);
    return { kind: kind as ProductPhotoKind, dataUrl: await fileToDataUrl(file) };
  }));
  const call = httpsCallable<{ draftId: string; images: { kind: ProductPhotoKind; dataUrl: string }[] }, ProductImageAnalysis>(functions, "analyzeProductImages", { timeout: 120_000 });
  return (await call({ draftId, images })).data;
}

export async function saveProductCandidate(input: {
  draftId: string;
  facts: ProductFacts;
  discoveredDate: string;
  source: ProductSource;
  sourceDetail: string;
  reasonOriginal: string;
  reasonLanguage: ReportLanguage;
  estimateRequested: boolean;
  addToWorkMemo: boolean;
  existingProductId?: string;
  createNewWithoutJan?: boolean;
}): Promise<{ productId: string; observationId: string; translationStatus: string; reportAlreadySubmitted: boolean }> {
  const call = httpsCallable<typeof input, { productId: string; observationId: string; translationStatus: string; reportAlreadySubmitted: boolean }>(functions, "saveProductCandidate", { timeout: 120_000 });
  return (await call(input)).data;
}

export async function uploadProductPhotos(
  profile: UserProfile,
  observationId: string,
  files: Partial<Record<ProductPhotoKind, File>>
): Promise<ProductPhoto[]> {
  const output: ProductPhoto[] = [];
  for (const [kind, original] of Object.entries(files)) {
    const file = await compressProductImage(original);
    const prefix = profile.isDemo
      ? `demo/${profile.demoDatasetId}/products/${profile.uid}`
      : `products/${profile.uid}`;
    const path = `${prefix}/${observationId}/${kind}-${crypto.randomUUID()}.jpg`;
    const objectRef = ref(storage, path);
    await uploadBytes(objectRef, file, {
      contentType: "image/jpeg",
      customMetadata: { ownerId: profile.uid, observationId, kind, ...(profile.isDemo ? { isDemo: "true", demoDatasetId: profile.demoDatasetId || "" } : {}) }
    });
    output.push({
      kind: kind as ProductPhotoKind,
      name: file.name,
      contentType: "image/jpeg",
      size: file.size,
      storagePath: path,
      downloadUrl: await getDownloadURL(objectRef)
    });
  }
  return output;
}

export async function attachProductPhotos(observationId: string, photos: ProductPhoto[]): Promise<void> {
  const call = httpsCallable<{ observationId: string; photos: ProductPhoto[] }, { ok: true }>(functions, "attachProductImages");
  await call({ observationId, photos });
}

export async function updateProductObservation(input: {
  observationId: string;
  discoveredDate: string;
  source: ProductSource;
  sourceDetail: string;
  reasonOriginal: string;
  reasonLanguage: ReportLanguage;
  correctionReason: string;
}): Promise<void> {
  const call = httpsCallable<typeof input, { ok: true }>(functions, "updateProductObservation", { timeout: 120_000 });
  await call(input);
}

export async function reviewProductObservation(observationId: string): Promise<void> {
  const call = httpsCallable<{ observationId: string }, { ok: true }>(functions, "reviewProductObservation");
  await call({ observationId });
}

export async function setProductStatus(productId: string, status: ProductStatus): Promise<void> {
  const call = httpsCallable<{ productId: string; status: ProductStatus }, { ok: true }>(functions, "setProductStatus");
  await call({ productId, status });
}

export async function setProductEstimateRequested(productId: string, estimateRequested: boolean): Promise<void> {
  const call = httpsCallable<{ productId: string; estimateRequested: boolean }, { ok: true }>(functions, "setProductEstimateRequested");
  await call({ productId, estimateRequested });
}

export async function updateProductFacts(productId: string, facts: ProductFacts, reason: string): Promise<void> {
  const call = httpsCallable<{ productId: string; facts: ProductFacts; reason: string }, { ok: true }>(functions, "updateProductFacts");
  await call({ productId, facts, reason });
}

export async function retryProductReasonTranslation(observationId: string): Promise<void> {
  const call = httpsCallable<{ observationId: string }, { ok: true }>(functions, "retryProductReasonTranslation", { timeout: 120_000 });
  await call({ observationId });
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

export async function saveCompanyHolidayOverride(input: { date?: string; startDate?: string; endDate?: string; dayType: CompanyDayType; label?: string }): Promise<void> {
  const call = httpsCallable<typeof input, { ok: true }>(functions, "saveCompanyHolidayOverride");
  await call(input);
}

export async function removeCompanyHolidayOverride(date: string, holidayGroupId?: string): Promise<void> {
  const call = httpsCallable<{ date: string; holidayGroupId?: string }, { ok: true }>(functions, "removeCompanyHolidayOverride");
  await call({ date, holidayGroupId });
}

export async function exportMonth(month: string, userId?: string): Promise<{ json: string; csv: string; manifest: string; html?: string }> {
  const call = httpsCallable<{ month: string; userId?: string }, { json: string; csv: string; manifest: string; html?: string }>(functions, "exportMonthlyBackup", { timeout: 120_000 });
  return (await call({ month, userId })).data;
}

function watchRows<T>(name: string, callback: (rows: T[]) => void, onError?: (error: Error) => void, constraints: QueryConstraint[] = []): Unsubscribe {
  return onSnapshot(query(collection(db, name), ...constraints), (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as T)), (error) => onError?.(error));
}

export const watchDutyDefinitions = (callback: (rows: DutyDefinition[]) => void, onError?: (error: Error) => void) => watchRows<DutyDefinition>("dutyDefinitions", (rows) => callback(rows.sort((a, b) => a.order - b.order)), onError);
export const watchSourceDocumentReferences = (callback: (rows: SourceDocumentReference[]) => void, onError?: (error: Error) => void) => watchRows<SourceDocumentReference>("sourceDocumentReferences", callback, onError);
export const watchEmploymentBases = (userId: string, canViewAll: boolean, callback: (rows: EmploymentBasis[]) => void, onError?: (error: Error) => void) => watchRows<EmploymentBasis>("employmentBases", callback, onError, canViewAll ? [] : [where("userId", "==", userId)]);
export const watchWeeklyPlans = (userId: string, canViewAll: boolean, callback: (rows: WeeklyPlan[]) => void, onError?: (error: Error) => void) => watchRows<WeeklyPlan>("weeklyPlans", callback, onError, canViewAll ? [] : [where("userId", "==", userId)]);
export const watchWeeklyReports = (userId: string, canViewAll: boolean, callback: (rows: WeeklyReport[]) => void, onError?: (error: Error) => void) => watchRows<WeeklyReport>("weeklyReports", callback, onError, canViewAll ? [] : [where("userId", "==", userId)]);
export const watchWeeklyMeetings = (userId: string, canViewAll: boolean, callback: (rows: WeeklyMeetingRecord[]) => void, onError?: (error: Error) => void) => watchRows<WeeklyMeetingRecord>("weeklyMeetings", callback, onError, canViewAll ? [] : [where("userId", "==", userId)]);
export const watchNonWorkingReasons = (userId: string, canViewAll: boolean, callback: (rows: NonWorkingReason[]) => void, onError?: (error: Error) => void) => watchRows<NonWorkingReason>("nonWorkingReasons", callback, onError, canViewAll ? [] : [where("userId", "==", userId)]);
export const watchEvidenceReferences = (userId: string, canViewAll: boolean, callback: (rows: EvidenceReference[]) => void, onError?: (error: Error) => void) => watchRows<EvidenceReference>("evidenceReferences", callback, onError, canViewAll ? [] : [where("subjectUserId", "==", userId)]);
export const watchMonthlyPackages = (userId: string, canViewAll: boolean, callback: (rows: MonthlyEvidencePackage[]) => void, onError?: (error: Error) => void) => watchRows<MonthlyEvidencePackage>("monthlyEvidencePackages", callback, onError, canViewAll ? [] : [where("userId", "==", userId)]);
export const watchRenewalChecklists = (callback: (rows: RenewalChecklist[]) => void, onError?: (error: Error) => void) => watchRows<RenewalChecklist>("renewalChecklists", callback, onError);

async function callSave<I, O = { id: string }>(name: string, input: I, timeout = 60_000): Promise<O> {
  const call = httpsCallable<I, O>(functions, name, { timeout });
  return (await call(input)).data;
}

export const saveDutyDefinition = (input: Partial<DutyDefinition> & Pick<DutyDefinition, "code" | "labelJa">) => callSave("saveDutyDefinition", input);
export const saveEmploymentBasis = (input: Omit<EmploymentBasis, "id" | "userName" | "createdAt" | "updatedAt">) => callSave("saveEmploymentBasis", input);
export const saveSourceDocumentReference = (input: Omit<SourceDocumentReference, "id" | "createdBy" | "createdAt" | "updatedAt"> & { id?: string }) => callSave("saveSourceDocumentReference", input);
export const saveWeeklyPlan = (input: Omit<WeeklyPlan, "id" | "userName" | "weekEnd" | "confirmedAt" | "confirmedBy" | "createdAt" | "updatedAt">) => callSave("saveWeeklyPlan", input);
export const generateWeeklyReport = (userId: string, weekStart: string) => callSave<{ userId: string; weekStart: string }, { id: string }>("generateWeeklyReport", { userId, weekStart }, 120_000);
export const saveWeeklyReport = (input: { reportId: string; sections: WeeklyReportSections; status: WeeklyReport["status"]; reason?: string }) => callSave("saveWeeklyReport", input);
export const saveWeeklyMeeting = (input: Omit<WeeklyMeetingRecord, "id" | "finalizedAt" | "finalizedBy" | "createdAt" | "updatedAt">) => callSave("saveWeeklyMeeting", input);
export const saveNonWorkingReason = (input: Omit<NonWorkingReason, "id" | "userName" | "createdBy" | "createdAt" | "updatedAt">) => callSave("saveNonWorkingReason", input);
export const saveEvidenceReference = (input: Omit<EvidenceReference, "id" | "createdBy" | "createdAt" | "updatedAt"> & { id?: string }) => callSave("saveEvidenceReference", input);
export const saveMonthlyPackage = (input: { userId: string; month: string; driveUrl: string }) => callSave("saveMonthlyPackage", input);
export const saveRenewalChecklist = (input: Omit<RenewalChecklist, "id" | "userName" | "updatedBy" | "createdAt" | "updatedAt">) => callSave("saveRenewalChecklist", input);
