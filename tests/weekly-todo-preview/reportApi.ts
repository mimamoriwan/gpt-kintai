import { previewLogs } from "./api";
import type { WorkLogEntry } from "../../src/types";
export function watchWorkLogs(uid: string, date: string, callback: (rows: WorkLogEntry[]) => void) {
  const time = { toDate: () => new Date(), toMillis: () => Date.now() };
  callback([...previewLogs].filter(([, row]) => row.userId === uid && row.workDate === date).map(([id, row]) => ({ id, ...row, createdAt: time, updatedAt: time })) as WorkLogEntry[]);
  return () => undefined;
}
export function watchWorkTags(_uid: string, callback: (rows: never[]) => void) { callback([]); return () => undefined; }
export const addWorkLog = async () => undefined;
export const updateWorkLog = async () => undefined;
export const removeWorkLog = async () => undefined;
export const saveWorkTag = async () => "preview";
export const makeLinkAttachment = () => { throw Error("確認用画面です"); };
export const generateReportDraft = async () => { throw Error("確認用画面ではAIに接続しません"); };
export const submitReport = async () => { throw Error("確認用画面では正式提出しません"); };
