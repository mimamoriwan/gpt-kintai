import { useEffect, useId, useRef, useState } from "react";
import { FileText, Image as ImageIcon } from "lucide-react";
import { presidentInstructionAttachmentUrl } from "../services/api";
import { canShareAttachment, fetchAttachmentFile, isAppleMobileDevice } from "../lib/attachmentFiles";
import type { Attachment } from "../types";

const LOAD_TIMEOUT_MS = 30_000;

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// Remount when a file changes, so an old URL or downloaded file is never reused.
export function InstructionAttachmentLink(props: { attachment: Attachment; locale: string }) {
  const { attachment } = props;
  return <AttachmentLink key={JSON.stringify([attachment.id, attachment.storagePath, attachment.downloadUrl, attachment.name, attachment.contentType, attachment.size])} {...props} />;
}

function AttachmentLink({ attachment, locale }: { attachment: Attachment; locale: string }) {
  const ja = locale === "ja";
  const panelId = useId();
  const appleMobile = isAppleMobileDevice();
  const [url, setUrl] = useState(attachment.downloadUrl || "");
  const [urlFailed, setUrlFailed] = useState(false);
  const [urlAttempt, setUrlAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (attachment.downloadUrl) return;
    let active = true;
    setUrlFailed(false);
    const timer = window.setTimeout(() => {
      active = false;
      setUrlFailed(true);
    }, LOAD_TIMEOUT_MS);
    const request = attachment.storagePath
      ? presidentInstructionAttachmentUrl(attachment.storagePath)
      : Promise.reject(new Error("Missing attachment path"));
    void request.then((value) => { if (active) setUrl(value); })
      .catch(() => { if (active) setUrlFailed(true); })
      .finally(() => window.clearTimeout(timer));
    return () => { active = false; window.clearTimeout(timer); };
  }, [attachment.downloadUrl, attachment.storagePath, urlAttempt]);

  useEffect(() => {
    if (!expanded || !url) return;
    const controller = new AbortController();
    let active = true;
    let objectUrl = "";
    setFile(null);
    setLocalUrl("");
    setFailed(false);
    setShareFailed(false);
    const timer = window.setTimeout(() => {
      active = false;
      controller.abort();
      setFailed(true);
    }, LOAD_TIMEOUT_MS);
    void fetchAttachmentFile(url, attachment, controller.signal).then((downloaded) => {
      if (!active) return;
      if (downloaded.type.startsWith("image/")) {
        objectUrl = URL.createObjectURL(downloaded);
        setLocalUrl(objectUrl);
      }
      setFile(downloaded);
    }).catch(() => { if (active) setFailed(true); })
      .finally(() => window.clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [expanded, url, attempt, attachment.name, attachment.contentType, attachment.size]);

  useEffect(() => {
    if (file && document.activeElement === triggerRef.current) actionRef.current?.focus();
  }, [file]);

  async function shareFile() {
    if (!file || sharing) return;
    setSharing(true);
    setShareFailed(false);
    try {
      // Call directly from this tap. Awaiting a download first loses iOS user activation.
      await navigator.share({ files: [file] });
    } catch (error) {
      if (!(error && typeof error === "object" && "name" in error && error.name === "AbortError")) setShareFailed(true);
    } finally {
      setSharing(false);
    }
  }

  const label = <>{attachment.contentType.startsWith("image/") ? <ImageIcon size={17} /> : <FileText size={17} />}<span><strong>{attachment.name}</strong><small>{url ? formatSize(attachment.size) : urlFailed ? (ja ? "読み込みを再試行" : "重新加载") : (ja ? "読込中…" : "加载中…")}</small></span></>;
  if (!url) return <button type="button" className={`instruction-attachment-link ${urlFailed ? "failed" : "loading"}`} disabled={!urlFailed} onClick={() => { setUrlFailed(false); setUrlAttempt((value) => value + 1); }}>{label}</button>;
  if (!appleMobile) return <a className="instruction-attachment-link" href={url} target="_blank" rel="noreferrer">{label}</a>;

  return <div className="instruction-mobile-attachment">
    <button ref={triggerRef} type="button" className="instruction-attachment-link" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded((value) => !value)}>{label}</button>
    {expanded && <div id={panelId} className="instruction-attachment-options">
      {!file && !failed && <p role="status">{ja ? "書類を読み込んでいます…" : "正在加载文件…"}</p>}
      {failed && <><p role="alert">{ja ? "書類を読み込めませんでした。通信状況を確認して再試行してください。" : "无法加载文件，请检查网络后重试。"}</p><button type="button" className="secondary" onClick={() => setAttempt((value) => value + 1)}>{ja ? "再試行" : "重试"}</button></>}
      {file && <>
        {file.type.startsWith("image/") && <img className="instruction-attachment-preview" src={localUrl} alt={attachment.name} />}
        {canShareAttachment(file) ? <><button ref={actionRef} type="button" className="primary" disabled={sharing} onClick={() => void shareFile()}>{ja ? "書類を開く・保存" : "打开或保存文件"}</button><p>{ja ? "表示されるメニューで、対応アプリまたは「ファイルに保存」を選んでください。" : "请在菜单中选择支持此文件的应用或“存储到文件”。"}</p></> : <p>{ja ? "この環境では書類メニューを利用できません。PCのブラウザで書類を開いてください。" : "当前环境无法使用文件菜单，请在电脑浏览器中打开文件。"}</p>}
        {shareFailed && <p role="alert">{ja ? "メニューを開けませんでした。もう一度「書類を開く・保存」を押してください。" : "无法打开菜单，请再次点击“打开或保存文件”。"}</p>}
      </>}
    </div>}
  </div>;
}
