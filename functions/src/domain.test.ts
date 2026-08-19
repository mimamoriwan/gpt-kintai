import { describe, expect, it } from "vitest";
import {
  assertManualClockInTime,
  assertTimeRange,
  calendarEventInputSchema,
  clockInInputSchema,
  csvEscape,
  formatTaggedActivities,
  groupWorkLogEntries,
  isValidJan,
  jstDate,
  normalizeJan,
  productFactsSchema,
  productObservationInputSchema,
  reportDraftInputSchema,
  reportInputSchema,
  weeklyReportSectionsSchema
} from "./domain.js";

describe("calendar event validation", () => {
  const base = {
    startDate: "2026-08-03",
    endDate: "2026-08-03",
    eventType: "work" as const,
    title: "取引先との商談",
    participantIds: ["fang", "manager"]
  };

  it("accepts all-day, start-only, and time-range events", () => {
    expect(calendarEventInputSchema.parse(base).startTime).toBe("");
    expect(calendarEventInputSchema.parse({ ...base, startTime: "10:00" }).endTime).toBe("");
    expect(calendarEventInputSchema.parse({ ...base, startTime: "10:00", endTime: "11:30" }).endTime).toBe("11:30");
  });

  it("rejects duplicate or excessive participants and invalid time ranges", () => {
    expect(() => calendarEventInputSchema.parse({ ...base, participantIds: ["fang", "fang"] })).toThrow();
    expect(() => calendarEventInputSchema.parse({ ...base, participantIds: ["1", "2", "3", "4"] })).toThrow();
    expect(() => calendarEventInputSchema.parse({ ...base, endTime: "11:00" })).toThrow();
    expect(() => calendarEventInputSchema.parse({ ...base, startTime: "12:00", endTime: "11:00" })).toThrow();
  });

  it("accepts up to 60 days and rejects a longer or reversed range", () => {
    expect(calendarEventInputSchema.parse({ ...base, endDate: "2026-10-01" }).endDate).toBe("2026-10-01");
    expect(() => calendarEventInputSchema.parse({ ...base, endDate: "2026-10-02" })).toThrow();
    expect(() => calendarEventInputSchema.parse({ ...base, endDate: "2026-08-02" })).toThrow();
  });

  it("removes private fields from leave plans on the server", () => {
    const parsed = calendarEventInputSchema.parse({ ...base, eventType: "leave", title: "私用", startTime: "09:00", endTime: "12:00", memo: "私用の理由" });
    expect(parsed).toMatchObject({ title: "休み", startTime: "", endTime: "", memo: "" });
  });

  it("keeps the legacy single-date input compatible during rollout", () => {
    const parsed = calendarEventInputSchema.parse({ date: "2026-08-03", title: "旧画面の予定", participantIds: ["manager"] });
    expect(parsed).toMatchObject({ eventType: "work", startDate: "2026-08-03", endDate: "2026-08-03" });
  });

  it("treats null optional IDs from cached Firebase clients as unspecified", () => {
    const parsed = calendarEventInputSchema.parse({ ...base, id: null, groupId: null });
    expect(parsed.id).toBeUndefined();
    expect(parsed.groupId).toBeUndefined();
  });

  it("continues to reject malformed calendar IDs", () => {
    expect(() => calendarEventInputSchema.parse({ ...base, id: "bad/id" })).toThrow();
    expect(() => calendarEventInputSchema.parse({ ...base, groupId: "x".repeat(181) })).toThrow();
  });
});

describe("report validation", () => {
  const base = {
    reportDate: "2026-07-27",
    sourceLanguage: "zh-CN",
    fields: { category: "product_discovery", area: "東京都", destinations: "食品会社", activities: "商品調査", findings: "候補を発見", nextPlan: "見積依頼" },
    attachments: []
  };
  it("accepts a valid bilingual report", () => { expect(reportInputSchema.parse(base).sourceLanguage).toBe("zh-CN"); });
  it("accepts an office report without travel details or findings", () => {
    const parsed = reportInputSchema.parse({ ...base, fields: { ...base.fields, area: "", destinations: "", findings: "", nextPlan: "" } });
    expect(parsed.fields.area).toBe("");
    expect(parsed.fields.findings).toBe("");
  });
  it("rejects non-http links", () => { expect(() => reportInputSchema.parse({ ...base, attachments: [{ id: "1", name: "bad", contentType: "text/uri-list", size: 0, linkUrl: "javascript:alert(1)" }] })).toThrow(); });
  it("requires a correction reason when supplied to be meaningful", () => { expect(() => reportInputSchema.parse({ ...base, correctionReason: "x" })).toThrow(); });
});

