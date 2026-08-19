export const DEMO_PROJECT_ID = "gpt-kintai";
export const DEMO_EMULATOR_PROJECT_ID = "demo-kintai";
export const DEMO_USER_ID = "fang-demo-2026";
export const DEMO_EMAIL = "non.ya0910+fang-demo@gmail.com";
export const DEMO_DATASET_ID = "fang-demo-2026-06-15_2026-07-15-v1";
export const DEMO_SEED_VERSION = "1.0.0";
export const DEMO_PERIOD_START = "2026-06-15";
export const DEMO_PERIOD_END = "2026-07-15";

const demo = { isDemo: true, demoDatasetId: DEMO_DATASET_ID, seedVersion: DEMO_SEED_VERSION };
export const demoTimestamp = (iso) => ({ __demoTimestamp: iso });
const jst = (date, time) => demoTimestamp(`${date}T${time}:00+09:00`);
const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const dateRange = (start, end) => {
  const dates = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
};
const weekdays = dateRange(DEMO_PERIOD_START, DEMO_PERIOD_END).filter((date) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
});
const paidLeaveDate = "2026-06-26";
const holidayWorkDate = "2026-07-04";
const workDates = [...weekdays.filter((date) => date !== paidLeaveDate), holidayWorkDate].sort();

const modes = ["office", "business_trip", "home", "office", "other"];
const categories = ["商品発掘", "市場調査", "メーカー訪問", "商品評価", "報告書作成", "社内業務"];
const tagLabels = ["商品発掘", "中国市場", "メーカー調査", "競合確認", "報告作成", "社内連絡"];
const places = ["架空商店 青葉台店", "サンプル食品研究所", "デモ商事 展示室", "オンライン調査", "社内"];
const logTemplates = [
  "中国市場向けの味付けと包装について比較し、気になる点を整理した。",
  "架空メーカーの商品資料を確認し、原材料と容量を一覧にした。",
  "店頭の調味料売場を観察し、色使いと商品名の分かりやすさを記録した。",
  "サンプル商品の特徴を日本語と中国語で短くまとめた。",
  "管理担当者へ調査結果を共有し、次に確認する項目を相談した。",
  "週次会議に向け、候補商品の優先順位と継続課題を整理した。"
];

const docs = [];
const put = (path, data) => docs.push({ path, data: { ...data, ...demo } });

put(`users/${DEMO_USER_ID}`, {
  uid: DEMO_USER_ID, email: DEMO_EMAIL, displayName: "方 蕊（デモ）", role: "employee", locale: "zh-CN", active: true,
  createdAt: jst(DEMO_PERIOD_START, "08:00")
});

tagLabels.forEach((label, index) => put(`users/${DEMO_USER_ID}/workTags/demo-tag-${String(index + 1).padStart(2, "0")}`, {
  id: `demo-tag-${String(index + 1).padStart(2, "0")}`, label, userId: DEMO_USER_ID, active: true, order: index + 1,
  createdAt: jst(DEMO_PERIOD_START, "08:05"), updatedAt: jst(DEMO_PERIOD_START, "08:05")
}));

workDates.forEach((date, index) => {
  const workMode = date === holidayWorkDate ? "home" : modes[index % modes.length];
  const start = workMode === "business_trip" ? "08:35" : workMode === "home" ? "09:10" : "09:00";
  const end = workMode === "business_trip" ? "17:45" : workMode === "home" ? "17:20" : "17:35";
  const corrected = date === "2026-06-23";
  put(`attendance/demo-att-${date}`, {
    id: `demo-att-${date}`, userId: DEMO_USER_ID, userName: "方 蕊（デモ）", workMode, workDate: date, status: "completed",
    startedAt: jst(date, start), endedAt: jst(date, end), corrected, correctionReason: corrected ? "DEMO：通信不良のため実際の始業時刻へ訂正" : "",
    needsReview: false, scheduledDayType: date === holidayWorkDate ? "company_holiday" : "workday", holidayWork: date === holidayWorkDate,
    holidayLabel: date === holidayWorkDate ? "会社休日（予定）" : "", reviewedAt: corrected ? jst(addDays(date, 1), "09:15") : undefined,
    reviewedBy: corrected ? "manager-user" : undefined, createdAt: jst(date, start), updatedAt: jst(date, end)
  });
});

