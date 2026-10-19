import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

export type PasswordAuthContext = { uid: string; token: Record<string, unknown> };
export const PASSWORD_CHANGE_LEASE_MS = 2 * 60 * 1000;
const RECENT_LOGIN_SECONDS = 5 * 60;

type Profile = Record<string, unknown>;
interface Dependencies {
  db: Firestore;
  auth: Pick<Auth, "updateUser">;
  now?: () => Timestamp;
  operationId?: () => string;
  wait?: (milliseconds: number) => Promise<void>;
}

function failure(reason: string, message: string, code: "failed-precondition" | "invalid-argument" | "unavailable" | "permission-denied" = "failed-precondition"): never {
  throw new HttpsError(code, message, { reason });
}

export async function requireWorkAuth(
  auth: PasswordAuthContext | undefined,
  readProfile: (uid: string) => Promise<Profile | undefined>
): Promise<PasswordAuthContext> {
  if (!auth) throw new HttpsError("unauthenticated", "ログインが必要です。");
  // Read current server state on every request; old ID tokens must not bypass the gate.
  const profile = await readProfile(auth.uid);
  if (!profile || profile.uid !== auth.uid || profile.active !== true
    || typeof profile.role !== "string" || !["employee", "employee_manager", "president_viewer"].includes(profile.role)) {
    failure("work-account-unavailable", "このアカウントでは勤怠を利用できません。管理担当者へ連絡してください。", "permission-denied");
  }
  if (profile.passwordChangeRequired === true) {
    failure("password-change-required", "先に新しいパスワードを設定してください。");
  }
  if ("passwordAuthTimeAfter" in profile) {
    const cutoff = profile.passwordAuthTimeAfter;
    const authTime = auth.token.auth_time;
    if (typeof cutoff !== "number" || !Number.isFinite(cutoff) || typeof authTime !== "number" || !Number.isFinite(authTime) || authTime <= cutoff) {
      failure("recent-login-required", "新しいパスワードでもう一度ログインしてください。");
    }
  }
  // Authorize with the latest server-owned role, without changing other claims
  // or the caller's original token. Existing password sign-ins remain valid.
  return { ...auth, token: { ...auth.token, role: profile.role } };
}

export function passwordSetupHash(password: string, salt: string): string {
  if (!/^[a-f0-9]{64}$/i.test(salt)) failure("password-setup-unavailable", "パスワード設定を確認できません。管理担当者へ連絡してください。");
  return scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex");
}

function sameHash(first: unknown, second: string): boolean {
  return typeof first === "string" && /^[a-f0-9]{128}$/i.test(first)
    && timingSafeEqual(Buffer.from(first, "hex"), Buffer.from(second, "hex"));
}

function timestamp(value: unknown): value is Timestamp {
  return value instanceof Timestamp;
}

