import type { Locale, Role } from "../../types";
export interface TodoItem {
  id: string; title: string; goal: string; progress: number; memo: string;
  sourceLocale: Locale; memoLocale: Locale; withdrawn: boolean;
  carriedFrom?: { weekStart: string; itemId: string };
}
export interface TodoSnapshot { items: TodoItem[]; at: number; revision: number; contentVersion: string }
export interface TodoWeek {
  userId: string; weekStart: string; shared: TodoSnapshot;
  initial: TodoSnapshot; review: TodoSnapshot | null; reviewRevision: number | null;
}
export interface TodoWorkspace {
  weekStart: string; weekEnd: string; targetDate: string; fetchedAt: number;
  members: { uid: string; displayName: string; role: Role }[]; weeks: TodoWeek[];
  ownDraft: { items: TodoItem[]; version: number } | null; carryover: TodoItem[];
  reportLink?: { reportDate: string; items: { itemId: string; added: boolean }[] } | null;
}
export interface TodoMutation { weekStart: string; expectedVersion: number; operationId: string; items: TodoItem[] }
export interface TodoHistory { kind: "share" | "review"; snapshot: TodoSnapshot }
export interface TodoTranslation { fields: Record<string, string>; contentVersion: string; targetLocale: Locale }