put(`nonWorkingReasons/${DEMO_USER_ID}_${paidLeaveDate}`, {
  id: `${DEMO_USER_ID}_${paidLeaveDate}`, userId: DEMO_USER_ID, userName: "方 蕊（デモ）", workDate: paidLeaveDate,
  reasonType: "paid_leave", note: "DEMO：私用のため有給休暇", createdBy: DEMO_USER_ID,
  createdAt: jst(paidLeaveDate, "08:30"), updatedAt: jst(paidLeaveDate, "08:30")
});

let logNumber = 0;
workDates.forEach((date, dayIndex) => {
  const count = dayIndex < 14 ? 3 : 2;
  for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
    logNumber += 1;
    const tagIndex = (dayIndex + itemIndex) % tagLabels.length;
    const id = `demo-log-${String(logNumber).padStart(3, "0")}`;
    put(`workLogs/${id}`, {
      id, userId: DEMO_USER_ID, workDate: date, tagId: `demo-tag-${String(tagIndex + 1).padStart(2, "0")}`,
      tagLabel: tagLabels[tagIndex], text: `DEMO：${logTemplates[(logNumber - 1) % logTemplates.length]}`,
      createdAt: jst(date, `${String(10 + itemIndex * 2).padStart(2, "0")}:15`), updatedAt: jst(date, `${String(10 + itemIndex * 2).padStart(2, "0")}:15`)
    });
  }
});

workDates.forEach((date, index) => {
  const category = categories[index % categories.length];
  const trip = ["business_trip"].includes(date === holidayWorkDate ? "home" : modes[index % modes.length]);
  const unreviewed = date === "2026-07-15";
  const id = `demo-report-${date}`;
  const zhActivities = `DEMO：完成了${category}相关工作。整理了当天的调查记录，并比较了面向中国市场的包装、味道和说明方式。`;
  put(`dailyReports/${id}`, {
    id, userId: DEMO_USER_ID, userName: "方 蕊（デモ）", reportDate: date, category,
    area: trip ? "架空市 サンプル区" : "", destinations: trip ? places[index % 3] : "",
    activities: zhActivities, findings: "DEMO：中国の消費者には、用途が一目で分かり、小容量で試しやすい商品が説明しやすいと感じた。",
    nextPlan: "DEMO：類似商品を2点確認し、次回の週次会議で比較結果を共有する。", sourceLanguage: "zh-CN",
    translatedFields: {
      category, area: trip ? "架空市 サンプル区" : "", destinations: trip ? places[index % 3] : "",
      activities: `DEMO：${category}に関する業務を行い、調査記録と中国市場向けの包装・味・説明方法を整理した。`,
      findings: "DEMO：中国の消費者には、用途が一目で分かり、小容量で試しやすい商品が説明しやすいと感じた。",
      nextPlan: "DEMO：類似商品を2点確認し、次回の週次会議で比較結果を共有する。"
    },
    translationStatus: "completed", translationAttempts: 1, attachments: [], status: "submitted",
    reviewStatus: unreviewed ? "unreviewed" : "reviewed", reviewedAt: unreviewed ? undefined : jst(addDays(date, 1), "09:05"),
    reviewedBy: unreviewed ? undefined : "manager-user", revision: date === "2026-06-23" ? 2 : 1,
    submittedAt: jst(date, "17:25"), createdAt: jst(date, "16:55"), updatedAt: jst(date, "17:25")
  });
});

put(`dailyReports/demo-report-2026-06-23/revisions/demo-revision-01`, {
  id: "demo-revision-01", reportId: "demo-report-2026-06-23", revision: 1,
  before: { category: "市場調査", area: "", destinations: "", activities: "DEMO：市場調査の下書き。", findings: "", nextPlan: "", userId: DEMO_USER_ID },
  reason: "DEMO：調査結果を追記するため", changedBy: DEMO_USER_ID, changedAt: jst("2026-06-23", "17:20")
});