export async function completePasswordSetup(auth: PasswordAuthContext | undefined, input: unknown, dependencies: Dependencies): Promise<{ success: true }> {
  if (!auth) throw new HttpsError("unauthenticated", "ログインが必要です。");
  const password = input && typeof input === "object" && "newPassword" in input ? input.newPassword : undefined;
  if (typeof password !== "string" || password.length < 6) failure("password-too-short", "パスワードは6文字以上にしてください。", "invalid-argument");
  if (password.length > 128) failure("password-too-long", "パスワードは128文字以内にしてください。", "invalid-argument");
  const { db } = dependencies;
  const now = dependencies.now || Timestamp.now;
  const operationId = (dependencies.operationId || randomUUID)();
  const wait = dependencies.wait || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  async function waitForNewAuthSecond(cutoff: number) {
    const currentTime = now();
    if (currentTime.seconds <= cutoff) await wait(Math.min(1050, (cutoff + 1) * 1000 - currentTime.toMillis() + 25));
  }
  let completedAuthTimeAfter: number | undefined;
  const profileRef = db.doc(`users/${auth.uid}`);
  const setupRef = db.doc(`passwordSetups/${auth.uid}`);
  let lock: { resetId: string; chosenPasswordHash: string } | null;

  try {
    lock = await db.runTransaction(async (transaction) => {
      const [profileSnapshot, setupSnapshot] = await Promise.all([transaction.get(profileRef), transaction.get(setupRef)]);
      const profile = profileSnapshot.data();
      const setup = setupSnapshot.data();
      if (!profileSnapshot.exists || profile?.uid !== auth.uid || profile.active !== true || profile.role !== "employee") {
        failure("password-setup-unavailable", "このアカウントではパスワードを設定できません。", "permission-denied");
      }
      if (!setupSnapshot.exists || !setup || typeof setup.resetId !== "string" || !setup.resetId || profile.passwordResetId !== setup.resetId) {
        failure("password-setup-unavailable", "パスワード設定を確認できません。管理担当者へ連絡してください。");
      }
      // A lost success response can be retried. The client signs in with its chosen password next.
      if (profile.passwordChangeRequired === false && setup.status === "completed") {
        if (typeof profile.passwordAuthTimeAfter !== "number" || !Number.isFinite(profile.passwordAuthTimeAfter)) {
          failure("password-setup-unavailable", "パスワード設定を確認できません。管理担当者へ連絡してください。");
        }
        completedAuthTimeAfter = profile.passwordAuthTimeAfter;
        return null;
      }
      if (profile.passwordChangeRequired === true && setup.status === "issuing") {
        failure("password-setup-not-ready", "仮パスワードの準備中です。少し待ってからログインし直してください。");
      }
      if (profile.passwordChangeRequired !== true || !["required", "changing"].includes(setup.status)) {
        failure("password-setup-unavailable", "パスワード設定を確認できません。管理担当者へ連絡してください。");
      }
      const currentTime = now();
      if (!timestamp(setup.expiresAt) || (setup.status === "required" && setup.expiresAt.toMillis() <= currentTime.toMillis())) {
        failure("password-setup-expired", "パスワード設定の期限が切れています。管理担当者へ連絡してください。");
      }
      const authTime = auth.token.auth_time;
      if (!timestamp(setup.requestedAt) || typeof authTime !== "number" || !Number.isFinite(authTime)
        || authTime < setup.requestedAt.seconds || authTime > currentTime.seconds + 30 || currentTime.seconds - authTime > RECENT_LOGIN_SECONDS) {
        failure("recent-login-required", "もう一度ログインしてからパスワードを設定してください。");
      }
      const chosenPasswordHash = passwordSetupHash(password, setup.salt);
      if (!/^[a-f0-9]{128}$/i.test(setup.temporaryPasswordHash || "")) failure("password-setup-unavailable", "パスワード設定を確認できません。管理担当者へ連絡してください。");
      if (sameHash(setup.temporaryPasswordHash, chosenPasswordHash)) {
        failure("password-matches-temporary", "仮パスワードとは異なるパスワードを設定してください。", "invalid-argument");
      }
      if (setup.status === "changing") {
        if (!sameHash(setup.chosenPasswordHash, chosenPasswordHash)) {
          failure("password-change-conflict", "前の変更処理を確認中です。前回入力した新しいパスワードで再試行してください。");
        }
        if (!timestamp(setup.leaseUntil) || setup.leaseUntil.toMillis() > currentTime.toMillis()) {
          failure("password-change-in-progress", "変更処理中です。少し待って同じ新しいパスワードで再試行してください。");
        }
      }
      transaction.update(setupRef, {
        status: "changing", chosenPasswordHash, operationId,
        leaseUntil: Timestamp.fromMillis(currentTime.toMillis() + PASSWORD_CHANGE_LEASE_MS)
      });
      return { resetId: setup.resetId, chosenPasswordHash };
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    failure("password-setup-unavailable", "パスワード設定を確認できません。時間をおいて再試行してください。", "unavailable");
  }
  if (!lock) {
    await waitForNewAuthSecond(completedAuthTimeAfter!);
    return { success: true };
  }

  try {
    // UID, roles, email and other account properties remain unchanged.
    await dependencies.auth.updateUser(auth.uid, { password });
  } catch (error) {
    // A network error may arrive after Auth has changed the password. Keep the lock
    // and chosen hash so a later attempt can only repeat that exact password.
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "auth/invalid-password" || code === "auth/password-does-not-meet-requirements") {
      try {
        await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(setupRef);
          const setup = snapshot.data();
          if (setup?.resetId === lock.resetId && setup.operationId === operationId && setup.status === "changing") {
            transaction.update(setupRef, { status: "required", chosenPasswordHash: FieldValue.delete(), operationId: FieldValue.delete(), leaseUntil: FieldValue.delete() });
          }
        });
      } catch { /* Preserve the gate if releasing the rejected attempt fails. */ }
      failure("password-policy", "このパスワードは設定できません。別のパスワードを入力してください。", "invalid-argument");
    }
    failure("password-change-retry-same-password", "変更結果を確認できません。少し待って同じ新しいパスワードで再試行してください。", "unavailable");
  }

  try {
    await db.runTransaction(async (transaction) => {
      const [profileSnapshot, setupSnapshot] = await Promise.all([transaction.get(profileRef), transaction.get(setupRef)]);
      const profile = profileSnapshot.data();
      const setup = setupSnapshot.data();
      if (!profileSnapshot.exists || profile?.uid !== auth.uid || profile.active !== true || profile.role !== "employee"
        || profile.passwordResetId !== lock.resetId || profile.passwordChangeRequired !== true
        || !setupSnapshot.exists || setup?.resetId !== lock.resetId || setup.status !== "changing"
        || setup.operationId !== operationId || !sameHash(setup.chosenPasswordHash, lock.chosenPasswordHash)) {
        failure("password-change-retry-same-password", "変更結果を確認できません。同じ新しいパスワードで再試行してください。", "unavailable");
      }
      const completedAt = now();
      completedAuthTimeAfter = completedAt.seconds;
      transaction.update(profileRef, { passwordChangeRequired: false, passwordChangedAt: completedAt, passwordAuthTimeAfter: completedAt.seconds });
      transaction.update(setupRef, {
        status: "completed", completedAt,
        salt: FieldValue.delete(), temporaryPasswordHash: FieldValue.delete(), chosenPasswordHash: FieldValue.delete(),
        operationId: FieldValue.delete(), leaseUntil: FieldValue.delete()
      });
    });
  } catch {
    failure("password-change-retry-same-password", "変更結果を確認できません。少し待って同じ新しいパスワードで再試行してください。", "unavailable");
  }
  // Firebase auth_time is in whole seconds. Ensure the client's immediate fresh
  // sign-in is later than the cutoff that excludes all temporary-password tokens.
  await waitForNewAuthSecond(completedAuthTimeAfter!);
  return { success: true };
}
