import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "../../types";
import type { MeetingResume } from "./model";
import { ResumeDocument } from "./ResumeDocument";
import { documentStyle } from "./documentStyle";

export function resumeHtml(resume: MeetingResume, locale: Locale): string {
  if (resume.ai && !resume.ai.reviewed) throw new Error(locale === "ja" ? "要点・図解・議題と根拠を確認してから配布してください。" : "请确认要点、图解、议题及依据后再分发。");
  const title = renderToStaticMarkup(<title>{resume.title}</title>);
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">${title}<style>${documentStyle}</style></head><body>${renderToStaticMarkup(<ResumeDocument resume={resume} locale={locale} />)}</body></html>`;
}
export function printResume(resume: MeetingResume, locale: Locale): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "会議レジュメの印刷";
    frame.style.cssText = "position:fixed;left:-20000px;top:0;width:210mm;height:297mm;border:0";
    let loaded = false;
    const cleanup = () => frame.remove();
    const timeout = window.setTimeout(() => {
      if (!loaded) { cleanup(); reject(new Error("印刷画面の読み込みが完了しませんでした。")); }
    }, 10000);
    frame.onload = () => {
      if (loaded) return;
      loaded = true;
      window.clearTimeout(timeout);
      try {
        if (!frame.contentWindow) throw new Error("印刷画面を開けませんでした。");
        frame.contentWindow.addEventListener("afterprint", cleanup, { once: true });
        frame.contentWindow.focus(); frame.contentWindow.print(); resolve();
      } catch (error) { cleanup(); reject(error); }
    };
    frame.srcdoc = resumeHtml(resume, locale);
    document.body.appendChild(frame);
    // Some mobile browsers do not emit afterprint.
    window.setTimeout(cleanup, 60000);
  });
}
