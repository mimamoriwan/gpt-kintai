import type { ManagedAccount } from "../../src/services/accountManagement";
const accounts: ManagedAccount[] = [
  { uid: "preview-owner", displayName: "管理担当者（確認用）", email: "manager@example.test", role: "employee_manager", recovery: { status: "off" } },
  { uid: "preview-employee", displayName: "従業員（確認用）", email: "employee@example.test", role: "employee", recovery: { status: "off" } },
  { uid: "preview-president", displayName: "社長（確認用）", email: "president@example.test", role: "president_viewer", recovery: { status: "completed" } }
];
export async function getAccountManagement() { return { canManage: true, accounts: structuredClone(accounts) }; }
export async function setAccountRecovery(uid: string, enabled: boolean) {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  accounts.find(row => row.uid === uid)!.recovery = enabled ? { status: "enabled", expiresAt } : { status: "off" };
  return enabled ? { token: "p".repeat(43), expiresAt } : {};
}
export async function changeAccountEmail(uid: string, email: string) { accounts.find(row => row.uid === uid)!.email = email; }
export async function completeAccountRecovery() { accounts[1].recovery = { status: "completed" }; return { email: "employee@example.test" }; }
export async function reauthenticateAccountManager() {}
export const accountErrorReason = () => "";
export const accountErrorCode = () => "";
