#!/usr/bin/env node

import {
  createDemoFixture,
  DEMO_DATASET_ID,
  DEMO_EMAIL,
  DEMO_EMULATOR_PROJECT_ID,
  DEMO_PROJECT_ID,
  DEMO_SEED_VERSION,
  DEMO_USER_ID,
  fixtureSummary
} from "./demo-data-fixture.mjs";

const ACTION_FLAGS = ["dry-run", "apply", "reset-final-week", "remove"];
const FINAL_WEEK_START = "2026-07-13";
const FINAL_REPORT_DATE = "2026-07-15";
const DELETE_COLLECTIONS = [
  "attendance",
  "dailyReports",
  "workLogs",
  "products",
  "productObservations",
  "productRevisions",
  "auditEvents",
  "weeklyPlans",
  "weeklyReports",
  "weeklyReportRevisions",
  "weeklyMeetings",
  "nonWorkingReasons",
  "evidenceReferences",
  "monthlyEvidencePackages",
  "demoProductJanIndex",
  "productAiDailyUsage",
  "productAiDraftUsage",
  "aiDailyDraftUsage"
];

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`不明な引数です: ${token}`);
    const key = token.slice(2);
    if ([...ACTION_FLAGS, "emulator"].includes(key)) {
      result[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${key} の値がありません。`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function usage() {
  return `
方さんデモデータ管理

必須:
  --dry-run | --apply | --reset-final-week | --remove
  --project <project-id>
  --confirm-project <project-id>

エミュレーターで実行する場合:
  --emulator

例:
  node scripts/manage-demo-data.mjs --dry-run --project gpt-kintai --confirm-project gpt-kintai
  node scripts/manage-demo-data.mjs --apply --project demo-kintai --confirm-project demo-kintai --emulator
`;
}

function validateArgs(args) {
  const actions = ACTION_FLAGS.filter((flag) => args[flag]);
  if (actions.length !== 1) throw new Error("操作は --dry-run、--apply、--reset-final-week、--remove のいずれか1つを指定してください。");
  if (!args.project || !args["confirm-project"]) throw new Error("--project と --confirm-project の両方が必要です。");
  if (args.project !== args["confirm-project"]) throw new Error("安全確認に失敗しました。--project と --confirm-project が一致していません。");
  if (![DEMO_PROJECT_ID, DEMO_EMULATOR_PROJECT_ID].includes(args.project)) {
    throw new Error(`許可されていないプロジェクトです: ${args.project}`);
  }
  if (args.project === DEMO_EMULATOR_PROJECT_ID && !args.emulator) {
    throw new Error("demo-kintai は --emulator を付けて実行してください。");
  }
  if (args.project === DEMO_PROJECT_ID && args.emulator) {
    throw new Error("本番プロジェクトIDをエミュレーター指定で実行することはできません。");
  }
  return actions[0];
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function isNotFound(error) {
  return error?.code === "auth/user-not-found" || error?.code === "auth/email-not-found";
}

function isOwnedDemo(data) {
  return data?.isDemo === true
    && data?.demoDatasetId === DEMO_DATASET_ID
    && data?.seedVersion === DEMO_SEED_VERSION;
}

function assertOwnedDemo(path, data) {
  if (!isOwnedDemo(data)) {
    throw new Error(`安全のため中止しました。デモ印が一致しない既存データです: ${path}`);
  }
}

async function initializeAdmin(projectId, emulator) {
  if (emulator) {
    process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
    process.env.STORAGE_EMULATOR_HOST ||= "127.0.0.1:9199";
    process.env.GCLOUD_PROJECT = projectId;
  }
  const [{ initializeApp, applicationDefault }, { getAuth }, { getFirestore, Timestamp, FieldValue }, { getStorage }] = await Promise.all([
    import("firebase-admin/app"),
    import("firebase-admin/auth"),
    import("firebase-admin/firestore"),
    import("firebase-admin/storage")
  ]);
  // The Admin SDK rejects an explicitly undefined credential.  Emulator
  // connections intentionally omit credentials altogether.
  const appOptions = {
    projectId,
    storageBucket: `${projectId}.firebasestorage.app`
  };
  if (!emulator) appOptions.credential = applicationDefault();
  const app = initializeApp(appOptions);
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  return { app, auth: getAuth(app), db, storage: getStorage(app), Timestamp, FieldValue };
}

function toFirestoreValue(value, Timestamp) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((item) => toFirestoreValue(item, Timestamp)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    if (Object.keys(value).length === 1 && typeof value.__demoTimestamp === "string") {
      return Timestamp.fromDate(new Date(value.__demoTimestamp));
    }
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, toFirestoreValue(item, Timestamp)])
        .filter(([, item]) => item !== undefined)
    );
  }
  return value;
}

async function ensureAuthUser(auth, emulator) {
  let byUid;
  let byEmail;
  try { byUid = await auth.getUser(DEMO_USER_ID); } catch (error) { if (!isNotFound(error)) throw error; }
  try { byEmail = await auth.getUserByEmail(DEMO_EMAIL); } catch (error) { if (!isNotFound(error)) throw error; }
  if (byUid && byUid.email !== DEMO_EMAIL) throw new Error(`UID ${DEMO_USER_ID} は別のメールアドレスで使用されています。`);
  if (byEmail && byEmail.uid !== DEMO_USER_ID) throw new Error(`メール ${DEMO_EMAIL} は別のUIDで使用されています。`);
  if (byUid) {
    const claims = byUid.customClaims || {};
    if ((claims.isDemo && claims.demoDatasetId !== DEMO_DATASET_ID) || (!claims.isDemo && Object.keys(claims).length > 0)) {
      throw new Error("既存Auth利用者のCustom Claimsがデモアカウントと一致しません。");
    }
  } else {
    const create = { uid: DEMO_USER_ID, email: DEMO_EMAIL, displayName: "方 蕊（デモ）", emailVerified: emulator, disabled: false };
    if (emulator) create.password = "Demo-Fang-2026!";
    await auth.createUser(create);
  }
  await auth.setCustomUserClaims(DEMO_USER_ID, {
    role: "employee",
    isDemo: true,
    demoDatasetId: DEMO_DATASET_ID,
    seedVersion: DEMO_SEED_VERSION
  });
  if (emulator) return { createdOrUpdated: true, emulatorPassword: "Demo-Fang-2026!" };
  return { createdOrUpdated: true, passwordResetLink: await auth.generatePasswordResetLink(DEMO_EMAIL) };
}

async function inspectFixtureWrites(db, fixture) {
  const conflicts = [];
  let existing = 0;
  for (const item of fixture.documents) {
    const snapshot = await db.doc(item.path).get();
    if (!snapshot.exists) continue;
    existing += 1;
    if (!isOwnedDemo(snapshot.data())) conflicts.push(item.path);
  }
  if (conflicts.length) {
    throw new Error(`既存の本番データと衝突するため中止しました:\n${conflicts.join("\n")}`);
  }
  return existing;
}

async function writeFixture(db, fixture, Timestamp) {
  const converted = fixture.documents.map((item) => ({ path: item.path, data: toFirestoreValue(item.data, Timestamp) }));
  for (let start = 0; start < converted.length; start += 400) {
    const batch = db.batch();
    converted.slice(start, start + 400).forEach((item) => batch.set(db.doc(item.path), item.data));
    await batch.commit();
  }
  return converted.length;
}

async function setDatasetOperation(db, Timestamp, operation, extra = {}) {
  const ref = db.doc(`demoDatasets/${DEMO_DATASET_ID}`);
  const snapshot = await ref.get();
  if (snapshot.exists) assertOwnedDemo(ref.path, snapshot.data());
  await ref.set({
    isDemo: true,
    demoDatasetId: DEMO_DATASET_ID,
    seedVersion: DEMO_SEED_VERSION,
    lastOperation: operation,
    lastOperationAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...extra
  }, { merge: true });
}

async function resetFinalWeek(db, Timestamp, FieldValue) {
  const pathsToVerify = [
    `dailyReports/demo-report-${FINAL_REPORT_DATE}`,
    `weeklyPlans/${DEMO_USER_ID}_${FINAL_WEEK_START}`,
    `demoDatasets/${DEMO_DATASET_ID}`
  ];
  for (const path of pathsToVerify) {
    const snapshot = await db.doc(path).get();
    if (!snapshot.exists) throw new Error(`リセット対象がありません。先に --apply を実行してください: ${path}`);
    assertOwnedDemo(path, snapshot.data());
  }
  const deletions = [
    `weeklyReports/${DEMO_USER_ID}_${FINAL_WEEK_START}`,
    `weeklyMeetings/${DEMO_USER_ID}_${FINAL_WEEK_START}`
  ];
  for (const path of deletions) {
    const snapshot = await db.doc(path).get();
    if (snapshot.exists) assertOwnedDemo(path, snapshot.data());
  }
  const revisionSnapshot = await db.collection("weeklyReportRevisions")
    .where("demoDatasetId", "==", DEMO_DATASET_ID)
    .where("weekStart", "==", FINAL_WEEK_START)
    .get();
  revisionSnapshot.docs.forEach((snapshot) => assertOwnedDemo(snapshot.ref.path, snapshot.data()));

  const batch = db.batch();
  batch.update(db.doc(`dailyReports/demo-report-${FINAL_REPORT_DATE}`), {
    reviewStatus: "unreviewed",
    reviewedAt: FieldValue.delete(),
    reviewedBy: FieldValue.delete(),
    updatedAt: Timestamp.now()
  });
  batch.update(db.doc(`weeklyPlans/${DEMO_USER_ID}_${FINAL_WEEK_START}`), {
    status: "confirmed",
    updatedAt: Timestamp.now()
  });
  deletions.forEach((path) => batch.delete(db.doc(path)));
  revisionSnapshot.docs.forEach((snapshot) => batch.delete(snapshot.ref));
  await batch.commit();
  await setDatasetOperation(db, Timestamp, "reset-final-week", { status: "ready_for_live_demo" });
  return { resetReport: FINAL_REPORT_DATE, resetWeek: FINAL_WEEK_START, deleted: deletions.length + revisionSnapshot.size };
}

async function collectDemoDocs(db) {
  const found = new Map();
  for (const collectionName of DELETE_COLLECTIONS) {
    const snapshot = await db.collection(collectionName).where("demoDatasetId", "==", DEMO_DATASET_ID).get();
    snapshot.docs.forEach((item) => found.set(item.ref.path, item));
  }

  // Collection-group queries require a Firestore field override/index even
  // when they filter on only one field. Follow the already verified demo
  // parents instead so removal works without adding an operational index.
  const demoReports = [...found.values()].filter((item) => item.ref.parent.id === "dailyReports");
  for (const report of demoReports) {
    const revisions = await report.ref.collection("revisions").get();
    revisions.docs.forEach((item) => {
      assertOwnedDemo(item.ref.path, item.data());
      found.set(item.ref.path, item);
    });
  }

  const tags = await db.collection(`users/${DEMO_USER_ID}/workTags`).get();
  tags.docs.forEach((item) => {
    assertOwnedDemo(item.ref.path, item.data());
    found.set(item.ref.path, item);
  });
  found.forEach((snapshot, path) => assertOwnedDemo(path, snapshot.data()));
  return [...found.values()];
}

async function removeDemoData({ auth, db, storage, Timestamp }) {
  const docs = await collectDemoDocs(db);
  for (let start = 0; start < docs.length; start += 400) {
    const batch = db.batch();
    docs.slice(start, start + 400).forEach((snapshot) => batch.delete(snapshot.ref));
    await batch.commit();
  }

  const userRef = db.doc(`users/${DEMO_USER_ID}`);
  const userSnapshot = await userRef.get();
  if (userSnapshot.exists) {
    assertOwnedDemo(userRef.path, userSnapshot.data());
    await userRef.delete();
  }

  try {
    const authUser = await auth.getUser(DEMO_USER_ID);
    if (authUser.email !== DEMO_EMAIL || authUser.customClaims?.isDemo !== true || authUser.customClaims?.demoDatasetId !== DEMO_DATASET_ID) {
      throw new Error("Auth利用者のデモ印が一致しないため削除を中止しました。");
    }
    await auth.deleteUser(DEMO_USER_ID);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  let deletedStorageFiles = 0;
  try {
    const [files] = await storage.bucket().getFiles({ prefix: `demo/${DEMO_DATASET_ID}/` });
    for (const file of files) {
      await file.delete();
      deletedStorageFiles += 1;
    }
  } catch (error) {
    process.stderr.write(`注意: デモStorageの確認を完了できませんでした: ${error.message}\n`);
  }

  const datasetRef = db.doc(`demoDatasets/${DEMO_DATASET_ID}`);
  const datasetSnapshot = await datasetRef.get();
  if (datasetSnapshot.exists) assertOwnedDemo(datasetRef.path, datasetSnapshot.data());
  await datasetRef.set({
    id: DEMO_DATASET_ID,
    label: "方 蕊（デモ）2026年6月15日〜7月15日",
    isDemo: true,
    demoDatasetId: DEMO_DATASET_ID,
    seedVersion: DEMO_SEED_VERSION,
    demoUserId: DEMO_USER_ID,
    demoUserEmail: DEMO_EMAIL,
    status: "removed",
    counts: {},
    lastOperation: "remove",
    lastOperationAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  });
  return { deletedFirestoreDocuments: docs.length + (userSnapshot.exists ? 1 : 0), deletedStorageFiles, authUserDeleted: true, tombstone: datasetRef.path };
}

async function main() {
  let args;
  let action;
  try {
    args = parseArgs(process.argv.slice(2));
    action = validateArgs(args);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}`);
    process.exitCode = 1;
    return;
  }

  const summary = fixtureSummary();
  if (action === "dry-run") {
    printJson({ operation: "dry-run", writesPerformed: false, targetProject: args.project, emulator: Boolean(args.emulator), ...summary });
    return;
  }

  const admin = await initializeAdmin(args.project, Boolean(args.emulator));
  if (action === "apply") {
    const fixture = createDemoFixture();
    const existingDocuments = await inspectFixtureWrites(admin.db, fixture);
    const authResult = await ensureAuthUser(admin.auth, Boolean(args.emulator));
    const writtenDocuments = await writeFixture(admin.db, fixture, admin.Timestamp);
    await setDatasetOperation(admin.db, admin.Timestamp, "apply", { status: "ready", counts: fixture.dataset.counts });
    printJson({ operation: "apply", targetProject: args.project, existingDocuments, writtenDocuments, auth: authResult, summary });
    return;
  }
  if (action === "reset-final-week") {
    printJson({ operation: "reset-final-week", targetProject: args.project, ...(await resetFinalWeek(admin.db, admin.Timestamp, admin.FieldValue)) });
    return;
  }
  printJson({ operation: "remove", targetProject: args.project, ...(await removeDemoData(admin)) });
}

main().catch((error) => {
  process.stderr.write(`デモデータ管理に失敗しました: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
