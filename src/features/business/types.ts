import type { Locale, Role } from "../../types";

export type BusinessStatus = "not_started" | "in_progress" | "on_hold" | "completed";
export type BusinessContentKind = "theme" | "initiative" | "update";
export interface BusinessMember { uid: string; displayName: string; role: Role; active: boolean }
export interface BusinessSettings { enabled: boolean; memberIds: string[]; version: number }
interface BusinessRecord {
  id: string;
  name: string;
  description: string;
  sourceLocale: Locale;
  referenceLinks: string[];
  archived: boolean;
  version: number;
  contentVersion: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}
export interface BusinessTheme extends BusinessRecord { order: number }
export interface BusinessMilestone {
  id: string; name: string; order: number; archived: boolean; completed: boolean;
  updatedAt: number; updatedBy: string;
}
export interface BusinessInitiative extends BusinessRecord {
  themeId: string;
  assigneeIds: string[];
  status: BusinessStatus;
  plannedStartMonth: string;
  plannedEndMonth: string;
  targetMemo: string;
  milestones: BusinessMilestone[];
  latestUpdate?: BusinessUpdate;
}
export interface BusinessUpdate {
  id: string; initiativeId: string; body: string; sourceLocale: Locale;
  authorId: string; authorName: string; createdAt: number; contentVersion: string;
}
export interface BusinessHistory {
  id: string; entityType: "theme" | "initiative" | "settings"; entityId: string;
  action: string; actorId: string; actorName: string; createdAt: number;
  before: unknown; after: unknown;
}
export interface BusinessWorkspace {
  settings: BusinessSettings;
  canManage: boolean;
  members: BusinessMember[];
  memberCandidates: BusinessMember[];
  themes: BusinessTheme[];
  initiatives: BusinessInitiative[];
  fetchedAt: number;
}
export interface BusinessDetail {
  updates: BusinessUpdate[]; history: BusinessHistory[]; fetchedAt: number;
  nextUpdatesCursor: string | null; nextHistoryCursor: string | null;
}
export interface BusinessHistoryPage { history: BusinessHistory[]; nextCursor: string | null; fetchedAt: number }
export interface BusinessThemeInput {
  id: string; expectedVersion: number; name: string; description: string;
  sourceLocale: Locale; order: number; referenceLinks: string[];
}
export interface BusinessInitiativeInput {
  id: string; expectedVersion: number; themeId: string; name: string; description: string;
  sourceLocale: Locale; referenceLinks: string[]; assigneeIds: string[]; status: BusinessStatus;
  plannedStartMonth: string; plannedEndMonth: string; targetMemo: string;
  milestones: Pick<BusinessMilestone, "id" | "name" | "order" | "archived">[];
}
export interface BusinessTranslation {
  kind: BusinessContentKind; id: string; targetLocale: Locale; contentVersion: string;
  fields: Record<string, string>; cached: boolean;
}
export interface BusinessTranslationInput {
  kind: BusinessContentKind; id: string; targetLocale: Locale; expectedContentVersion: string;
}
export interface BusinessAnnouncementDraft { key: string; title: string; body: string }
