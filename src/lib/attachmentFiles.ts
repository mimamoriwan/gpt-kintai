import { MAX_DOCUMENT_BYTES } from "./files";
import type { Attachment } from "../types";

export function isAppleMobileDevice(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function canShareAttachment(file: File): boolean {
  try {
    return typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }) === true;
  } catch {
    return false;
  }
}

export async function fetchAttachmentFile(url: string, attachment: Attachment, signal: AbortSignal): Promise<File> {
  const response = await fetch(url, { signal, credentials: "omit", cache: "no-store" });
  if (!response.ok) throw new Error(`Attachment download failed (${response.status})`);
  const blob = await response.blob();
  if (!blob.size || blob.size > MAX_DOCUMENT_BYTES || blob.size !== attachment.size) {
    throw new Error("Attachment download is incomplete");
  }
  return new File([blob], attachment.name, { type: attachment.contentType });
}
