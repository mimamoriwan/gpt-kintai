import type { DailyReport, DailyReportComment } from "../types";

export function reportReplies(report: DailyReport, uid: string): DailyReportComment[] {
  if (report.userId !== uid || report.status === "provisional") return [];
  return (report.comments || []).filter((comment) => comment.authorId !== uid &&
    (comment.authorRole === "employee_manager" || comment.authorRole === "president_viewer"));
}

export function unreadReportReplies(report: DailyReport, uid: string): DailyReportComment[] {
  const readIds = new Set(report.commentsReadIds || []);
  return reportReplies(report, uid).filter((comment) => !readIds.has(comment.id));
}