describe("time and export helpers", () => {
  it("uses Japan date boundaries", () => { expect(jstDate(new Date("2026-07-26T15:01:00Z"))).toBe("2026-07-27"); });
  it("rejects an end before start", () => { expect(() => assertTimeRange(new Date("2026-07-27T10:00:00Z"), new Date("2026-07-27T09:00:00Z"))).toThrow(); });
  it("rejects an end equal to start", () => { expect(() => assertTimeRange(new Date("2026-07-27T10:00:00Z"), new Date("2026-07-27T10:00:00Z"), new Date("2026-07-27T12:00:00Z"))).toThrow(); });
  it("rejects future start and end times", () => {
    const now = new Date("2026-07-27T12:00:00Z");
    expect(() => assertTimeRange(new Date("2026-07-27T12:01:00Z"), undefined, now)).toThrow();
    expect(() => assertTimeRange(new Date("2026-07-27T10:00:00Z"), new Date("2026-07-27T12:01:00Z"), now)).toThrow();
  });
  it("accepts a completed past range", () => {
    expect(() => assertTimeRange(new Date("2026-07-27T10:00:00Z"), new Date("2026-07-27T11:59:00Z"), new Date("2026-07-27T12:00:00Z"))).not.toThrow();
  });
  it("escapes CSV values", () => { expect(csvEscape('A,"B"')).toBe('"A,""B"""'); });
});

describe("clock-in validation", () => {
  it("accepts realtime and complete manual clock-in", () => {
    expect(clockInInputSchema.parse({ workMode: "office" }).workMode).toBe("office");
    expect(clockInInputSchema.parse({ workMode: "office", startedAt: "2026-07-21T09:00:00+09:00", reason: "打刻を忘れたため" }).reason).toBe("打刻を忘れたため");
  });

  it("rejects incomplete manual input", () => {
    expect(() => clockInInputSchema.parse({ workMode: "office", startedAt: "2026-07-21T09:00:00+09:00" })).toThrow();
  });

  it("accepts a start time on the same Japan date", () => {
    expect(() => assertManualClockInTime(new Date("2026-07-21T00:00:00Z"), new Date("2026-07-21T04:00:00Z"))).not.toThrow();
  });

  it("rejects future and previous-day start times", () => {
    expect(() => assertManualClockInTime(new Date("2026-07-21T04:02:00Z"), new Date("2026-07-21T04:00:00Z"))).toThrow();
    expect(() => assertManualClockInTime(new Date("2026-07-20T14:00:00Z"), new Date("2026-07-20T16:00:00Z"))).toThrow();
  });
});

describe("work log grouping", () => {
  it("treats a missing travel flag from an older app as no travel", () => {
    expect(reportDraftInputSchema.parse({ reportDate: "2026-07-16", sourceLanguage: "ja" }).hasTravel).toBe(false);
  });

  it("keeps tag order and groups notes under the selected tag", () => {
    expect(groupWorkLogEntries([
      { tag: "食品卸", text: "見積書を確認" },
      { tag: "アプリ開発", text: "終業エラーを確認" },
      { tag: "食品卸", text: "納品を完了" }
    ])).toEqual([
      { tag: "食品卸", entries: ["見積書を確認", "納品を完了"] },
      { tag: "アプリ開発", entries: ["終業エラーを確認"] }
    ]);
  });

  it("formats readable tag sections and falls back to original notes", () => {
    const groups = [{ tag: "食品卸", entries: ["見積書を確認", "納品を完了"] }, { tag: "その他", entries: ["電話対応"] }];
    expect(formatTaggedActivities(groups, [{ tag: "食品卸", summary: "見積書を確認し、納品を完了した。" }]))
      .toBe("【食品卸】\n見積書を確認し、納品を完了した。\n\n【その他】\n電話対応");
  });
});

