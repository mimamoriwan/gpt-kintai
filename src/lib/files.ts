import type { Attachment } from "../types";

export const MAX_ATTACHMENTS = 5;
export const MAX_REPORT_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 1024 * 1024;

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

export function validateFiles(files: File[], existing: Attachment[] = []): string | null {
  if (files.length + existing.length > MAX_ATTACHMENTS) return "添付は5件までです。";
  const total = files.reduce((sum, file) => sum + file.size, existing.reduce((sum, item) => sum + item.size, 0));
  if (total > MAX_REPORT_BYTES) return "添付の合計は20MBまでです。";
  for (const file of files) {
    if (!allowedTypes.has(file.type)) return `${file.name} は対応していない形式です。`;
    const limit = file.type.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
    if (file.size > limit && !file.type.startsWith("image/")) return `${file.name} は10MB以下にしてください。`;
  }
  return null;
}

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= MAX_IMAGE_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像を処理できませんでした。");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let quality = 0.82;
  let blob: Blob | null = null;
  do {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    quality -= 0.1;
  } while (blob && blob.size > MAX_IMAGE_BYTES && quality >= 0.42);
  if (!blob || blob.size > MAX_IMAGE_BYTES) throw new Error("画像を1MB以下にできませんでした。");
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
}

export function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
