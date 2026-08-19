export const MAX_DAILY_DRAFT_FILES = 10;
export const MAX_DAILY_DRAFT_BYTES = 20 * 1024 * 1024;
export const MAX_DAILY_DRAFT_SUCCESSES = 2;

export type DailyDraftAttachmentInput = {
  id?: unknown;
  name?: unknown;
  contentType?: unknown;
  size?: unknown;
  storagePath?: unknown;
  linkUrl?: unknown;
};

export type DailyDraftWorkLogInput = {
  id: string;
  tagLabel?: unknown;
  text?: unknown;
  createdAtMillis?: number;
  attachments?: unknown;
};

export type DailyDraftMemoSource = {
  sourceRef: string;
  tag: string;
  text: string;
  attachmentRefs: string[];
};

export type DailyDraftFileSource = {
  sourceRef: string;
  workLogId: string;
  tag: string;
  id: string;
  name: string;
  contentType: string;
  size: number;
  storagePath: string;
};

export type PreparedDailyDraftSource = {
  memoSources: DailyDraftMemoSource[];
  files: DailyDraftFileSource[];
  skippedLinkCount: number;
  fingerprintJson: string;
};

export type DailyDraftCacheEntry<T> = {
  contentHash: string;
  draft: T;
  analyzedAttachmentCount: number;
  skippedLinkCount: number;
  generatedAt: string;
  inputTokens?: number;
  outputTokens?: number;
};

export function prepareDailyDraftSource(
  settings: { reportDate: string; sourceLanguage: "ja" | "zh-CN"; hasTravel: boolean },
  workLogs: DailyDraftWorkLogInput[]
): PreparedDailyDraftSource {
  const sortedLogs = [...workLogs].sort((a, b) => {
    const byTime = Number(a.createdAtMillis || 0) - Number(b.createdAtMillis || 0);
    return byTime || a.id.localeCompare(b.id);
  });
  const memoSources: DailyDraftMemoSource[] = [];
  const files: DailyDraftFileSource[] = [];
  let skippedLinkCount = 0;

  for (const log of sortedLogs) {
    const tag = String(log.tagLabel || "").trim().slice(0, 80) || "未分類";
    const text = String(log.text || "").trim().slice(0, 1200);
    if (!text) continue;
    const storedAttachments = Array.isArray(log.attachments) ? log.attachments as DailyDraftAttachmentInput[] : [];
    const logFiles = storedAttachments
      .filter((item) => typeof item.storagePath === "string" && item.storagePath.length > 0)
      .map((item, index) => {
        const id = String(item.id || `${log.id}-${index}`).slice(0, 180);
        return {
          sourceRef: `attachment:${log.id}:${id}`,
          workLogId: log.id,
          tag,
          id,
          name: String(item.name || "添付資料").slice(0, 180),
          contentType: String(item.contentType || "").slice(0, 160),
          size: Math.max(0, Number(item.size || 0)),
          storagePath: String(item.storagePath || "")
        };
      })
      .sort((a, b) => a.sourceRef.localeCompare(b.sourceRef));
    skippedLinkCount += storedAttachments.filter((item) => typeof item.linkUrl === "string" && !item.storagePath).length;
    files.push(...logFiles);
    memoSources.push({
      sourceRef: `workLog:${log.id}`,
      tag,
      text,
      attachmentRefs: logFiles.map((item) => item.sourceRef)
    });
  }

  const fingerprintJson = JSON.stringify({
    ...settings,
    memoSources,
    files: files.map(({ sourceRef, workLogId, tag, id, name, contentType, size, storagePath }) => ({
      sourceRef,
      workLogId,
      tag,
      id,
      name,
      contentType,
      size,
      storagePath
    }))
  });
  return { memoSources, files, skippedLinkCount, fingerprintJson };
}

export function assertDailyDraftAttachmentLimits(files: DailyDraftFileSource[]): void {
  if (files.length > MAX_DAILY_DRAFT_FILES) {
    throw new Error(`AIが確認できる添付資料は1日${MAX_DAILY_DRAFT_FILES}件までです。`);
  }
  const totalBytes = files.reduce((sum, item) => sum + item.size, 0);
  if (totalBytes > MAX_DAILY_DRAFT_BYTES) {
    throw new Error("AIが確認できる添付資料は1日合計20MBまでです。");
  }
}

export function canGenerateDailyDraft(successfulGenerations: number): boolean {
  return Number.isFinite(successfulGenerations)
    && Math.max(0, Math.floor(successfulGenerations)) < MAX_DAILY_DRAFT_SUCCESSES;
}

export function findDailyDraftCache<T>(value: unknown, contentHash: string): DailyDraftCacheEntry<T> | null {
  if (!Array.isArray(value)) return null;
  const match = value.find((item) => item && typeof item === "object" && (item as { contentHash?: unknown }).contentHash === contentHash);
  return match ? match as DailyDraftCacheEntry<T> : null;
}