put("auditEvents/demo-audit-attendance-correction", {
  id: "demo-audit-attendance-correction", actorId: DEMO_USER_ID, subjectUserId: DEMO_USER_ID,
  entityType: "attendance", entityId: "demo-att-2026-06-23", action: "corrected",
  reason: "DEMO：通信不良のため実際の始業時刻へ訂正", createdAt: jst("2026-06-23", "18:00")
});

const productSeeds = [
  ["山椒香る米菓", "架空食品ラボA", "うるち米、植物油、山椒、食塩", "new", "demo-rice-cracker.svg"],
  ["柚子白だし", "サンプル調味研究所", "しょうゆ、だし、柚子果汁、食塩", "considering", "demo-yuzu-dashi.svg"],
  ["黒ごま香味だれ", "架空香味工房", "黒ごま、しょうゆ、砂糖、醸造酢", "on_hold", "demo-sesame-sauce.svg"],
  ["梅しそ万能調味料", "デモ自然食品", "梅肉、赤しそ、食塩、砂糖", "closed", "demo-ume-seasoning.svg"],
  ["瀬戸内レモンぽん酢", "架空柑橘産業", "しょうゆ、レモン果汁、醸造酢", "considering", ""],
  ["焙煎ねぎ味噌", "サンプル発酵社", "みそ、ねぎ、砂糖、みりん", "new", ""],
  ["昆布だしスープ", "北海デモフーズ", "昆布エキス、食塩、酵母エキス", "on_hold", ""],
  ["わさび胡麻ドレッシング", "架空高原食品", "食用油、醸造酢、ごま、わさび", "new", ""],
  ["玄米甘酒ミニ", "デモ麹本舗", "玄米、米こうじ", "considering", ""],
  ["七味トマトソース", "架空洋食研究所", "トマト、たまねぎ、唐辛子、山椒", "new", ""],
  ["海苔わさびふりかけ", "サンプル海産", "海苔、ごま、わさび、食塩", "closed", ""],
  ["ほうじ茶蜜", "架空茶房", "水あめ、砂糖、ほうじ茶", "on_hold", ""]
];
const productDates = ["2026-06-16", "2026-06-18", "2026-06-22", "2026-06-24", "2026-06-29", "2026-07-01", "2026-07-03", "2026-07-04", "2026-07-06", "2026-07-08", "2026-07-10", "2026-07-14"];
const sourceTypes = ["store", "business_trip", "internet", "flyer"];
const jan13 = (index) => {
  const base = `459999900${String(index + 1).padStart(3, "0")}`;
  const sum = [...base].reduce((value, digit, position) => value + Number(digit) * (position % 2 === 0 ? 1 : 3), 0);
  return `${base}${(10 - (sum % 10)) % 10}`;
};
productSeeds.forEach(([name, makerBrand, ingredients, status, image], index) => {
  const id = `demo-product-${String(index + 1).padStart(2, "0")}`;
  const observationCount = index < 3 ? 2 : 1;
  const discoveredDate = productDates[index];
  const photo = image ? { kind: "front", name: `DEMO ${name}`, contentType: "image/jpeg", size: 1, storagePath: `demo-static/${image}`, downloadUrl: `/demo-products/${image}` } : undefined;
  put(`products/${id}`, {
    id, name: `DEMO ${name}`, jan: jan13(index), makerBrand: `${makerBrand}（架空）`, ingredients, status,
    ...(photo ? { representativePhoto: photo } : {}), observationCount, latestObserverId: DEMO_USER_ID,
    latestObserverName: "方 蕊（デモ）", latestDiscoveredAt: observationCount === 2 ? addDays(discoveredDate, 7) : discoveredDate,
    createdBy: DEMO_USER_ID, createdAt: jst(discoveredDate, "14:00"), updatedAt: jst(discoveredDate, "14:10")
  });
  put(`demoProductJanIndex/${DEMO_DATASET_ID}_${jan13(index)}`, { productId: id, jan: jan13(index), createdAt: jst(discoveredDate, "14:00") });
});

