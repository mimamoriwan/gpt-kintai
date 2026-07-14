import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";

initializeApp({ projectId: "demo-kintai" });
const auth = getAuth();
const db = getFirestore();

const users = [
  { uid: "fang-user", email: "fang@example.jp", password: "Demo-Fang-2026!", displayName: "方 蕊", role: "employee", locale: "zh-CN" },
  { uid: "manager-user", email: "manager@example.jp", password: "Demo-Manager-2026!", displayName: "管理担当", role: "employee_manager", locale: "ja" },
  { uid: "president-user", email: "president@example.jp", password: "Demo-President-2026!", displayName: "社長", role: "president_viewer", locale: "ja" }
];

for (const user of users) {
  try { await auth.getUser(user.uid); }
  catch { await auth.createUser({ uid: user.uid, email: user.email, password: user.password, displayName: user.displayName, emailVerified: true }); }
  await auth.setCustomUserClaims(user.uid, { role: user.role });
  await db.doc(`users/${user.uid}`).set({ uid: user.uid, email: user.email, displayName: user.displayName, role: user.role, locale: user.locale, active: true, createdAt: FieldValue.serverTimestamp() }, { merge: true });
}

const categories = [
  ["product_discovery", "商品発掘", "商品发掘"],
  ["manufacturer_visit", "メーカー訪問", "厂家访问"],
  ["market_research", "市場調査", "市场调查"],
  ["negotiation", "商談・交渉", "洽谈・协商"],
  ["product_evaluation", "商品評価", "商品评价"],
  ["report_creation", "報告書作成", "报告编写"],
  ["internal_work", "社内業務", "公司内部工作"],
  ["other", "その他", "其他"]
];
for (const [index, [id, labelJa, labelZh]] of categories.entries()) {
  await db.doc(`categories/${id}`).set({ labelJa, labelZh, active: true, order: index + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

console.log("Emulator data is ready.");
console.log("fang@example.jp / Demo-Fang-2026!");
console.log("manager@example.jp / Demo-Manager-2026!");
console.log("president@example.jp / Demo-President-2026!");
