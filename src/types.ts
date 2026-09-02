import type { Timestamp } from "firebase/firestore";

export type Role = "employee" | "employee_manager" | "president_viewer";
export type Locale = "ja" | "zh-CN";
export type WorkMode = "office" | "business_trip" | "home" | "other";
export type ReportLanguage = "ja" | "zh-CN";
export type TranslationStatus = "not_required" | "pending" | "completed" | "failed";
export type ReviewStatus = "not_required" | "unreviewed" | "reviewed" | "needs_review";
export type DailyReportStatus = "provisional" | "submitted";
export type DailyReportCreationMethod = "manual" | "auto_clock_out" | "auto_day_rollover";
export type DailyReportAutomationStatus = "queued" | "generating" | "created" | "blocked_no_memo" | "failed";
export type DailyReportAutomationTrigger = "clock_out" | "day_rollover" | "memo_updated";
export type CompanyDayType = "company_holiday" | "workday";
export type CalendarEventType = "work" | "business_trip" | "leave";
export type InstructionPriority = "normal" | "urgent";
export type InstructionRecipientStatus = "pending" | "acknowledged" | "completed";
export type InstructionStatus = "active" | "completed" | "cancelled";

export interface DemoRecordMetadata {
  isDemo?: boolean;
  demoDatasetId?: string;
  seedVersion?: string;
}

