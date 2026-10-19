const storageKey = "gyoumulog-missed-clockout-recovery-v1";
const maxDraftAgeMs = 30 * 60 * 1000;

export type MissedClockOutDraft = {
  userId: string;
  attendanceId: string;
  workDate: string;
  endedAtLocal: string;
  reason: string;
  savedAt: number;
};

export function readMissedClockOutDraft(userId: string): MissedClockOutDraft | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<MissedClockOutDraft> | null;
    if (!draft || typeof draft.userId !== "string" || typeof draft.attendanceId !== "string"
      || typeof draft.workDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(draft.workDate)
      || typeof draft.endedAtLocal !== "string" || draft.endedAtLocal.length > 32
      || typeof draft.reason !== "string" || draft.reason.length > 5000
      || typeof draft.savedAt !== "number" || !Number.isFinite(draft.savedAt)
      || Date.now() < draft.savedAt || Date.now() - draft.savedAt > maxDraftAgeMs) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }
    return draft.userId === userId ? draft as MissedClockOutDraft : null;
  } catch {
    return null;
  }
}

export function clearMissedClockOutDraft(userId: string, attendanceId: string): void {
  try {
    const draft = readMissedClockOutDraft(userId);
    if (draft?.attendanceId === attendanceId) window.sessionStorage.removeItem(storageKey);
  } catch {
    // Storage can be unavailable; clearing a draft must not fail a saved correction.
  }
}

export function reloadWithMissedClockOutDraft(
  input: Omit<MissedClockOutDraft, "savedAt">,
  reload: () => void = () => window.location.reload()
): boolean {
  try {
    const draft = { ...input, savedAt: Date.now() };
    const serialized = JSON.stringify(draft);
    window.sessionStorage.setItem(storageKey, serialized);
    // Only leave the form once the browser has retained the complete draft.
    if (window.sessionStorage.getItem(storageKey) !== serialized
      || JSON.stringify(readMissedClockOutDraft(input.userId)) !== serialized) return false;
  } catch {
    return false;
  }
  reload();
  return true;
}
