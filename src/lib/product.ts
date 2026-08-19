import type { ProductFacts } from "../types";

const MAX_PRODUCT_IMAGE_BYTES = 1024 * 1024;
const MAX_PRODUCT_IMAGE_DIMENSION = 1600;
const MIN_PRODUCT_IMAGE_DIMENSION = 480;

export function normalizeJan(value: string): string {
  return value.replace(/[\s-]/g, "");
}

export function isValidJan(value: string): boolean {
  const jan = normalizeJan(value);
  if (!/^\d{8}$|^\d{13}$/.test(jan)) return false;
  const digits = [...jan].map(Number);
  const checkDigit = digits.pop()!;
  const sum = digits.reduce((total, digit, index) => {
    const weight = jan.length === 13 ? (index % 2 === 0 ? 1 : 3) : (index % 2 === 0 ? 3 : 1);
    return total + digit * weight;
  }, 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}

export function normalizeProductMatch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

export function normalizeProductFacts(value: Partial<Record<keyof ProductFacts, unknown>>): ProductFacts {
  return {
    name: typeof value.name === "string" ? value.name : "",
    jan: typeof value.jan === "string" ? value.jan : "",
    makerBrand: typeof value.makerBrand === "string" ? value.makerBrand : "",
    ingredients: typeof value.ingredients === "string" ? value.ingredients : ""
  };
}

export function localizeProductWarnings(warnings: unknown, locale: string): string[] {
  if (!Array.isArray(warnings)) return [];
  const output = warnings
    .filter((warning): warning is string => typeof warning === "string" && Boolean(warning.trim()))
    .map((warning) => warning.trim())
    .map((warning) => {
      if (locale === "ja" && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(warning)) {
        return "写真の状態により読み取りが不確かな項目があります。写真と入力内容を確認してください。";
      }
      if (locale !== "ja" && !/[\u3400-\u9fff]/u.test(warning)) {
        return "照片中有无法完全确认的内容，请对照原图检查识别结果。";
      }
      return warning;
    });
  return [...new Set(output)];
}

export async function compressProductImage(file: File): Promise<File> {
  const heic = isHeicFile(file);
  if (!file.type.startsWith("image/") && !heic) throw new Error("画像ファイルを選択してください。");
  const input = heic ? await convertHeicToJpeg(file) : file;
  const source = await loadImageSource(input);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    source.close();
    throw new Error("画像を処理できませんでした。");
  }
  const initialScale = Math.min(1, MAX_PRODUCT_IMAGE_DIMENSION / Math.max(source.width, source.height));
  let width = Math.max(1, Math.round(source.width * initialScale));
  let height = Math.max(1, Math.round(source.height * initialScale));
  let blob: Blob | null = null;
  try {
    while (true) {
      canvas.width = width;
      canvas.height = height;
      context.drawImage(source.image, 0, 0, width, height);
      for (let quality = 0.86; quality >= 0.42; quality -= 0.08) {
        blob = await canvasToBlob(canvas, quality);
        if (blob.size <= MAX_PRODUCT_IMAGE_BYTES) break;
      }
      if (blob && blob.size <= MAX_PRODUCT_IMAGE_BYTES) break;
      if (Math.max(width, height) <= MIN_PRODUCT_IMAGE_DIMENSION) break;
      width = Math.max(1, Math.round(width * 0.78));
      height = Math.max(1, Math.round(height * 0.78));
    }
  } finally {
    source.close();
  }
  if (!blob || blob.size > MAX_PRODUCT_IMAGE_BYTES) throw new Error("画像を1MB以下に圧縮できませんでした。別の写真を選択してください。");
  const base = file.name.replace(/\.[^.]+$/, "") || "product";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

function isHeicFile(file: File): boolean {
  return /^(image\/hei[cf]|image\/heic-sequence|image\/heif-sequence)$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

async function convertHeicToJpeg(file: File): Promise<File> {
  try {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!blob) throw new Error("HEIC画像を変換できませんでした。");
    const base = file.name.replace(/\.[^.]+$/, "") || "product";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    throw new Error("HEIC画像を変換できませんでした。別の写真を選択するか、iPhoneのカメラ設定を「互換性優先」にしてください。");
  }
}

async function loadImageSource(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("画像を変換できませんでした。")), "image/jpeg", quality));
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    reader.readAsDataURL(file);
  });
}
