import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductsPage } from "./ProductsPage";
import type { Product } from "../types";

const apiMocks = vi.hoisted(() => ({
  saveProductCandidate: vi.fn(),
  analyzeProductPhotos: vi.fn(),
  uploadProductPhotos: vi.fn(),
  attachProductPhotos: vi.fn(),
  retryProductReasonTranslation: vi.fn(),
  reviewProductObservation: vi.fn(),
  setProductEstimateRequested: vi.fn(),
  setProductStatus: vi.fn(),
  updateProductFacts: vi.fn(),
  updateProductObservation: vi.fn()
}));
const productMocks = vi.hoisted(() => ({ compressProductImage: vi.fn() }));

vi.mock("../auth", () => ({
  useAuth: () => ({ profile: { uid: "employee-1", role: "employee", displayName: "担当者", locale: "ja" } })
}));

vi.mock("../i18n", () => ({
  useI18n: () => ({ locale: "ja" })
}));

vi.mock("../services/api", () => apiMocks);
vi.mock("../lib/product", async () => ({
  ...await vi.importActual<typeof import("../lib/product")>("../lib/product"),
  compressProductImage: productMocks.compressProductImage
}));

afterEach(cleanup);

describe("product registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:product-photo") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    apiMocks.saveProductCandidate.mockResolvedValue({
      productId: "product-1",
      observationId: "observation-1",
      translationStatus: "not_required",
      reportAlreadySubmitted: false
    });
    apiMocks.uploadProductPhotos.mockResolvedValue([]);
    apiMocks.attachProductPhotos.mockResolvedValue(undefined);
    apiMocks.setProductEstimateRequested.mockResolvedValue(undefined);
    productMocks.compressProductImage.mockImplementation(async (file: File) => new File([file], "product.jpg", { type: "image/jpeg" }));
  });

  it("explains automatic HEIC conversion and JPEG compression", () => {
    render(<ProductsPage products={[]} observations={[]} revisions={[]} users={[]} notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "商品を登録" }));

    expect(screen.getByText("HEIC対応・JPEG 1MB以下へ自動調整")).toBeInTheDocument();
    expect(screen.getByText(/端末上でJPEGへ変換・軽量化/)).toBeInTheDocument();
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
      expect(input.accept).toContain(".heic");
      expect(input.accept).toContain(".heif");
    }
  });

  it("sends an empty existing product ID instead of a callable null", async () => {
    const notify = vi.fn();
    render(<ProductsPage products={[]} observations={[]} revisions={[]} users={[]} notify={notify} />);
    fireEvent.click(screen.getByRole("button", { name: "商品を登録" }));
    fireEvent.change(screen.getByLabelText("商品名 *"), { target: { value: "ゆずドレッシング" } });
    fireEvent.click(screen.getByRole("button", { name: "この内容で登録" }));

    await waitFor(() => expect(apiMocks.saveProductCandidate).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveProductCandidate.mock.calls[0][0]).toMatchObject({
      existingProductId: "",
      createNewWithoutJan: true,
      facts: { name: "ゆずドレッシング", jan: "", makerBrand: "", ingredients: "" }
    });
    expect(notify).toHaveBeenCalledWith("success", "商品候補を登録しました。");
  });

  it("shares an estimate request selected during registration", async () => {
    render(<ProductsPage products={[]} observations={[]} revisions={[]} users={[]} notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "商品を登録" }));
    fireEvent.change(screen.getByLabelText("商品名 *"), { target: { value: "見積もり対象商品" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /この商品の見積もりを希望する/ }));
    fireEvent.click(screen.getByRole("button", { name: "この内容で登録" }));

    await waitFor(() => expect(apiMocks.saveProductCandidate).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveProductCandidate.mock.calls[0][0].estimateRequested).toBe(true);
  });

  it("shows estimate-requested products clearly in the shared list", () => {
    const product = {
      id: "product-1", name: "見積もり対象商品", jan: "", makerBrand: "テスト食品", ingredients: "",
      estimateRequested: true, status: "new", observationCount: 1, latestObserverId: "employee-1",
      latestObserverName: "担当者", latestDiscoveredAt: "2026-08-25", createdBy: "employee-1"
    } as Product;

    render(<ProductsPage products={[product]} observations={[]} revisions={[]} users={[]} notify={vi.fn()} />);

    expect(screen.getByText("見積もり希望")).toBeInTheDocument();
  });

  it("allows an estimate request to be selected after registration", async () => {
    const notify = vi.fn();
    const product = {
      id: "product-1", name: "登録済み商品", jan: "", makerBrand: "テスト食品", ingredients: "",
      estimateRequested: false, status: "new", observationCount: 1, latestObserverId: "employee-1",
      latestObserverName: "担当者", latestDiscoveredAt: "2026-08-25", createdBy: "employee-1"
    } as Product;
    render(<ProductsPage products={[product]} observations={[]} revisions={[]} users={[]} notify={notify} />);
    fireEvent.click(screen.getByRole("button", { name: /登録済み商品/ }));

    const checkbox = screen.getByRole("checkbox", { name: /この商品の見積もりを希望する/ });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);

    await waitFor(() => expect(apiMocks.setProductEstimateRequested).toHaveBeenCalledWith("product-1", true));
    expect(checkbox).toBeChecked();
    expect(screen.getByText("見積もり希望")).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("success", "見積もり希望に設定しました。");
  });

  it("updates the list immediately when returning before the server refresh arrives", async () => {
    let finishSave: (() => void) | undefined;
    apiMocks.setProductEstimateRequested.mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    const product = {
      id: "product-1", name: "見積もり解除商品", jan: "", makerBrand: "テスト食品", ingredients: "",
      estimateRequested: true, status: "new", observationCount: 1, latestObserverId: "employee-1",
      latestObserverName: "担当者", latestDiscoveredAt: "2026-08-25", createdBy: "employee-1"
    } as Product;
    render(<ProductsPage products={[product]} observations={[]} revisions={[]} users={[]} notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /見積もり解除商品/ }));

    fireEvent.click(screen.getByRole("checkbox", { name: /この商品の見積もりを希望する/ }));
    fireEvent.click(screen.getByRole("button", { name: "商品一覧へ" }));

    expect(screen.queryByText("見積もり希望")).not.toBeInTheDocument();
    finishSave?.();
    await waitFor(() => expect(apiMocks.setProductEstimateRequested).toHaveBeenCalledWith("product-1", false));
  });

  it("requires the user to confirm a valid JAN read by AI against the photo", async () => {
    const notify = vi.fn();
    apiMocks.analyzeProductPhotos.mockResolvedValue({
      name: "ゆずドレッシング",
      jan: "4901234567894",
      makerBrand: "テスト食品",
      ingredients: "醸造酢",
      warnings: [],
      janValid: true
    });
    render(<ProductsPage products={[]} observations={[]} revisions={[]} users={[]} notify={notify} />);
    fireEvent.click(screen.getByRole("button", { name: "商品を登録" }));
    fireEvent.change(document.querySelectorAll<HTMLInputElement>('input[type="file"]')[1], {
      target: { files: [new File(["photo"], "jan.heic", { type: "image/heic" })] }
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "選択した写真をAIで読み取る" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "選択した写真をAIで読み取る" }));

    const confirmation = await screen.findByRole("checkbox", { name: /写真と照合してJANコードを確認しました/ });
    fireEvent.click(screen.getByRole("button", { name: "この内容で登録" }));
    expect(apiMocks.saveProductCandidate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith("error", "写真と照合してJANコードを確認し、確認欄にチェックしてください。");

    fireEvent.click(confirmation);
    fireEvent.click(screen.getByRole("button", { name: "この内容で登録" }));
    await waitFor(() => expect(apiMocks.saveProductCandidate).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveProductCandidate.mock.calls[0][0].facts.jan).toBe("4901234567894");
  });

  it("keeps the submit button actionable and offers registration without an invalid AI-read JAN", async () => {
    const notify = vi.fn();
    apiMocks.analyzeProductPhotos.mockResolvedValue({
      name: "ゆずドレッシング",
      jan: "4965009016032",
      makerBrand: "テスト食品",
      ingredients: "醸造酢",
      warnings: ["JANコードを確認してください。"],
      janValid: false
    });
    render(<ProductsPage products={[]} observations={[]} revisions={[]} users={[]} notify={notify} />);
    fireEvent.click(screen.getByRole("button", { name: "商品を登録" }));
    fireEvent.change(document.querySelectorAll<HTMLInputElement>('input[type="file"]')[1], {
      target: { files: [new File(["photo"], "jan.heic", { type: "image/heic" })] }
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "選択した写真をAIで読み取る" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "選択した写真をAIで読み取る" }));

    await screen.findByText("このJANコードは登録できません");
    const submit = screen.getByRole("button", { name: "この内容で登録" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(apiMocks.saveProductCandidate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith("error", "JANコードを写真と照合して修正するか、「JANなしで登録」を選択してください。");

    fireEvent.click(screen.getByRole("button", { name: "JANなしで登録する" }));
    expect(screen.getByPlaceholderText("JAN-8 / JAN-13")).toHaveValue("");
    fireEvent.click(submit);
    await waitFor(() => expect(apiMocks.saveProductCandidate).toHaveBeenCalledTimes(1));
    expect(apiMocks.saveProductCandidate.mock.calls[0][0].facts.jan).toBe("");
  });
});