export interface DemoDataset extends DemoRecordMetadata {
  id: string;
  label: string;
  demoUserId: string;
  demoUserEmail: string;
  seedVersion: string;
  periodStart: string;
  periodEnd: string;
  status: "ready" | "reset" | "removed";
  counts: Record<string, number>;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface UserProfile extends DemoRecordMetadata {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  locale: Locale;
  active: boolean;
  createdAt?: Timestamp;
}

export interface AnnouncementRecipient extends DemoRecordMetadata {
  uid: string;
  displayName: string;
  role: Role;
  active: boolean;
}

export interface InstructionRecipientState {
  userId: string;
  displayName: string;
  status: InstructionRecipientStatus;
  acknowledgedAt?: Timestamp;
  completedAt?: Timestamp;
  completionNote?: string;
}

export interface PresidentInstruction extends DemoRecordMetadata {
  id: string;
  authorId: string;
  authorName: string;
  authorRole?: Role;
  sourceLocale?: Locale;
  titleOriginal: string;
  bodyOriginal: string;
  titleJa?: string;
  bodyJa?: string;
  titleZh?: string;
  bodyZh?: string;
  translationStatus: "pending" | "completed" | "failed";
  translationError?: string;
  translationAttempts: number;
  priority: InstructionPriority;
  dueDate: string;
  attachments?: Attachment[];
  recipientIds: string[];
  recipientStates: Record<string, InstructionRecipientState>;
  status: InstructionStatus;
  cancelledAt?: Timestamp;
  cancelledBy?: string;
  cancellationReason?: string;
  replacesInstructionId?: string;
  replacedByInstructionId?: string;
  completedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AttendanceRecord extends DemoRecordMetadata {
  id: string;
  userId: string;
  userName: string;
  workMode: WorkMode;
  workDate: string;
  status: "active" | "completed";
  startedAt: Timestamp;
  endedAt?: Timestamp;
  startEntryMethod?: "realtime" | "manual";
  clockInRecordedAt?: Timestamp;
  manualStartReason?: string;
  corrected: boolean;
  correctionReason?: string;
  needsReview: boolean;
  scheduledDayType?: CompanyDayType;
  holidayWork?: boolean;
  holidayLabel?: string;
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

export interface DailyReportComment {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: Extract<Role, "employee_manager" | "president_viewer">;
  body: string;
  createdAt: Timestamp;
}

export interface DailyReport extends ReportFields, DemoRecordMetadata {
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
  status: DailyReportStatus;
  creationMethod?: DailyReportCreationMethod;
  sourceContentHash?: string;
  autoCreatedAt?: Timestamp;
  confirmedAt?: Timestamp;
  confirmedBy?: string;
  reviewStatus: ReviewStatus;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  comments?: DailyReportComment[];
  commentsUpdatedAt?: Timestamp;
  revision: number;
  submittedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DailyReportAutomation extends DemoRecordMetadata {
  id: string;
  userId: string;
  userName: string;
  workDate: string;
  status: DailyReportAutomationStatus;
  triggerReason: DailyReportAutomationTrigger;
  creationMethod?: Exclude<DailyReportCreationMethod, "manual">;
  attemptCount: number;
  maxAttempts: number;
  reportId?: string;
  sourceContentHash?: string;
  lastError?: string;
  completedAt?: Timestamp;
  confirmedAt?: Timestamp;
  confirmedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ReportRevision extends DemoRecordMetadata {
  id: string;
  reportId: string;
  revision: number;
  before: Omit<DailyReport, "id">;
  reason: string;
  changedBy: string;
  changedAt: Timestamp;
}

export interface AuditEvent extends DemoRecordMetadata {
  id: string;
  actorId: string;
  subjectUserId: string;
  entityType: "attendance" | "daily_report" | "daily_report_draft" | "user" | "company_calendar" | "product" | "product_observation";
  entityId: string;
  action: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  createdAt: Timestamp;
}

export interface CompanyHolidayOverride {
  id: string;
  date: string;
  dayType: CompanyDayType;
  label?: string;
  holidayGroupId?: string;
  rangeStart?: string;
  rangeEnd?: string;
  updatedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface CalendarMember {
  id: string;
  displayName: string;
  linkedUserId?: string;
  isCurrentUser?: boolean;
  active: boolean;
  order: number;
}

export interface CalendarParticipant {
  memberId: string;
  displayName: string;
  /** Legacy events created before calendarMembers was introduced. */
  userId?: string;
}

export interface CalendarEvent extends DemoRecordMetadata {
  id: string;
  date: string;
  groupId: string;
  eventType: CalendarEventType;
  startDate: string;
  endDate: string;
  title: string;
  startTime: string;
  endTime: string;
  memo: string;
  participants: CalendarParticipant[];
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CalendarEventInput {
  id?: string;
  groupId?: string;
  eventType: CalendarEventType;
  startDate: string;
  endDate: string;
  title: string;
  startTime?: string;
  endTime?: string;
  memo?: string;
  participantIds: string[];
}

export interface CalendarMemberInput {
  id?: string;
  displayName: string;
  linkedUserId?: string;
  active: boolean;
  order: number;
}

export interface Category {
  id: string;
  labelJa: string;
  labelZh: string;
  active: boolean;
  order: number;
  dutyDefinitionIds?: string[];
}

export type WeeklyPlanStatus = "draft" | "confirmed" | "completed";
export type WeeklyReportStatus = "ai_draft" | "manager_editing" | "finalized";
export type MeetingStatus = "draft" | "finalized";
export type NonWorkingReasonType = "paid_leave" | "absence" | "illness" | "special_leave" | "company_closure" | "other";
export type EvidenceCategory = "estimate" | "product_research" | "maker_material" | "meeting_record" | "contract" | "client_email" | "internal_message" | "minutes" | "other";
export type EvidenceVisibility = "work" | "employment_confidential";

export interface DutyDefinition {
  id: string;
  code: string;
  labelJa: string;
  labelZh: string;
  descriptionJa: string;
  descriptionZh: string;
  active: boolean;
  order: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface EmploymentBasis {
  id: string;
  userId: string;
  userName: string;
  employmentStartDate: string;
  assignedDutyIds: string[];
  descriptionJa: string;
  descriptionZh: string;
  active: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface SourceDocumentReference {
  id: string;
  title: string;
  driveUrl: string;
  documentDate: string;
  confirmedDate: string;
  purpose: string;
  confidential: boolean;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface WeeklyPlan extends DemoRecordMetadata {
  id: string;
  userId: string;
  userName: string;
  weekStart: string;
  weekEnd: string;
  status: WeeklyPlanStatus;
  goals: string;
  productFields: string;
  visitPlans: string;
  deliverables: string;
  consultations: string;
  sourceLanguage: ReportLanguage;
  confirmedAt?: Timestamp;
  confirmedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface WeeklyReportSections {
  executiveSummary: string;
  keyOutcomes: string;
  blockers: string;
  decisionsNeeded: string;
  themes: WeeklyReportTheme[];
  nextPriorities: WeeklyReportPriority[];
  previousGoals: string;
  completedWork: string;
  productResults: string;
  chinaMarketInsights: string;
  planActualGap: string;
  continuingIssues: string;
  nextWeekPlan: string;
  pendingItems: string;
}

export interface WeeklyReportTheme {
  title: string;
  objective: string;
  activities: string;
  outcomes: string;
  evidence: string;
  chinaMarketInsight: string;
  issues: string;
  nextAction: string;
  sourceReferences: string[];
}

export type WeeklyPriorityBasis = "confirmed" | "proposal";

export interface WeeklyReportPriority {
  title: string;
  basis: WeeklyPriorityBasis;
  owner: string;
  dueDate: string;
  definitionOfDone: string;
}

export interface WeeklyReportMetrics {
  attendanceDays: number;
  totalElapsedMinutes: number;
  submittedReportCount: number;
  reviewedReportCount: number;
  workLogCount: number;
  productObservationCount: number;
  holidayWorkDays: number;
}

export interface WeeklyReport extends WeeklyReportSections, DemoRecordMetadata {
  id: string;
  userId: string;
  userName: string;
  weekStart: string;
  weekEnd: string;
  status: WeeklyReportStatus;
  hasUnreviewedReports: boolean;
  unreviewedReportCount: number;
  metrics?: WeeklyReportMetrics;
  aiError?: string;
  revision: number;
  finalizedAt?: Timestamp;
  finalizedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface WeeklyReportRevision extends DemoRecordMetadata {
  id: string;
  reportId: string;
  before: WeeklyReportSections;
  reason: string;
  changedBy: string;
  changedAt: Timestamp;
}

export interface MeetingActionItem {
  id: string;
  text: string;
  owner: string;
  dueDate: string;
  completed: boolean;
}

export interface WeeklyMeetingRecord extends DemoRecordMetadata {
  id: string;
  weeklyReportId: string;
  userId: string;
  weekStart: string;
  heldAt: string;
  attendees: string;
  feedback: string;
  chinaMarketInformation: string;
  decisions: string;
  currentWeekGoals: string;
  nextCheckItems: string;
  employeeComment: string;
  actionItems: MeetingActionItem[];
  status: MeetingStatus;
  finalizedAt?: Timestamp;
  finalizedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface NonWorkingReason extends DemoRecordMetadata {
  id: string;
  userId: string;
  userName: string;
  workDate: string;
  reasonType: NonWorkingReasonType;
  note: string;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface EvidenceReference extends DemoRecordMetadata {
  id: string;
  subjectUserId: string;
  title: string;
  category: EvidenceCategory;
  documentDate: string;
  parties: string;
  driveUrl: string;
  description: string;
  visibility: EvidenceVisibility;
  relatedReportIds: string[];
  relatedWeeklyReportIds: string[];
  relatedProductIds: string[];
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface MonthlyPackageVersion {
  version: number;
  generatedAt: string;
  generatedBy: string;
  driveUrl: string;
  status: "current" | "superseded";
  sourceUpdatedAt?: string;
}

export interface MonthlyEvidencePackage extends DemoRecordMetadata {
  id: string;
  userId: string;
  month: string;
  versions: MonthlyPackageVersion[];
  needsRegeneration: boolean;
  updatedAt?: Timestamp;
}

export interface RenewalChecklistItem {
  id: string;
  label: string;
  owner: string;
  status: "not_started" | "in_progress" | "completed" | "not_applicable";
  evidenceUrl: string;
  note: string;
}

export interface RenewalChecklist {
  id: string;
  userId: string;
  userName: string;
  residenceExpiryDate: string;
  administrativeScrivenerCheckDate: string;
  immigrationGuidanceCheckDate: string;
  items: RenewalChecklistItem[];
  updatedBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface WorkTag extends DemoRecordMetadata {
  id: string;
  label: string;
  userId: string;
  active: boolean;
  order: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface WorkLogEntry extends DemoRecordMetadata {
  id: string;
  userId: string;
  userName?: string;
  workDate: string;
  tagId: string;
  tagLabel: string;
  text: string;
  attachments?: Attachment[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface GeneratedReportDraft extends ReportFields {
  sourceContentHash: string;
  aiMeta: {
    cached: boolean;
    successfulGenerations: number;
    analyzedAttachmentCount: number;
    analyzedAttachmentNames?: string[];
    skippedLinkCount: number;
  };
}

export type ProductStatus = "new" | "considering" | "on_hold" | "closed";
export type ProductSource = "store" | "business_trip" | "internet" | "flyer" | "other";
export type ProductObservationReviewStatus = "unreviewed" | "reviewed" | "needs_review";
export type ProductPhotoKind = "front" | "jan" | "ingredients";

export interface ProductPhoto {
  kind: ProductPhotoKind;
  name: string;
  contentType: "image/jpeg";
  size: number;
  storagePath: string;
  downloadUrl: string;
}

export interface ProductFacts {
  name: string;
  jan: string;
  makerBrand: string;
  ingredients: string;
}

export interface Product extends ProductFacts, DemoRecordMetadata {
  id: string;
  representativePhoto?: ProductPhoto;
  /** Current shared estimate-request state for this product. */
  estimateRequested?: boolean;
  estimateRequestUpdatedBy?: string;
  estimateRequestUpdatedByName?: string;
  estimateRequestUpdatedAt?: Timestamp;
  status: ProductStatus;
  observationCount: number;
  latestObserverId: string;
  latestObserverName: string;
  latestDiscoveredAt: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProductObservation extends DemoRecordMetadata {
  id: string;
  productId: string;
  userId: string;
  userName: string;
  discoveredDate: string;
  source: ProductSource;
  sourceDetail: string;
  reasonOriginal: string;
  reasonLanguage: ReportLanguage;
  reasonJapanese: string;
  /** Whether this registration included an estimate request. */
  estimateRequested?: boolean;
  translationStatus: TranslationStatus;
  translationAttempts: number;
  photos: ProductPhoto[];
  reviewStatus: ProductObservationReviewStatus;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  revision: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProductRevision extends DemoRecordMetadata {
  id: string;
  productId: string;
  before: ProductFacts;
  after: ProductFacts;
  reason: string;
  changedBy: string;
  changedAt: Timestamp;
}

export interface ProductImageAnalysis extends ProductFacts {
  warnings: string[];
  janValid: boolean;
}

export type NavSection = "home" | "report" | "records" | "products" | "workflow" | "admin" | "help" | "settings";
