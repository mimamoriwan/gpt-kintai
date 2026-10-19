import { httpsCallable } from "firebase/functions";
import { auth, functions, prepareCallableSecurityContext } from "../../firebase";
import { invokeWithVerifiedSecurityContext } from "../../lib/callable";
import type { Locale } from "../../types";
import type {
  BusinessDetail, BusinessHistoryPage, BusinessInitiativeInput, BusinessStatus, BusinessThemeInput,
  BusinessTranslation, BusinessTranslationInput, BusinessWorkspace
} from "./types";

export const businessFeatureAvailable = import.meta.env.VITE_BUSINESS_FEATURE_ENABLED === "true";

async function callBusiness<Input, Output>(name: string, input: Input): Promise<Output> {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error("ログインが必要です。"), { code: "functions/unauthenticated" });
  const callable = httpsCallable<Input, Output>(functions, name);
  const result = await invokeWithVerifiedSecurityContext(prepareCallableSecurityContext, () => {
    if (auth.currentUser !== user) throw Object.assign(new Error("アカウントが切り替わりました。"), { code: "business/account-changed" });
    return callable(input);
  });
  if (auth.currentUser !== user) throw Object.assign(new Error("アカウントが切り替わりました。"), { code: "business/account-changed" });
  return result.data;
}

export const getBusinessWorkspace = () => callBusiness<Record<string, never>, BusinessWorkspace>("getBusinessWorkspace", {});
export const getBusinessInitiativeDetail = (input: { initiativeId: string; updatesCursor?: string; historyCursor?: string }) => callBusiness<typeof input, BusinessDetail>("getBusinessInitiativeDetail", input);
export const getBusinessHistory = (input: { kind: "theme" | "settings"; id: string; cursor?: string }) => callBusiness<typeof input, BusinessHistoryPage>("getBusinessHistory", input);
export const saveBusinessTheme = (input: BusinessThemeInput) => callBusiness<typeof input, { id: string; version: number }>("saveBusinessTheme", input);
export const saveBusinessInitiative = (input: BusinessInitiativeInput) => callBusiness<typeof input, { id: string; version: number }>("saveBusinessInitiative", input);
export const setBusinessArchived = (input: { kind: "theme" | "initiative"; id: string; expectedVersion: number; archived: boolean }) => callBusiness<typeof input, { id: string; version: number }>("setBusinessArchived", input);
export const postBusinessUpdate = (input: { id: string; initiativeId: string; body: string; sourceLocale: Locale }) => callBusiness<typeof input, { id: string }>("postBusinessUpdate", input);
export const setBusinessStatus = (input: { initiativeId: string; expectedVersion: number; status: BusinessStatus }) => callBusiness<typeof input, { id: string; version: number }>("setBusinessStatus", input);
export const setBusinessMilestoneCompletion = (input: { initiativeId: string; milestoneId: string; expectedVersion: number; completed: boolean }) => callBusiness<typeof input, { id: string; version: number }>("setBusinessMilestoneCompletion", input);
export const saveBusinessSettings = (input: { expectedVersion: number; enabled: boolean; memberIds: string[] }) => callBusiness<typeof input, { version: number }>("saveBusinessSettings", input);
export const translateBusinessContent = (input: BusinessTranslationInput) => callBusiness<typeof input, BusinessTranslation>("translateBusinessContent", input);

export function businessErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code).replace(/^functions\//, "") : "unknown";
}
export function businessErrorMessage(error: unknown, locale: Locale): string {
  const zh = locale === "zh-CN";
  switch (businessErrorCode(error)) {
    case "aborted": return zh ? "其他成员已更新此内容。输入已保留，请获取最新内容并核对后再保存。" : "他の方が更新しました。入力は残しています。最新情報を取得し、内容を確認してから保存してください。";
    case "permission-denied": return zh ? "无法使用此内容，请确认共享成员和操作权限。" : "この内容を利用できません。共有メンバーと操作権限をご確認ください。";
    case "unauthenticated": case "business/account-changed": return zh ? "请重新确认登录账号。" : "ログイン中のアカウントをご確認ください。";
    case "failed-precondition": return zh ? "此功能已暂停，或当前内容不可修改。请获取最新信息。" : "この機能は停止中、または現在変更できない項目です。最新情報を取得してください。";
    case "not-found": return zh ? "找不到指定的内容。请更新列表。" : "指定の項目が見つかりません。一覧を更新してください。";
    case "invalid-argument": return zh ? "请检查输入内容、共享成员和计划期间。" : "入力内容・共有メンバー・予定期間をご確認ください。";
    default: return zh ? "无法完成通信。输入已保留，请更新以确认保存结果后重试。" : "通信を完了できませんでした。入力は残しています。更新して保存結果を確認してから再試行してください。";
  }
}
