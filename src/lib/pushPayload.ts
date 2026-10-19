export interface AnnouncementPushPayload {
  type: "announcement" | "test";
  eventId: string;
  instructionId: string;
  userId: string;
  locale: "ja" | "zh-CN";
}
export function parsePushPayload(raw: unknown): AnnouncementPushPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if ((row.type !== "announcement" && row.type !== "test")
    || typeof row.eventId !== "string" || !/^[A-Za-z0-9_-]{1,180}$/.test(row.eventId)
    || typeof row.userId !== "string" || !/^[^/]{1,128}$/.test(row.userId)
    || typeof row.instructionId !== "string"
    || (row.type === "announcement" ? !/^[A-Za-z0-9_-]{1,128}$/.test(row.instructionId) : row.instructionId !== "")) return null;
  return { type: row.type, eventId: row.eventId, instructionId: row.instructionId, userId: row.userId, locale: row.locale === "zh-CN" ? "zh-CN" : "ja" };
}
export function pushNotificationOptions(payload: AnnouncementPushPayload) {
  const zh = payload.locale === "zh-CN";
  return {
    title: payload.type === "test" ? (zh ? "测试通知" : "テスト通知") : (zh ? "您有新的通知" : "新しいお知らせがあります"),
    options: { body: payload.type === "test" ? (zh ? "此设备可以接收通知。" : "この端末で通知を受け取れます。") : (zh ? "请打开应用查看。" : "アプリを開いて確認してください。"),
      tag: payload.eventId, renotify: false, icon: "/pwa-192.png", data: { instructionId: payload.instructionId, userId: payload.userId } }
  };
}
