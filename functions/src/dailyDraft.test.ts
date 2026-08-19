import { describe, expect, it } from "vitest";
import {
  MAX_DAILY_DRAFT_BYTES,
  assertDailyDraftAttachmentLimits,
  canGenerateDailyDraft,
  findDailyDraftCache,
  prepareDailyDraftSource
} from "./dailyDraft.js";

describe("daily report draft sources", () => {
  const settings = { reportDate: "2026-07-25", sourceLanguage: "ja" as const, hasTravel: false };

  it("creates a stable fingerprint source and associates files with each memo", () => {
    const source = prepareDailyDraftSource(settings, [
      {
        id: "later",
        tagLabel: "商談",
        text: "見積条件を確認",
        createdAtMillis: 20,
        attachments: [
          { id: "b", name: "見積書.pdf", contentType: "application/pdf", size: 1200, storagePath: "reports/u/work-log-later/b.pdf" },
          { id: "c", name: "商品画像.png", contentType: "image/png", size: 900, storagePath: "reports/u/work-log-later/c.png" }
        ]
      },
      { id: "first", tagLabel: "調査", text: "市場を確認", createdAtMillis: 10, attachments: [{ id: "link", name: "参考", linkUrl: "https://example.com" }] }
    ]);

    expect(source.memoSources.map((item) => item.sourceRef)).toEqual(["workLog:first", "workLog:later"]);
    expect(source.memoSources[1].attachmentRefs).toEqual(["attachment:later:b", "attachment:later:c"]);
    expect(source.files.map((item) => item.name)).toEqual(["見積書.pdf", "商品画像.png"]);
    expect(source.skippedLinkCount).toBe(1);
    expect(prepareDailyDraftSource(settings, [
      { id: "first", tagLabel: "調査", text: "市場を確認", createdAtMillis: 10, attachments: [{ id: "link", name: "参考", linkUrl: "https://example.com" }] },
      {
        id: "later",
        tagLabel: "商談",
        text: "見積条件を確認",
        createdAtMillis: 20,
        attachments: [
          { id: "b", name: "見積書.pdf", contentType: "application/pdf", size: 1200, storagePath: "reports/u/work-log-later/b.pdf" },
          { id: "c", name: "商品画像.png", contentType: "image/png", size: 900, storagePath: "reports/u/work-log-later/c.png" }
        ]
      }
    ]).fingerprintJson).toBe(source.fingerprintJson);
  });

  it("rejects more than the daily file and byte limits", () => {
    const file = { sourceRef: "a", workLogId: "l", tag: "調査", id: "a", name: "a.pdf", contentType: "application/pdf", size: 1, storagePath: "a" };
    expect(() => assertDailyDraftAttachmentLimits(Array.from({ length: 11 }, (_, index) => ({ ...file, id: String(index) })))).toThrow("1日10件");
    expect(() => assertDailyDraftAttachmentLimits([{ ...file, size: MAX_DAILY_DRAFT_BYTES + 1 }])).toThrow("20MB");
  });

  it("finds an existing cached result for identical content", () => {
    const cached = { contentHash: "same", draft: { category: "調査" }, analyzedAttachmentCount: 1, skippedLinkCount: 0, generatedAt: "2026-07-25T00:00:00.000Z" };
    expect(findDailyDraftCache([cached], "same")).toEqual(cached);
    expect(findDailyDraftCache([cached], "different")).toBeNull();
  });

  it("allows at most two successful API generations", () => {
    expect(canGenerateDailyDraft(0)).toBe(true);
    expect(canGenerateDailyDraft(1)).toBe(true);
    expect(canGenerateDailyDraft(2)).toBe(false);
    expect(canGenerateDailyDraft(3)).toBe(false);
  });
});
