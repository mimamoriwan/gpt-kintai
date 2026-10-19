import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { Auth, UserRecord } from "firebase-admin/auth";
import { FieldValue, Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { requireWorkAuth, type PasswordAuthContext } from "./passwordChange.js";

export const ACCOUNT_RECOVERY_TTL_MS = 30 * 60 * 1000;
const RECENT_LOGIN_SECONDS = 5 * 60;
type Row = Record<string, any>;
type Config = { ownerUid: string; managedUids: string[] };
export interface AccountRecoveryDependencies {
  db: Firestore;
  auth: Pick<Auth, "getUser" | "updateUser" | "revokeRefreshTokens">;
  now?: () => Timestamp;
  wait?: (milliseconds: number) => Promise<void>;
  token?: () => string;
  operationId?: () => string;
}

type RecoveryStatus = "off" | "enabled" | "processing" | "completed" | "expired";
export type ManagedAccount = {
  uid: string; displayName: string; email: string; role: string;
  recovery: { status: RecoveryStatus; expiresAt?: string };
  emailChangePending?: boolean;
  pendingEmail?: string;
};

function fail(reason: string, message: string, code: "permission-denied" | "failed-precondition" | "invalid-argument" | "unavailable" = "failed-precondition"): never {
  throw new HttpsError(code, message, { reason });
}
function invalidLink(): never { fail("recovery-link-unavailable", "このリンクは利用できません。管理担当者に再発行を依頼してください。"); }
function unavailable(): never { fail("account-management-unavailable", "アカウント情報を確認できません。時間をおいて再試行してください。", "unavailable"); }
function busy(): never { fail("account-change-in-progress", "変更処理を確認中です。前回と同じ内容で再試行してください。処理が続く場合は管理担当者へ連絡してください。"); }
function uidValid(uid: unknown): uid is string { return typeof uid === "string" && uid.length > 0 && uid.length <= 128 && !uid.includes("/"); }
function readConfig(value: Row | undefined): Config | undefined {
  if (!value || !uidValid(value.ownerUid) || !Array.isArray(value.managedUids) || value.managedUids.length !== 3
    || !value.managedUids.every(uidValid) || new Set(value.managedUids).size !== 3 || !value.managedUids.includes(value.ownerUid)) return undefined;
  return { ownerUid: value.ownerUid, managedUids: [...value.managedUids] };
}
function validProfile(profile: Row | undefined, uid: string): profile is Row {
  return !!profile && profile.uid === uid && profile.active === true && profile.isDemo !== true
    && !profile.demoDatasetId && ["employee", "employee_manager", "president_viewer"].includes(profile.role);
}
function recent(auth: PasswordAuthContext, now: Timestamp) {
  const time = auth.token.auth_time;
  if (typeof time !== "number" || !Number.isFinite(time) || time > now.seconds + 30 || now.seconds - time > RECENT_LOGIN_SECONDS) {
    fail("recent-login-required", "安全のため、もう一度ログインしてから操作してください。");
  }
}
function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function hashPassword(password: string, salt: string): string { return scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex"); }
function equalHash(actual: unknown, expected: string): boolean {
  return typeof actual === "string" && /^[a-f0-9]{128}$/.test(actual)
    && timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
function nowOf(dependencies: AccountRecoveryDependencies) { return (dependencies.now || Timestamp.now)(); }
function running(operation?: Row) { return operation && ["running", "retryable"].includes(operation.status); }
function setupBusy(setup?: Row) { return setup && ["changing", "issuing"].includes(setup.status); }
function iso(value: unknown): string | undefined { return value instanceof Timestamp ? value.toDate().toISOString() : undefined; }
function inputRow(input: unknown): Row { return input && typeof input === "object" && !Array.isArray(input) ? input as Row : {}; }
function authErrorCode(error: unknown): unknown { return error && typeof error === "object" && "code" in error ? error.code : undefined; }

async function activeAuth(dependencies: AccountRecoveryDependencies, uid: string): Promise<UserRecord> {
  try {
    const record = await dependencies.auth.getUser(uid);
    if (record.uid !== uid || record.disabled || !record.email || record.customClaims?.isDemo === true || record.customClaims?.demoDatasetId) fail("managed-account-unavailable", "このアカウントは現在管理できません。");
    return record;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (authErrorCode(error) === "auth/user-not-found") fail("managed-account-unavailable", "このアカウントは現在管理できません。");
    return unavailable();
  }
}

async function ownerContext(auth: PasswordAuthContext | undefined, dependencies: AccountRecoveryDependencies, mutation: boolean): Promise<Config | undefined> {
  const profile = auth ? (await dependencies.db.doc(`users/${auth.uid}`).get()).data() : undefined;
  await requireWorkAuth(auth, async () => profile);
  const config = readConfig((await dependencies.db.doc("accountManagement/config").get()).data());
  if (!config || config.ownerUid !== auth!.uid || !validProfile(profile, auth!.uid) || profile.role !== "employee_manager"
    || auth!.token.isDemo === true || !!auth!.token.demoDatasetId) {
    if (mutation) fail("account-management-forbidden", "この操作はアカウント管理担当者のみ利用できます。", "permission-denied");
    return undefined;
  }
  await activeAuth(dependencies, auth!.uid);
  if (mutation) recent(auth!, nowOf(dependencies));
  return config;
}

// Every mutation reads the owner, configuration and target in the same transaction.
// Role-only managers can neither enrol accounts nor grant themselves ownership.
async function authorizeTransaction(transaction: Transaction, dependencies: AccountRecoveryDependencies, auth: PasswordAuthContext, uid: string): Promise<Row> {
  const [configSnapshot, ownerSnapshot, targetSnapshot] = await Promise.all([
    transaction.get(dependencies.db.doc("accountManagement/config")),
    transaction.get(dependencies.db.doc(`users/${auth.uid}`)),
    transaction.get(dependencies.db.doc(`users/${uid}`))
  ]);
  const config = readConfig(configSnapshot.data());
  const owner = ownerSnapshot.data();
  const target = targetSnapshot.data();
  await requireWorkAuth(auth, async () => owner);
  if (!config || config.ownerUid !== auth.uid || !validProfile(owner, auth.uid) || owner.role !== "employee_manager"
    || auth.token.isDemo === true || !!auth.token.demoDatasetId) fail("account-management-forbidden", "この操作はアカウント管理担当者のみ利用できます。", "permission-denied");
  recent(auth, nowOf(dependencies));
  if (!config.managedUids.includes(uid) || !validProfile(target, uid)) fail("managed-account-unavailable", "このアカウントは現在管理できません。");
  return target;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { if (error instanceof HttpsError) throw error; return unavailable(); }
}

export async function getAccountManagement(auth: PasswordAuthContext | undefined, _input: unknown, dependencies: AccountRecoveryDependencies): Promise<{ canManage: boolean; accounts?: ManagedAccount[] }> {
  return guarded(async () => {
    const config = await ownerContext(auth, dependencies, false);
    if (!config) return { canManage: false };
    const accounts = await Promise.all(config.managedUids.map(async (uid): Promise<ManagedAccount> => {
      const [profileSnapshot, recoverySnapshot, operationSnapshot, user] = await Promise.all([
        dependencies.db.doc(`users/${uid}`).get(), dependencies.db.doc(`accountRecovery/${uid}`).get(),
        dependencies.db.doc(`accountOperations/${uid}`).get(), activeAuth(dependencies, uid)
      ]);
      const profile = profileSnapshot.data();
      if (!validProfile(profile, uid)) fail("managed-account-unavailable", "このアカウントは現在管理できません。");
      const recovery = recoverySnapshot.data();
      const operation = operationSnapshot.data();
      let status: RecoveryStatus = ["enabled", "processing", "completed"].includes(recovery?.status) ? recovery!.status : "off";
      if (status === "enabled" && (!(recovery?.expiresAt instanceof Timestamp) || recovery.expiresAt.toMillis() <= nowOf(dependencies).toMillis())) status = "expired";
      const expiresAt = iso(recovery?.expiresAt);
      return { uid, displayName: typeof profile.displayName === "string" ? profile.displayName : "", email: user.email!, role: profile.role,
        recovery: { status, ...(expiresAt ? { expiresAt } : {}) }, ...(operation?.kind === "email" && running(operation) ? { emailChangePending: true, pendingEmail: String(operation.email) } : {}) };
    }));
    return { canManage: true, accounts };
  });
}

export async function setAccountRecovery(auth: PasswordAuthContext | undefined, input: unknown, dependencies: AccountRecoveryDependencies): Promise<{ token?: string; expiresAt?: string }> {
  return guarded(async () => {
    const config = await ownerContext(auth, dependencies, true);
    const { uid, enabled } = inputRow(input);
    if (!uidValid(uid) || typeof enabled !== "boolean") fail("invalid-account-input", "操作内容を確認してください。", "invalid-argument");
    if (!config!.managedUids.includes(uid)) fail("managed-account-unavailable", "このアカウントは現在管理できません。");
    await activeAuth(dependencies, uid);
    const token = enabled ? (dependencies.token || (() => randomBytes(32).toString("base64url")))() : undefined;
    if (token !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(token)) return unavailable();
    const tokenHash = token ? hashToken(token) : undefined;
    const current = nowOf(dependencies);
    const expiresAt = Timestamp.fromMillis(current.toMillis() + ACCOUNT_RECOVERY_TTL_MS);
    await dependencies.db.runTransaction(async (transaction) => {
      await authorizeTransaction(transaction, dependencies, auth!, uid);
      const recoveryRef = dependencies.db.doc(`accountRecovery/${uid}`);
      const [recoverySnapshot, operationSnapshot, setupSnapshot] = await Promise.all([
        transaction.get(recoveryRef), transaction.get(dependencies.db.doc(`accountOperations/${uid}`)), transaction.get(dependencies.db.doc(`passwordSetups/${uid}`))
      ]);
      const existing = recoverySnapshot.data();
      if (running(operationSnapshot.data()) || existing?.status === "processing" || setupBusy(setupSnapshot.data())) busy();
      if (typeof existing?.tokenHash === "string" && /^[a-f0-9]{64}$/.test(existing.tokenHash)) transaction.delete(dependencies.db.doc(`accountRecoveryTokens/${existing.tokenHash}`));
      transaction.set(recoveryRef, enabled ? { uid, status: "enabled", tokenHash, requestedAt: current, expiresAt, requestedBy: auth!.uid }
        : { uid, status: "off", disabledAt: current, requestedBy: auth!.uid });
      if (enabled) transaction.set(dependencies.db.doc(`accountRecoveryTokens/${tokenHash}`), { uid });
    });
    return token ? { token, expiresAt: expiresAt.toDate().toISOString() } : {};
  });
}

// Only a settled attempt can become retryable. A wall-clock lease can never fence
// Firebase Auth writes: a delayed older updateUser may still arrive after a takeover.
// A process that dies while running therefore stays locked for operator review.
async function markRetryable(dependencies: AccountRecoveryDependencies, uid: string, operationId: string): Promise<void> {
  try {
    await dependencies.db.runTransaction(async (transaction) => {
      const ref = dependencies.db.doc(`accountOperations/${uid}`);
      const row = (await transaction.get(ref)).data();
      if (row?.operationId === operationId && row.status === "running") transaction.update(ref, { status: "retryable", mayHaveWrittenAuth: true, failedAt: nowOf(dependencies) });
    });
  } catch { /* Leave the gate and lock in place rather than allow an unsafe takeover. */ }
}
async function waitForFreshLogin(dependencies: AccountRecoveryDependencies, cutoff: number) {
  const current = nowOf(dependencies);
  if (current.seconds <= cutoff) await (dependencies.wait || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))((cutoff + 1) * 1000 - current.toMillis() + 25);
}

export async function completeAccountRecovery(_auth: PasswordAuthContext | undefined, input: unknown, dependencies: AccountRecoveryDependencies): Promise<{ email: string }> {
  const { token, newPassword } = inputRow(input);
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) invalidLink();
  if (typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 128) fail("password-policy", "パスワードは12〜128文字で入力してください。", "invalid-argument");
  const tokenHash = hashToken(token);
  const operationId = (dependencies.operationId || randomUUID)();
  const tokenRef = dependencies.db.doc(`accountRecoveryTokens/${tokenHash}`);
  let uid: string;
  let email: string;
  let priorAuthWriteUncertain = false;
  try {
    const tokenSnapshot = await tokenRef.get();
    const candidate = tokenSnapshot.data()?.uid;
    if (!uidValid(candidate)) invalidLink();
    uid = candidate;
    const user = await activeAuth(dependencies, uid);
    email = user.email!;
    const receipt = tokenSnapshot.data();
    if (receipt?.status === "completed") {
      const [configSnapshot, profileSnapshot] = await Promise.all([
        dependencies.db.doc("accountManagement/config").get(), dependencies.db.doc(`users/${uid}`).get()
      ]);
      const config = readConfig(configSnapshot.data());
      if (!config || !config.managedUids.includes(uid) || !validProfile(profileSnapshot.data(), uid)
        || !(receipt.expiresAt instanceof Timestamp) || receipt.expiresAt.toMillis() <= nowOf(dependencies).toMillis()
        || !(receipt.completedAt instanceof Timestamp) || receipt.email !== email
        || !/^[a-f0-9]{64}$/.test(receipt.passwordSalt || "")
        || !equalHash(receipt.passwordHash, hashPassword(newPassword, receipt.passwordSalt))) invalidLink();
      // A lost success response can be acknowledged only with the chosen password.
      // This receipt never authorizes another Auth mutation and expires with the grant.
      await waitForFreshLogin(dependencies, receipt.completedAt.seconds);
      return { email };
    }
    priorAuthWriteUncertain = await dependencies.db.runTransaction(async (transaction) => {
      const recoveryRef = dependencies.db.doc(`accountRecovery/${uid}`);
      const operationRef = dependencies.db.doc(`accountOperations/${uid}`);
      const profileRef = dependencies.db.doc(`users/${uid}`);
      const setupRef = dependencies.db.doc(`passwordSetups/${uid}`);
      const [configSnapshot, tokenSnapshot, recoverySnapshot, operationSnapshot, profileSnapshot, setupSnapshot] = await Promise.all([
        transaction.get(dependencies.db.doc("accountManagement/config")), transaction.get(tokenRef), transaction.get(recoveryRef),
        transaction.get(operationRef), transaction.get(profileRef), transaction.get(setupRef)
      ]);
      const config = readConfig(configSnapshot.data());
      const profile = profileSnapshot.data();
      const recovery = recoverySnapshot.data();
      const operation = operationSnapshot.data();
      const setup = setupSnapshot.data();
      if (!config || !config.managedUids.includes(uid) || !validProfile(profile, uid) || tokenSnapshot.data()?.uid !== uid
        || recovery?.tokenHash !== tokenHash || !["enabled", "processing"].includes(recovery?.status)) invalidLink();
      if (setupBusy(setup)) busy();
      const current = nowOf(dependencies);
      let salt: string;
      if (recovery.status === "enabled") {
        if (!(recovery.expiresAt instanceof Timestamp) || recovery.expiresAt.toMillis() <= current.toMillis()) invalidLink();
        if (running(operation)) busy();
        salt = randomBytes(32).toString("hex");
      } else {
        // A started change can be recovered after link expiry, but only with the
        // same chosen password. Expiry never authorizes a new password or worker.
        if (operation?.kind !== "recovery" || operation.tokenHash !== tokenHash || !/^[a-f0-9]{64}$/.test(operation.passwordSalt || "")) invalidLink();
        salt = operation.passwordSalt;
        if (!equalHash(operation.passwordHash, hashPassword(newPassword, salt))) fail("recovery-password-mismatch", "前回入力した新しいパスワードで再試行してください。");
        if (operation.status !== "retryable") busy();
      }
      const retrying = recovery.status === "processing";
      const originalProfileState = retrying ? operation!.originalProfileState : Object.fromEntries(
        ["passwordChangeRequired", "passwordAuthTimeAfter", "passwordResetId"].filter((key) => key in profile).map((key) => [key, profile[key]])
      );
      const originalSetupState = retrying ? operation!.originalSetupState : (setup || null);
      const mayHaveWrittenAuth = retrying && operation!.mayHaveWrittenAuth === true;
      transaction.set(operationRef, { kind: "recovery", status: "running", operationId, tokenHash, passwordSalt: salt,
        passwordHash: hashPassword(newPassword, salt), startedAt: current, originalProfileState, originalSetupState, mayHaveWrittenAuth });
      transaction.update(recoveryRef, { status: "processing", startedAt: current });
      transaction.update(profileRef, { passwordChangeRequired: true, passwordAuthTimeAfter: current.seconds, passwordResetId: FieldValue.delete() });
      if (setupSnapshot.exists) transaction.set(setupRef, { status: "superseded", supersededAt: current });
      return mayHaveWrittenAuth;
    });
  } catch (error) {
    if (error instanceof HttpsError) {
      const details = error.details as { reason?: string } | undefined;
      if (["managed-account-unavailable", "account-management-unavailable"].includes(details?.reason || "")) invalidLink();
      throw error;
    }
    return unavailable();
  }
  let cutoff: number;
  let authWriteAccepted = false;
  try {
    // Check again after acquiring the shared lock. Never re-enable a disabled user.
    await activeAuth(dependencies, uid);
    await dependencies.auth.updateUser(uid, { password: newPassword });
    authWriteAccepted = true;
    await dependencies.auth.revokeRefreshTokens(uid);
    cutoff = await dependencies.db.runTransaction(async (transaction) => {
      const operationRef = dependencies.db.doc(`accountOperations/${uid}`);
      const profileRef = dependencies.db.doc(`users/${uid}`);
      const recoveryRef = dependencies.db.doc(`accountRecovery/${uid}`);
      const [operationSnapshot, profileSnapshot, recoverySnapshot] = await Promise.all([transaction.get(operationRef), transaction.get(profileRef), transaction.get(recoveryRef)]);
      const operation = operationSnapshot.data();
      if (operation?.operationId !== operationId || operation.status !== "running" || operation.kind !== "recovery"
        || operation.tokenHash !== tokenHash || recoverySnapshot.data()?.tokenHash !== tokenHash || !validProfile(profileSnapshot.data(), uid)) busy();
      const completedAt = nowOf(dependencies);
      transaction.update(profileRef, { passwordChangeRequired: false, passwordAuthTimeAfter: completedAt.seconds, passwordChangedAt: completedAt });
      const expiresAt = recoverySnapshot.data()!.expiresAt;
      transaction.set(recoveryRef, { uid, status: "completed", completedAt, tokenHash, expiresAt });
      transaction.set(operationRef, { kind: "recovery", status: "completed", completedAt });
      transaction.set(tokenRef, { uid, status: "completed", completedAt, expiresAt, email,
        passwordSalt: operation.passwordSalt, passwordHash: operation.passwordHash });
      return completedAt.seconds;
    });
  } catch (error) {
    const code = authErrorCode(error);
    if ((code === "auth/invalid-password" || code === "auth/password-does-not-meet-requirements")
      && !authWriteAccepted && !priorAuthWriteUncertain) {
      // Only a definitive first-attempt rejection permits restoring the exact prior
      // gate/setup. An uncertain earlier Auth write must never reopen old sessions.
      let restored = false;
      try {
        restored = await dependencies.db.runTransaction(async (transaction) => {
          const ref = dependencies.db.doc(`accountOperations/${uid}`);
          const profileRef = dependencies.db.doc(`users/${uid}`);
          const setupRef = dependencies.db.doc(`passwordSetups/${uid}`);
          const [operationSnapshot, profileSnapshot, setupSnapshot] = await Promise.all([
            transaction.get(ref), transaction.get(profileRef), transaction.get(setupRef)
          ]);
          const row = operationSnapshot.data();
          const profile = profileSnapshot.data();
          const setup = setupSnapshot.data();
          if (row?.operationId !== operationId || row.status !== "running" || row.mayHaveWrittenAuth === true
            || !(row.startedAt instanceof Timestamp) || !row.originalProfileState || profile?.passwordChangeRequired !== true
            || profile.passwordAuthTimeAfter !== row.startedAt.seconds || profile.passwordResetId !== undefined
            || (row.originalSetupState && (setup?.status !== "superseded" || !(setup.supersededAt instanceof Timestamp)
              || !setup.supersededAt.isEqual(row.startedAt)))) return false;
          transaction.update(profileRef, Object.fromEntries(["passwordChangeRequired", "passwordAuthTimeAfter", "passwordResetId"]
            .map((key) => [key, key in row.originalProfileState ? row.originalProfileState[key] : FieldValue.delete()])));
          if (row.originalSetupState) transaction.set(setupRef, row.originalSetupState);
          transaction.set(ref, { kind: "recovery", status: "rejected" });
          transaction.update(dependencies.db.doc(`accountRecovery/${uid}`), { status: "enabled" });
          return true;
        });
      } catch { /* Keep the gate if a safe restoration cannot be confirmed. */ }
      if (restored) fail("password-policy", "このパスワードは設定できません。別のパスワードを入力してください。", "invalid-argument");
    }
    await markRetryable(dependencies, uid, operationId);
    fail("recovery-retry-same-password", "変更結果を確認できません。同じ新しいパスワードで再試行してください。", "unavailable");
  }
  await waitForFreshLogin(dependencies, cutoff);
  return { email };
}

export async function changeAccountEmail(auth: PasswordAuthContext | undefined, input: unknown, dependencies: AccountRecoveryDependencies): Promise<{ success: true }> {
  return guarded(async () => {
    const config = await ownerContext(auth, dependencies, true);
    const row = inputRow(input);
    const uid = row.uid;
    const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
    if (!uidValid(uid) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("invalid-account-input", "メールアドレスを確認してください。", "invalid-argument");
    if (!config!.managedUids.includes(uid)) fail("managed-account-unavailable", "このアカウントは現在管理できません。");
    const user = await activeAuth(dependencies, uid);
    const operationId = (dependencies.operationId || randomUUID)();
    const operationRef = dependencies.db.doc(`accountOperations/${uid}`);
    const profileRef = dependencies.db.doc(`users/${uid}`);
    const memberRef = dependencies.db.doc(`cocoMembers/${uid}`);
    const recoveryRef = dependencies.db.doc(`accountRecovery/${uid}`);
    await dependencies.db.runTransaction(async (transaction) => {
      const profile = await authorizeTransaction(transaction, dependencies, auth!, uid);
      const [operationSnapshot, memberSnapshot, recoverySnapshot, setupSnapshot] = await Promise.all([
        transaction.get(operationRef), transaction.get(memberRef), transaction.get(recoveryRef), transaction.get(dependencies.db.doc(`passwordSetups/${uid}`))
      ]);
      const operation = operationSnapshot.data();
      const recovery = recoverySnapshot.data();
      const member = memberSnapshot.data();
      if (profile.passwordChangeRequired === true || setupBusy(setupSnapshot.data()) || recovery?.status === "processing") busy();
      if (running(operation) && (operation?.kind !== "email" || operation.status !== "retryable" || operation.email !== email)) busy();
      const priorEmail = running(operation) ? operation!.previousEmail : user.email!.toLowerCase();
      if (typeof profile.email !== "string" || ![priorEmail, email].includes(profile.email.toLowerCase())
        || (member && ![priorEmail, email].includes(String(member.authEmail ?? member.email ?? "").toLowerCase()))) {
        fail("account-email-inconsistent", "登録情報の確認が必要です。管理担当者へ連絡してください。");
      }
      const current = nowOf(dependencies);
      transaction.set(operationRef, { kind: "email", status: "running", operationId, email, previousEmail: priorEmail, startedAt: current });
      if (typeof recovery?.tokenHash === "string" && /^[a-f0-9]{64}$/.test(recovery.tokenHash)) transaction.delete(dependencies.db.doc(`accountRecoveryTokens/${recovery.tokenHash}`));
      transaction.set(recoveryRef, { uid, status: "off", disabledAt: current });
    });
    let cutoff: number;
    try {
      const currentUser = await activeAuth(dependencies, uid);
      if (currentUser.email!.toLowerCase() !== email) await dependencies.auth.updateUser(uid, { email, emailVerified: false });
      await dependencies.auth.revokeRefreshTokens(uid);
      cutoff = await dependencies.db.runTransaction(async (transaction) => {
        const [operationSnapshot, profileSnapshot, memberSnapshot] = await Promise.all([transaction.get(operationRef), transaction.get(profileRef), transaction.get(memberRef)]);
        const operation = operationSnapshot.data();
        const profile = profileSnapshot.data();
        const member = memberSnapshot.data();
        if (operation?.operationId !== operationId || operation.kind !== "email" || operation.status !== "running" || operation.email !== email
          || !validProfile(profile, uid) || ![operation.previousEmail, email].includes(String(profile.email).toLowerCase())
          || (member && ![operation.previousEmail, email].includes(String(member.authEmail ?? member.email ?? "").toLowerCase()))) busy();
        const completedAt = nowOf(dependencies);
        transaction.update(profileRef, { email, passwordAuthTimeAfter: completedAt.seconds });
        // Corporate COCO email and linked Google identity are deliberately preserved.
        if (memberSnapshot.exists) transaction.update(memberRef, { authEmail: email });
        transaction.set(operationRef, { kind: "email", status: "completed", email, completedAt });
        return completedAt.seconds;
      });
    } catch (error) {
      const code = authErrorCode(error);
      if (code === "auth/email-already-exists" || code === "auth/invalid-email") {
        try {
          await dependencies.db.runTransaction(async (transaction) => {
            const operation = (await transaction.get(operationRef)).data();
            if (operation?.operationId === operationId && operation.status === "running") transaction.set(operationRef, { kind: "email", status: "rejected" });
          });
        } catch { /* Retain a closed lock if releasing a rejected Auth write fails. */ }
        fail("account-email-rejected", "このメールアドレスには変更できません。入力内容を確認してください。", "invalid-argument");
      }
      await markRetryable(dependencies, uid, operationId);
      fail("email-change-retry-same-address", "変更結果を確認できません。同じメールアドレスで再試行してください。ご自身のアドレスを変更した場合は、変更後のアドレスでログインし直してください。", "unavailable");
    }
    await waitForFreshLogin(dependencies, cutoff);
    return { success: true };
  });
}
