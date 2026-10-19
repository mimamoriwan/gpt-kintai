import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomInt, randomUUID, scryptSync } from "node:crypto";
import { parseArgs } from "node:util";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const { values: args } = parseArgs({ options: {
  project: { type: "string" },
  "confirm-project": { type: "string" },
  email: { type: "string" },
  apply: { type: "boolean", default: false },
  resume: { type: "boolean", default: false },
  "credentials-out": { type: "string" }
} });
const projectId = args.project;
const email = args.email?.trim().toLowerCase();
class ResetPreparationError extends Error {}
function ensure(condition, message) { if (!condition) throw new ResetPreparationError(message); }
ensure(projectId && projectId === args["confirm-project"], "対象と確認用のプロジェクトIDを明示してください。");
ensure(email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), "対象のメールアドレスを指定してください。");
const emulator = projectId.startsWith("demo-");
ensure(emulator ? process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST
  : !process.env.FIREBASE_AUTH_EMULATOR_HOST && !process.env.FIRESTORE_EMULATOR_HOST,
"本番・検証プロジェクトとエミュレーターの接続設定が一致しません。");
ensure(!args.resume || args.apply, "再開には --apply を指定してください。");
if (args.apply) ensure(args["credentials-out"] && path.isAbsolute(args["credentials-out"]), "仮パスワードの保存先を絶対パスで指定してください。");
initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const auth = getAuth();
const db = getFirestore();
const outputPath = args["credentials-out"];
const saveCredential = (value, exclusive = false) => {
  fs.writeFileSync(outputPath, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: exclusive ? "wx" : "w" });
  fs.chmodSync(outputPath, 0o600);
};

