import { isAppCheckThrottleError } from "./callable";

export function announcementErrorMessage(error: unknown, locale: string): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "").replace(/^appCheck\//, "app-check/")
    : "";
  const ja = locale === "ja";
  if (isAppCheckThrottleError(error)) {
    return ja
      ? "アプリ認証の再試行が一時的に制限されています。件数や容量が原因ではありません。入力内容と添付はこの画面に保持しています。件名・本文・宛先を控えてからページを再読み込みし、資料を選び直してください。再読み込み後も続く場合は、管理担当者へ連絡してください。"
      : "应用验证暂时限制重试，与附件数量或大小无关。输入内容和附件仍保留在此页面。请先记录标题、正文和收件人，再刷新页面并重新选择附件。如刷新后仍未恢复，请联系管理员。";
  }
  if (code === "unauthenticated" || code === "functions/unauthenticated" || code === "storage/unauthenticated") {
    return ja
      ? "ログイン状態またはアプリ認証を確認できませんでした。入力内容と添付はこの画面に保持しています。通信状態を確認し、もう一度発信してください。改善しない場合は、件名・本文・宛先を控えてから再ログインし、資料を選び直してください。"
      : "无法确认登录状态或应用验证。输入内容和附件仍保留在此页面。请检查网络后重新发布。如仍未恢复，请先记录标题、正文和收件人，再重新登录并选择附件。";
  }
  if (code.startsWith("app-check/")) {
    return ja
      ? "アプリ認証を確認できませんでした。入力内容と添付はこの画面に保持しています。通信状態を確認し、もう一度発信してください。改善しない場合は、管理担当者へ連絡してください。"
      : "无法验证应用。输入内容和附件仍保留在此页面。请检查网络后重新发布。如仍未恢复，请联系管理员。";
  }
  if (["storage/retry-limit-exceeded", "storage/unknown", "functions/unavailable", "functions/deadline-exceeded"].includes(code)) {
    return ja
      ? "送信結果を確認できませんでした。入力内容と添付はこの画面に保持しています。通信状態と発信済みのお知らせを確認してから、もう一度発信してください。"
      : "无法确认发送结果。输入内容和附件仍保留在此页面。请检查网络和已发布的通知后，再次发布。";
  }
  if (code === "storage/unauthorized" || code === "functions/permission-denied") {
    return ja
      ? "お知らせや添付資料を送信する権限を確認できませんでした。入力内容と添付はこの画面に保持しています。管理担当者へ連絡してください。"
      : "无法确认发布通知或上传附件的权限。输入内容和附件仍保留在此页面。请联系管理员。";
  }
  return error instanceof Error ? error.message : ja ? "お知らせを発信できませんでした。入力内容と添付はこの画面に保持しています。" : "通知未能发布。输入内容和附件仍保留在此页面。";
}
