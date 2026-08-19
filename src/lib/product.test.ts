import { describe, expect, it } from "vitest";
import { isValidJan, localizeProductWarnings, normalizeJan, normalizeProductFacts, normalizeProductMatch } from "./product";

describe("product helpers", () => {
  it("validates JAN-8 and JAN-13 check digits", () => {
    expect(isValidJan("12345670")).toBe(true);
    expect(isValidJan("4901234567894")).toBe(true);
    expect(isValidJan("12345671")).toBe(false);
    expect(isValidJan("4901234567890")).toBe(false);
  });

  it("removes JAN separators", () => {
    expect(normalizeJan("490 1234-567894")).toBe("4901234567894");
  });

  it("normalizes product matching text for duplicate suggestions", () => {
    expect(normalizeProductMatch("ＡＢＣ 食品・ラー油")).toBe("abc食品ラー油");
  });

  it("normalizes nullable AI fields before registration", () => {
    expect(normalizeProductFacts({ name: "ゆずドレッシング", jan: null, makerBrand: undefined, ingredients: "醸造酢" })).toEqual({
      name: "ゆずドレッシング",
      jan: "",
      makerBrand: "",
      ingredients: "醸造酢"
    });
  });

  it("does not expose an English AI warning in the Japanese form", () => {
    expect(localizeProductWarnings(["JAN digits are slightly uncertain."], "ja")).toEqual([
      "写真の状態により読み取りが不確かな項目があります。写真と入力内容を確認してください。"
    ]);
  });
});
