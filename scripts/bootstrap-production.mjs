import readline from "node:readline/promises";
import process from "node:process";
import { parseArgs } from "node:util";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const roles = ["employee", "employee_manager", "president_viewer"];
const defaultCategories = [
  ["product_discovery", "商品発掘", "商品发掘"],
  ["manufacturer_visit", "メーカー訪問", "厂商拜访"],
  ["market_research", "市場調査", "市场调查"],
  ["negotiation", "商談・交渉", "商务洽谈・协商"],
  ["product_evaluation", "商品評価", "商品评价"],
  ["report_writing", "報告書作成", "报告编写"],
  ["internal_work", "社内業務", "公司内部工作"],
  ["other", "その他", "其他"]
];

const { values: options } = parseArgs({
  options: {
    project: { type: "string" },
    mode: { type: "string", default: "all" },
    name: { type: "string" },
    email: { type: "string" },
    "skip-reset-link": { type: "boolean", default: false }
  }
});

if (!['all', 'manager-only'].includes(options.mode)) {
  throw new Error("--mode は all または manager-only を指定してください。");
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const projectId = (options.project || process.env.GOOGLE_CLOUD_PROJECT || await rl.question("FirebaseプロジェクトID: ")).trim();
if (!projectId) throw new Error("FirebaseプロジェクトIDが必要です。");

initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
const db = getFirestore();

async function ensureUser(role, defaultName, suppliedName, suppliedEmail) {
  const name = (suppliedName || await rl.question(`${defaultName}の表示名: `)).trim() || defaultName;
  const email = (suppliedEmail || await rl.question(`${name}のメールアドレス: `)).trim().toLowerCase();
  if (!email) throw new Error(`${name}のメールアドレスが必要です。`);

  let user;
  let wasCreated = false;
  try {
    user = await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
    user = await auth.createUser({ email, displayName: name, emailVerified: false });
    wasCreated = true;
  }

  await auth.setCustomUserClaims(user.uid, { role });
  const profile = {
    uid: user.uid,
    email,
    displayName: name,
    role,
    preferredLanguage: role === "employee" ? "zh-CN" : "ja",
    active: true,
    updatedAt: FieldValue.serverTimestamp()
  };
  if (wasCreated) profile.createdAt = FieldValue.serverTimestamp();
  await db.doc(`users/${user.uid}`).set(profile, { merge: true });

  const resetLink = options["skip-reset-link"] ? "" : await auth.generatePasswordResetLink(email);
  return { uid: user.uid, name, email, role, resetLink };
}

const users = [];
if (options.mode === "manager-only") {
  users.push(await ensureUser(roles[1], "管理担当者", options.name, options.email));
} else {
  users.push(await ensureUser(roles[0], "方さん"));
  users.push(await ensureUser(roles[1], "管理担当者"));
  users.push(await ensureUser(roles[2], "社長"));
}

const batch = db.batch();
for (const [id, nameJa, nameZh] of defaultCategories) {
  batch.set(db.doc(`categories/${id}`), {
    id, nameJa, nameZh, active: true, order: defaultCategories.findIndex((item) => item[0] === id),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
}
for (const [index, user] of users.entries()) {
  batch.set(db.doc(`calendarMembers/real_${user.uid}`), {
    displayName: user.name,
    linkedUserId: user.uid,
    roleHint: user.role,
    active: true,
    order: (index + 1) * 10,
    isDemo: false,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
}
if (!users.some((user) => user.role === "president_viewer")) {
  batch.set(db.doc("calendarMembers/real_role-president"), {
    displayName: "社長",
    linkedUserId: "",
    roleHint: "president_viewer",
    active: true,
    order: 30,
    isDemo: false,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
}
await batch.commit();
await rl.close();

console.log("\n初期設定が完了しました。\n");
for (const user of users) {
  console.log(`${user.name} (${user.email}, ${user.role})`);
  if (user.resetLink) console.log(`パスワード設定URL（本人に安全に共有）:\n${user.resetLink}`);
  else console.log("既存のパスワードを変更せず、権限だけを更新しました。");
  console.log("");
}
