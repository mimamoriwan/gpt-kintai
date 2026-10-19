import type { PresidentInstruction, UserProfile } from "../types";

// Storage may be unavailable in private browsing. Keep dismissal/delivery
// deduplication for this page session even in that case.
const sessionDeliveries = new Map<string, string>();
const failedStorageWrites = new Set<string>();

export function instructionReminderScope(profile: UserProfile): string {
  return JSON.stringify([profile.uid, profile.isDemo === true, profile.demoDatasetId || ""]);
}

function deliveryKey(scope: string, row: PresidentInstruction): string {
  return `gyoumulog-instruction-reminder:${JSON.stringify([scope, row.isDemo === true, row.demoDatasetId || "", row.id])}`;
}

function deliveryVersion(row: PresidentInstruction, uid: string, day: string): string {
  const recipient = row.recipientStates[uid];
  return JSON.stringify([day, recipient?.reminderCount || 0, recipient?.lastRemindedAt?.toMillis?.() || 0]);
}

export function instructionReminderWasShown(scope: string, row: PresidentInstruction, uid: string, day: string): boolean {
  const key = deliveryKey(scope, row);
  if (failedStorageWrites.has(key)) return sessionDeliveries.get(key) === deliveryVersion(row, uid, day);
  let recorded: string | null | undefined;
  try {
    recorded = window.localStorage.getItem(key);
  } catch {
    recorded = sessionDeliveries.get(key);
  }
  return recorded === deliveryVersion(row, uid, day);
}

export function markInstructionReminderShown(scope: string, row: PresidentInstruction, uid: string, day: string): void {
  const key = deliveryKey(scope, row);
  const version = deliveryVersion(row, uid, day);
  sessionDeliveries.set(key, version);
  try {
    window.localStorage.setItem(key, version);
    failedStorageWrites.delete(key);
  } catch {
    failedStorageWrites.add(key);
    // A reminder must never prevent the recipient from using the app.
  }
}

export function nextJstReminderDelay(now = Date.now()): number {
  const day = 24 * 60 * 60 * 1000;
  return day - ((now + 9 * 60 * 60 * 1000) % day) + 50;
}

export function pendingReminderInstructions(instructions: PresidentInstruction[], uid: string): PresidentInstruction[] {
  return instructions.filter((row) => row.status === "active" && row.recipientIds.includes(uid) && row.recipientStates[uid]?.status === "pending").sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "urgent" ? -1 : 1;
    if (a.dueDate !== b.dueDate) {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    return (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
  });
}
