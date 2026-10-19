// Run only against a dedicated local demo project with Auth/Firestore/Functions emulators.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.GCLOUD_PROJECT || "demo-kintai-password";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const functionsHost = process.env.PASSWORD_TEST_FUNCTIONS_HOST || "127.0.0.1:15001";
function check(condition, message) { if (!condition) throw new Error(message); }
check(projectId.startsWith("demo-") && authHost?.startsWith("127.0.0.1:") && firestoreHost?.startsWith("127.0.0.1:")
  && functionsHost.startsWith("127.0.0.1:"), "Tests require local demo emulators");
initializeApp({ projectId });
const auth = getAuth();
const db = getFirestore();
const uid = `password-flow-${randomUUID()}`;
const email = `${uid}@example.test`;
const originalPassword = randomUUID();
const chosenPassword = `new ${randomUUID()} `;
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "kintai-password-flow-"));
const credentialFile = path.join(folder, "credential.json");
async function signIn(password) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  return { ok: response.ok, body: await response.json() };
}
async function callable(name, token, data) {
  const response = await fetch(`http://${functionsHost}/${projectId}/asia-northeast1/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ data })
  });
  return { ok: response.ok, body: await response.json() };
}
function runReset(extraArgs) {
  return spawnSync(process.execPath, ["scripts/reset-initial-password.mjs", "--project", projectId, "--confirm-project", projectId, "--email", email, ...extraArgs], {
    cwd: process.cwd(), env: { ...process.env, GCLOUD_PROJECT: projectId }, encoding: "utf8", timeout: 30000
  });
}

try {
  await auth.createUser({ uid, email, password: originalPassword, displayName: "架空・初回変更テスト" });
  await auth.setCustomUserClaims(uid, { role: "employee" });
  await db.doc(`users/${uid}`).set({ uid, email, displayName: "架空・初回変更テスト", role: "employee", active: true, locale: "ja" });
  await db.doc(`dailyReports/${uid}`).set({ userId: uid, text: "preserved fixture" });
  check(runReset([]).status === 0, "Reset preflight failed");
  check(!(await db.doc(`users/${uid}`).get()).data().passwordChangeRequired, "Dry run changed account");
  const issued = runReset(["--apply", "--credentials-out", credentialFile]);
  check(issued.status === 0, "Temporary password issuance failed");
  const credential = JSON.parse(fs.readFileSync(credentialFile, "utf8"));
  check(credential.temporaryPassword.length === 12 && credential.phase === "ready", "Unexpected temporary credential");
  check(!issued.stdout.includes(credential.temporaryPassword) && !issued.stderr.includes(credential.temporaryPassword), "Credential leaked into process output");
  check((fs.statSync(credentialFile).mode & 0o077) === 0, "Credential file is not private");
  check(runReset(["--apply", "--resume", "--credentials-out", credentialFile]).status === 0, "Issuance resume failed");
  const tamperedFile = path.join(folder, "tampered.json");
  fs.writeFileSync(tamperedFile, JSON.stringify({ ...credential, temporaryPassword: randomUUID() }), { mode: 0o600 });
  check(runReset(["--apply", "--resume", "--credentials-out", tamperedFile]).status !== 0, "Mismatched resume credential was accepted");
  const malformedFile = path.join(folder, "malformed.json");
  fs.writeFileSync(malformedFile, `{"temporaryPassword":"${credential.temporaryPassword}"BROKEN}`, { mode: 0o600 });
  const malformed = runReset(["--apply", "--resume", "--credentials-out", malformedFile]);
  check(malformed.status !== 0 && !malformed.stderr.includes(credential.temporaryPassword), "Malformed credential leaked into error output");
  check(!(await signIn(originalPassword)).ok, "Old password still works after reset");
  const temporaryLogin = await signIn(credential.temporaryPassword);
  check(temporaryLogin.ok && temporaryLogin.body.localId === uid, "Temporary login failed");
  const token = temporaryLogin.body.idToken;
  const blocked = await callable("listAnnouncementRecipients", token, {});
  check(!blocked.ok && blocked.body.error?.details?.reason === "password-change-required", "Work callable was not blocked");
  const anonymous = await callable("completeInitialPasswordChange", null, { newPassword: chosenPassword });
  check(!anonymous.ok, "Anonymous password change was allowed");
  const same = await callable("completeInitialPasswordChange", token, { newPassword: credential.temporaryPassword });
  check(!same.ok && same.body.error?.details?.reason === "password-matches-temporary", "Temporary password reuse was allowed");
  const changed = await callable("completeInitialPasswordChange", token, { newPassword: chosenPassword });
  check(changed.ok && changed.body.result?.success === true, "Initial password change failed");
  const repeated = await callable("completeInitialPasswordChange", token, { newPassword: chosenPassword });
  check(repeated.ok && repeated.body.result?.success === true, "Lost-success retry was not idempotent");
  const staleSession = await callable("listAnnouncementRecipients", token, {});
  check(!staleSession.ok, "Temporary-password session regained access after completion");
  check(!(await signIn(credential.temporaryPassword)).ok, "Temporary password still works after completion");
  const newLogin = await signIn(chosenPassword);
  check(newLogin.ok && newLogin.body.localId === uid, "New-password login failed");
  const restored = await callable("listAnnouncementRecipients", newLogin.body.idToken, {});
  check(restored.ok, "Work callable was not restored");
  const [user, profile, setup, report] = await Promise.all([auth.getUser(uid), db.doc(`users/${uid}`).get(), db.doc(`passwordSetups/${uid}`).get(), db.doc(`dailyReports/${uid}`).get()]);
  check(user.customClaims.role === "employee" && profile.data().passwordChangeRequired === false, "Account role or completion state is wrong");
  check(setup.data().status === "completed" && !setup.data().salt && !setup.data().temporaryPasswordHash && !setup.data().chosenPasswordHash, "Completion retained password hashes");
  check(report.data().text === "preserved fixture", "Existing report changed");
  console.log(JSON.stringify({ result: "passed", projectId, checks: ["private temporary issuance", "safe resume", "no password in error output", "old-password invalidation", "same UID", "work gate", "anonymous rejection", "temporary reuse rejection", "password change", "idempotent retry", "old session blocked after completion", "temporary invalidation", "new-password login", "work access restored", "private hashes deleted", "existing record preserved"] }));
} finally {
  await Promise.allSettled([auth.deleteUser(uid), db.doc(`users/${uid}`).delete(), db.doc(`passwordSetups/${uid}`).delete(), db.doc(`dailyReports/${uid}`).delete()]);
  fs.rmSync(folder, { recursive: true, force: true });
}