let observationNumber = 0;
productSeeds.forEach(([name], productIndex) => {
  const count = productIndex < 3 ? 2 : 1;
  for (let repeat = 0; repeat < count; repeat += 1) {
    observationNumber += 1;
    const id = `demo-observation-${String(observationNumber).padStart(2, "0")}`;
    const date = addDays(productDates[productIndex], repeat * 7);
    const source = sourceTypes[(productIndex + repeat) % sourceTypes.length];
    put(`productObservations/${id}`, {
      id, productId: `demo-product-${String(productIndex + 1).padStart(2, "0")}`, userId: DEMO_USER_ID, userName: "方 蕊（デモ）",
      discoveredDate: date, source, sourceDetail: source === "internet" ? "DEMO 架空の商品紹介ページ" : source === "flyer" ? "DEMO 架空スーパーのチラシ" : places[(productIndex + repeat) % 3],
      reasonOriginal: `DEMO：这个“${name}”的包装很容易理解，而且口味有日本特色。我想确认中国消费者是否喜欢。`,
      reasonLanguage: "zh-CN", reasonJapanese: `DEMO：「${name}」は包装が分かりやすく、日本らしい味なので、中国の消費者に好まれるか確認したい。`,
      translationStatus: "completed", translationAttempts: 1, photos: [], reviewStatus: observationNumber === 15 ? "unreviewed" : "reviewed",
      reviewedAt: observationNumber === 15 ? undefined : jst(addDays(date, 1), "10:00"), reviewedBy: observationNumber === 15 ? undefined : "manager-user",
      revision: observationNumber === 4 ? 2 : 1, createdAt: jst(date, "14:00"), updatedAt: jst(date, "14:10")
    });
  }
});

put("productRevisions/demo-product-revision-01", {
  id: "demo-product-revision-01", productId: "demo-product-02",
  before: { name: "DEMO 柚子だし", jan: jan13(1), makerBrand: "サンプル調味研究所（架空）", ingredients: "しょうゆ、だし、柚子果汁" },
  after: { name: "DEMO 柚子白だし", jan: jan13(1), makerBrand: "サンプル調味研究所（架空）", ingredients: "しょうゆ、だし、柚子果汁、食塩" },
  reason: "DEMO：商品ラベルを再確認して名称と原材料を訂正", changedBy: "manager-user", changedAt: jst("2026-06-26", "11:00")
});

const weekStarts = ["2026-06-15", "2026-06-22", "2026-06-29", "2026-07-06", "2026-07-13"];
weekStarts.forEach((weekStart, index) => {
  const id = `${DEMO_USER_ID}_${weekStart}`;
  put(`weeklyPlans/${id}`, {
    id, userId: DEMO_USER_ID, userName: "方 蕊（デモ）", weekStart, weekEnd: addDays(weekStart, 6), status: index < 4 ? "completed" : "confirmed",
    goals: `DEMO：第${index + 1}週は候補商品を比較し、中国市場向けの説明ポイントを整理する。`,
    productFields: "DEMO：調味料、米菓、小容量商品", visitPlans: index % 2 === 0 ? "DEMO：架空商店とサンプル食品研究所を訪問" : "DEMO：オンライン調査と社内共有",
    deliverables: "DEMO：商品比較メモと候補リスト", consultations: "DEMO：優先調査商品の選び方について相談したい。",
    sourceLanguage: "zh-CN", confirmedAt: jst(weekStart, "09:00"), confirmedBy: "manager-user",
    createdAt: jst(weekStart, "08:30"), updatedAt: jst(weekStart, "09:00")
  });
});