try {
  const user = await auth.getUserByEmail(email);
  const ref = db.doc(`users/${user.uid}`);
  const setupRef = db.doc(`passwordSetups/${user.uid}`);
  const initialProfile = (await ref.get()).data();
  ensure(!user.disabled && initialProfile?.uid === user.uid && initialProfile.email?.toLowerCase() === email && initialProfile.active === true,
    "対象アカウントと利用者登録を確認してください。");
  ensure(initialProfile.role === "employee" && user.customClaims?.role === "employee", "今回の初回変更機能は従業員アカウントが対象です。");
  ensure(user.providerData.some(p => p.providerId === "password"), "パスワード認証の利用者だけが対象です。");
  if (!args.apply) {
    const setup = (await setupRef.get()).data();
    console.log(JSON.stringify({ mode: "dry-run", projectId, uid: user.uid, email, displayName: initialProfile.displayName,
      existingStatus: setup?.status || "none", passwordChangeRequired: initialProfile.passwordChangeRequired === true,
      changes: ["仮パスワードを12文字で発行（24時間有効）", "初回のパスワード変更を必須にする"], preservesUid: true }));
    process.exit(0);
  }

  let credential;
  if (args.resume) {
    ensure(!fs.lstatSync(outputPath).isSymbolicLink(), "認証情報の保存先にシンボリックリンクは使用できません。");
    ensure((fs.statSync(outputPath).mode & 0o077) === 0, "認証情報ファイルの権限を所有者のみに制限してください。");
    credential = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    ensure(credential.projectId === projectId && credential.uid === user.uid && credential.email === email
      && typeof credential.resetId === "string" && typeof credential.temporaryPassword === "string", "再開用の認証情報が対象と一致しません。");
    ensure(new Date(credential.expiresAt).getTime() > Date.now(), "仮パスワードの発行期限が過ぎています。");
  } else {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const temporaryPassword = Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join("");
    const salt = randomBytes(32).toString("hex");
    credential = { projectId, uid: user.uid, email, resetId: randomUUID(), temporaryPassword, salt,
      requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), phase: "prepared" };
    // Save privately before writes so an interrupted issuance can resume with the same secret.
    saveCredential(credential, true);
  }

  const setupHash = scryptSync(credential.temporaryPassword, Buffer.from(credential.salt, "hex"), 64).toString("hex");
  const issueNeeded = await db.runTransaction(async tx => {
    const [profileSnap, setupSnap] = await Promise.all([tx.get(ref), tx.get(setupRef)]);
    const profile = profileSnap.data();
    const setup = setupSnap.data();
    ensure(profile?.uid === user.uid && profile.email?.toLowerCase() === email && profile.active === true && profile.role === "employee",
      "利用者登録が変更されたため停止しました。");
    if (setup?.resetId === credential.resetId) {
      ensure(profile.passwordResetId === credential.resetId && profile.passwordChangeRequired === true, "変更必須状態が一致しません。");
      ensure(setup.salt === credential.salt && setup.temporaryPasswordHash === setupHash, "再開する発行内容が一致しません。");
      if (setup.status === "required") return false;
      ensure(setup.status === "issuing", "本人による変更が開始済みです。仮パスワードを上書きしません。");
      return true;
    }
    const expiredUnused = setup?.status === "required" && setup.expiresAt?.toMillis() <= Date.now();
    ensure(!setup || setup.status === "completed" || expiredUnused, "別の仮パスワード発行・変更が進行中です。");
    ensure(profile.passwordChangeRequired !== true || expiredUnused, "別の変更必須状態が残っています。");
    tx.set(setupRef, { resetId: credential.resetId, status: "issuing", requestedAt: Timestamp.fromDate(new Date(credential.requestedAt)),
      expiresAt: Timestamp.fromDate(new Date(credential.expiresAt)), salt: credential.salt, temporaryPasswordHash: setupHash });
    tx.update(ref, { passwordChangeRequired: true, passwordResetId: credential.resetId, updatedAt: FieldValue.serverTimestamp() });
    return true;
  });

  if (issueNeeded) {
    credential.phase = "issuing"; saveCredential(credential);
    const current = await auth.getUser(user.uid);
    ensure(current.email?.toLowerCase() === email && !current.disabled, "認証アカウントが変更されたため停止しました。");
    await auth.updateUser(user.uid, { password: credential.temporaryPassword });
    credential.phase = "password-updated"; saveCredential(credential);
    await db.runTransaction(async tx => {
      const [profileSnap, setupSnap] = await Promise.all([tx.get(ref), tx.get(setupRef)]);
      ensure(profileSnap.data()?.passwordResetId === credential.resetId && profileSnap.data()?.passwordChangeRequired === true
        && setupSnap.data()?.resetId === credential.resetId && setupSnap.data()?.status === "issuing", "発行状態が変更されました。状態を確認してください。");
      tx.update(setupRef, { status: "required", issuedAt: FieldValue.serverTimestamp() });
    });
  }
  const [after, profileAfter, setupAfter] = await Promise.all([auth.getUser(user.uid), ref.get(), setupRef.get()]);
  ensure(after.uid === user.uid && after.email?.toLowerCase() === email && !after.disabled
    && JSON.stringify(after.customClaims || {}) === JSON.stringify(user.customClaims || {})
    && profileAfter.data()?.passwordChangeRequired === true && profileAfter.data()?.passwordResetId === credential.resetId
    && setupAfter.data()?.status === "required", "発行後の確認に失敗しました。状態を確認してください。");
  credential.phase = "ready"; saveCredential(credential);
  console.log(JSON.stringify({ mode: "applied", projectId, uid: user.uid, email, passwordChangeRequired: true,
    expiresAt: credential.expiresAt, credentialsFile: outputPath, preservesUid: true }));
} catch (error) {
  // Never dump requests, user records, credential files or password values.
  console.error(JSON.stringify({ code: error instanceof ResetPreparationError ? "precondition-failed" : "operation-failed",
    message: error instanceof ResetPreparationError ? error.message : "処理が完了しませんでした。保存先と発行状態を確認し、同じ内容で再開してください。" }));
  process.exitCode = 1;
}
