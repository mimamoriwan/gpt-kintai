import { EmailAuthProvider, reauthenticateWithCredential, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions, prepareCallableSecurityContext, preparePublicCallableSecurityContext } from "../firebase";
import { invokeWithVerifiedSecurityContext } from "../lib/callable";

export interface ManagedAccount {
  uid: string;
  displayName: string;
  email: string;
  role: string;
  recovery: { status: "off" | "enabled" | "processing" | "completed" | "expired"; expiresAt?: string };
  emailChangePending?: boolean;
  pendingEmail?: string;
}

export interface AccountManagementResult { canManage: boolean; accounts?: ManagedAccount[] }
export interface AccountRecoveryResult { token?: string; expiresAt?: string }

export async function getAccountManagement(): Promise<AccountManagementResult> {
  const call = httpsCallable<Record<string, never>, AccountManagementResult>(functions, "getAccountManagement");
  return (await invokeWithVerifiedSecurityContext(prepareCallableSecurityContext, () => call({}))).data;
}

export async function setAccountRecovery(uid: string, enabled: boolean): Promise<AccountRecoveryResult> {
  const call = httpsCallable<{ uid: string; enabled: boolean }, AccountRecoveryResult>(functions, "setAccountRecovery");
  return (await invokeWithVerifiedSecurityContext(prepareCallableSecurityContext, () => call({ uid, enabled }))).data;
}

export async function changeAccountEmail(uid: string, email: string): Promise<void> {
  const call = httpsCallable<{ uid: string; email: string }, { success: true }>(functions, "changeAccountEmail");
  await invokeWithVerifiedSecurityContext(prepareCallableSecurityContext, () => call({ uid, email }));
}

export async function completeAccountRecovery(token: string, newPassword: string): Promise<{ email: string }> {
  // Public recovery must not attach an unrelated or revoked signed-in session.
  // This happens only after the user explicitly submits the new password.
  if (auth.currentUser) await signOut(auth);
  const call = httpsCallable<{ token: string; newPassword: string }, { email: string }>(functions, "completeAccountRecovery");
  return (await invokeWithVerifiedSecurityContext(preparePublicCallableSecurityContext, () => call({ token, newPassword }))).data;
}

export async function reauthenticateAccountManager(password: string, authoritativeEmail?: string): Promise<void> {
  const user = auth.currentUser;
  const email = authoritativeEmail ?? user?.email;
  if (!user || !email) throw Object.assign(new Error("Authentication required."), { code: "functions/unauthenticated" });
  // An interrupted self-email update may leave the SDK's cached email behind
  // the authoritative account listing. Firebase still verifies the same UID.
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
  if (auth.currentUser !== user) throw Object.assign(new Error("Authentication changed."), { code: "functions/unauthenticated" });
  await user.getIdToken(true);
}

export function accountErrorReason(error: unknown): string {
  if (typeof error !== "object" || error === null || !("details" in error)) return "";
  const details = error.details;
  return typeof details === "object" && details !== null && "reason" in details && typeof details.reason === "string" ? details.reason : "";
}

export function accountErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
}
