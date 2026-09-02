import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

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
  await db.doc(`calendarMembers/real_${user.uid}`).set({
    displayName: user.displayName,
    linkedUserId: user.uid,
    roleHint: user.role,
    active: true,
    order: (users.findIndex((item) => item.uid === user.uid) + 1) * 10,
    isDemo: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
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

const jstDateAfter = (days) => new Date(Date.now() + days * 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const instructionSeeds = [
  {
    id: "seed-instruction-urgent-fang",
    titleOriginal: "商品候補3件の比較をお願いします",
    bodyOriginal: "候補商品の価格、容量、中国市場向けの説明ポイントを比較し、期限までに結果をまとめてください。",
    titleZh: "请比较3个候选商品",
    bodyZh: "请比较候选商品的价格、容量以及面向中国市场的说明要点，并在截止日期前汇总结果。",
    priority: "urgent", dueDate: jstDateAfter(1), recipientIds: ["fang-user"],
    recipientStates: { "fang-user": { userId: "fang-user", displayName: "方 蕊", status: "pending" } }, status: "active"
  },
  {
    id: "seed-instruction-all",
    titleOriginal: "来週の訪問予定を確認してください",
    bodyOriginal: "来週のメーカー訪問予定を確認し、変更があれば共有カレンダーへ反映してください。",
    titleZh: "请确认下周的访问安排",
    bodyZh: "请确认下周的厂家访问安排，如有变更请更新共享日历。",
    priority: "normal", dueDate: jstDateAfter(3), recipientIds: ["fang-user", "manager-user"],
    recipientStates: {
      "fang-user": { userId: "fang-user", displayName: "方 蕊", status: "acknowledged", acknowledgedAt: Timestamp.now() },
      "manager-user": { userId: "manager-user", displayName: "管理担当", status: "pending" }
    }, status: "active"
  },
  {
    id: "seed-instruction-completed",
    titleOriginal: "月次資料の保存先確認",
    bodyOriginal: "先月分の月次資料が会社Driveへ保存されていることを確認してください。",
    titleZh: "确认月度资料的保存位置",
    bodyZh: "请确认上月的月度资料已保存到公司Drive。",
    priority: "normal", dueDate: "", recipientIds: ["manager-user"],
    recipientStates: { "manager-user": { userId: "manager-user", displayName: "管理担当", status: "completed", acknowledgedAt: Timestamp.now(), completedAt: Timestamp.now(), completionNote: "保存を確認しました。" } }, status: "completed", completedAt: Timestamp.now()
  }
];
for (const row of instructionSeeds) {
  const { id, ...data } = row;
  await db.doc(`presidentInstructions/${id}`).set({
    ...data, authorId: "president-user", authorName: "社長", authorRole: "president_viewer", translationStatus: "completed", translationAttempts: 1, attachments: [],
    isDemo: false, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  });
}

console.log("Emulator data is ready.");
console.log("fang@example.jp / Demo-Fang-2026!");
console.log("manager@example.jp / Demo-Manager-2026!");
console.log("president@example.jp / Demo-President-2026!");