describe("product candidate validation", () => {
  it("accepts valid JAN-8 and JAN-13 values", () => {
    expect(isValidJan("12345670")).toBe(true);
    expect(isValidJan("4901234567894")).toBe(true);
    expect(isValidJan("490-1234-567894")).toBe(true);
  });

  it("rejects invalid lengths, characters, and check digits", () => {
    expect(isValidJan("")).toBe(false);
    expect(isValidJan("1234567")).toBe(false);
    expect(isValidJan("12345671")).toBe(false);
    expect(isValidJan("490123456789X")).toBe(false);
  });

  it("normalizes spaces and hyphens without inventing digits", () => {
    expect(normalizeJan("490 1234-567894")).toBe("4901234567894");
  });

  it("allows a product without a JAN but requires a product name", () => {
    expect(productFactsSchema.parse({ name: "気になる調味料", jan: "", makerBrand: "", ingredients: "" }).jan).toBe("");
    expect(() => productFactsSchema.parse({ name: "", jan: "", makerBrand: "", ingredients: "" })).toThrow();
  });

  it("defaults optional product observation flags safely", () => {
    const parsed = productObservationInputSchema.parse({
      draftId: "draft-123456",
      discoveredDate: "2026-07-19",
      source: "store",
      reasonLanguage: "zh-CN",
      facts: { name: "辣椒酱", jan: "", makerBrand: "", ingredients: "" }
    });
    expect(parsed.addToWorkMemo).toBe(false);
    expect(parsed.createNewWithoutJan).toBe(false);
  });

  it("treats null optional product fields from callable clients as empty strings", () => {
    const parsed = productObservationInputSchema.parse({
      draftId: "draft-123456",
      existingProductId: null,
      discoveredDate: "2026-07-19",
      source: "store",
      sourceDetail: null,
      reasonOriginal: null,
      reasonLanguage: "ja",
      facts: { name: "ゆずドレッシング", jan: null, makerBrand: null, ingredients: null }
    });
    expect(parsed.existingProductId).toBe("");
    expect(parsed.sourceDetail).toBe("");
    expect(parsed.reasonOriginal).toBe("");
    expect(parsed.facts).toEqual({ name: "ゆずドレッシング", jan: "", makerBrand: "", ingredients: "" });
  });
});

describe("weekly report validation", () => {
  it("accepts the expanded meeting-agenda structure", () => {
    const parsed = weeklyReportSectionsSchema.parse({
      executiveSummary: "前週は商品調査を中心に進めた。",
      keyOutcomes: "候補商品を3件登録した。",
      blockers: "メーカー回答待ち。",
      decisionsNeeded: "試食候補を決める必要がある。",
      themes: [{
        title: "商品発掘",
        objective: "中国市場向け候補を探す。",
        activities: "店頭調査を行った。",
        outcomes: "候補を3件登録した。",
        evidence: "日報 2026/07/15、商品候補3件",
        chinaMarketInsight: "小容量商品への関心が高い。",
        issues: "価格条件が未確認。",
        nextAction: "メーカーへ問い合わせる。",
        sourceReferences: ["日報 2026/07/15"]
      }],
      nextPriorities: [{
        title: "メーカーへの確認",
        basis: "confirmed",
        owner: "方 蕊",
        dueDate: "2026-07-24",
        definitionOfDone: "回答内容を商品候補へ追記する。"
      }],
      previousGoals: "候補商品の調査",
      completedWork: "店頭調査",
      productResults: "3商品を登録",
      chinaMarketInsights: "小容量への関心",
      planActualGap: "1社は未訪問",
      continuingIssues: "回答待ち",
      nextWeekPlan: "メーカー確認",
      pendingItems: "日報はすべて確認済み"
    });

    expect(parsed.themes).toHaveLength(1);
    expect(parsed.nextPriorities[0]?.basis).toBe("confirmed");
  });

  it("keeps legacy weekly reports readable", () => {
    const parsed = weeklyReportSectionsSchema.parse({
      previousGoals: "旧形式の目標",
      completedWork: "旧形式の実績"
    });

    expect(parsed.executiveSummary).toBe("");
    expect(parsed.themes).toEqual([]);
    expect(parsed.nextPriorities).toEqual([]);
    expect(parsed.previousGoals).toBe("旧形式の目標");
  });
});