weekStarts.slice(0, 4).forEach((weekStart, index) => {
  const id = `${DEMO_USER_ID}_${weekStart}`;
  const weekEnd = addDays(weekStart, 6);
  put(`weeklyReports/${id}`, {
    id, userId: DEMO_USER_ID, userName: "方 蕊（デモ）", weekStart, weekEnd, status: "finalized", hasUnreviewedReports: false, unreviewedReportCount: 0,
    previousGoals: `DEMO：第${index + 1}週の候補商品比較と中国市場向け説明の整理。`,
    completedWork: "DEMO：店頭・オンラインで候補を調査し、商品特徴、原材料、包装を比較した。日報と商品候補へ記録した。",
    productResults: `DEMO：${index + 2}件の商品候補を登録し、試しやすい容量と用途の明確さを評価した。`,
    chinaMarketInsights: "DEMO：日本らしさに加えて、使用方法が視覚的に分かることが重要という意見を共有した。",
    planActualGap: "DEMO：予定した調査は概ね完了。メーカー資料の確認を一部翌週へ継続する。",
    continuingIssues: "DEMO：価格帯、輸送条件、原材料表示の中国語説明を継続確認する。",
    nextWeekPlan: "DEMO：上位候補を比較し、追加のメーカー情報を整理する。", pendingItems: "なし（DEMO）",
    revision: 1, finalizedAt: jst(addDays(weekEnd, 1), "09:30"), finalizedBy: "manager-user",
    createdAt: jst(addDays(weekEnd, 1), "08:50"), updatedAt: jst(addDays(weekEnd, 1), "09:30")
  });
  put(`weeklyMeetings/${id}`, {
    id, weeklyReportId: id, userId: DEMO_USER_ID, weekStart, heldAt: `${addDays(weekEnd, 1)}T09:30:00+09:00`, attendees: "方 蕊（デモ）、糸数泰、社長",
    feedback: "DEMO：商品を選んだ理由が明確で、比較しやすい。次週は優先順位も付ける。",
    chinaMarketInformation: "DEMO：中国では用途が明確な小容量商品が試されやすいという意見を確認した。",
    decisions: "DEMO：上位候補2商品についてメーカー情報を追加調査する。",
    currentWeekGoals: "DEMO：候補商品の比較表を更新する。", nextCheckItems: "DEMO：原材料、容量、包装、想定利用場面を確認する。",
    employeeComment: "DEMO：中国語での説明案も準備します。",
    actionItems: [{ id: `demo-action-${index + 1}`, text: "候補商品の比較表を更新", owner: "方 蕊（デモ）", dueDate: addDays(weekEnd, 5), completed: index < 3 }],
    status: "finalized", finalizedAt: jst(addDays(weekEnd, 1), "10:15"), finalizedBy: "manager-user",
    createdAt: jst(addDays(weekEnd, 1), "09:30"), updatedAt: jst(addDays(weekEnd, 1), "10:15")
  });
});

export function createDemoFixture() {
  const counts = docs.reduce((result, item) => {
    const segments = item.path.split("/");
    const collection = segments[0] === "users" && segments[2] === "workTags"
      ? "workTags"
      : segments[0] === "dailyReports" && segments[2] === "revisions"
        ? "reportRevisions"
        : segments[0];
    result[collection] = (result[collection] || 0) + 1;
    return result;
  }, {});
  const dataset = {
    id: DEMO_DATASET_ID, label: "方 蕊（デモ）2026年6月15日〜7月15日", demoUserId: DEMO_USER_ID, demoUserEmail: DEMO_EMAIL,
    seedVersion: DEMO_SEED_VERSION, periodStart: DEMO_PERIOD_START, periodEnd: DEMO_PERIOD_END, status: "ready", counts,
    isDemo: true, demoDatasetId: DEMO_DATASET_ID, createdAt: jst("2026-07-15", "18:00"), updatedAt: jst("2026-07-15", "18:00")
  };
  return {
    authUser: { uid: DEMO_USER_ID, email: DEMO_EMAIL, displayName: "方 蕊（デモ）", claims: { role: "employee", isDemo: true, demoDatasetId: DEMO_DATASET_ID, seedVersion: DEMO_SEED_VERSION } },
    dataset,
    documents: [...docs, { path: `demoDatasets/${DEMO_DATASET_ID}`, data: dataset }],
    expected: { weekdays: weekdays.length, normalAttendance: 22, holidayAttendance: 1, attendance: 23, nonWorkingReasons: 1, workLogs: 60, dailyReports: 23, products: 12, productObservations: 15, weeklyPlans: 5, weeklyReports: 4, weeklyMeetings: 4, unreviewedDailyReports: 1 }
  };
}

export function fixtureSummary() {
  const fixture = createDemoFixture();
  return { datasetId: DEMO_DATASET_ID, seedVersion: DEMO_SEED_VERSION, projectId: DEMO_PROJECT_ID, demoUser: fixture.authUser, expected: fixture.expected, documentCounts: fixture.dataset.counts, totalDocuments: fixture.documents.length };
}
