import type { Timestamp } from "firebase/firestore";

export type Role = "employee" | "employee_manager" | "president_viewer";
export type Locale = "ja" | "zh-CN";
export type WorkMode = "office" | "business_trip" | "home" | "other";
export type ReportLanguage = "ja" | "zh-CN";
export type TranslationStatus = "not_required" | "pending" | "completed" | "failed";
export type ReviewStatus = "not_required" | "unreviewed" | "reviewed" | "needs_review";

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  locale: Locale;
  active: boolean;
  createdAt?: Timestamp;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  workMode: WorkMode;
  workDate: string;
  status: "active" | "completed";
  startedAt: Timestamp;
  endedAt?: Timestamp;
  corrected: boolean;
  correctionReason?: string;
  needsReview: boolean;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ReportFields {
  category: string;
  area: string;
  destinations: string;
  activities: string;
  findings: string;
  nextPlan: string;
}

export interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  storagePath?: string;
  downloadUrl?: string;
  linkUrl?: string;
}

export interface DailyReport extends ReportFields {
  id: string;
  userId: string;
  userName: string;
  reportDate: string;
  sourceLanguage: ReportLanguage;
  translatedFields?: Partial<ReportFields>;
  translationStatus: TranslationStatus;
  translationError?: string;
  translationAttempts: number;
  attachments: Attachment[];
  status: "submitted";
  reviewStatus: ReviewStatus;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  revision: number;
  submittedAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ReportRevision {
  id: string;
  reportId: string;
  revision: number;
  before: Omit<DailyReport, "id">;
  reason: string;
  changedBy: string;
  changedAt: Timestamp;
}

export interface AuditEvent {
  id: string;
  actorId: string;
  subjectUserId: string;
  entityType: "attendance" | "daily_report" | "user";
  entityId: string;
  action: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  createdAt: Timestamp;
}

export interface Category {
  id: string;
  labelJa: string;
  labelZh: string;
  active: boolean;
  order: number;
}

export type NavSection = "home" | "report" | "records" | "admin" | "settings";
