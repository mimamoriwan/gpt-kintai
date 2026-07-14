import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FileText, Image, Link2, Paperclip, Plus, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { formatDate, todayJst } from "../lib/format";
import { makeLinkAttachment, submitReport, uploadReportFiles } from "../services/api";
import type { Attachment, Category, DailyReport, ReportFields, ReportLanguage } from "../types";

const emptyFields: ReportFields = { category: "", area: "", destinations: "", activities: "", findings: "", nextPlan: "" };

export function ReportPage({ reports, categories, editing, onDone, notify }: {
  reports: DailyReport[];
  categories: Category[];
  editing: DailyReport | null;
  onDone: () => void;
  notify: (type: "success" | "error", message: string) => void;
}) {
  const { profile } = useAuth();
  const { locale, t } = useI18n();
  const [reportDate, setReportDate] = useState(editing?.reportDate || todayJst());
  const [sourceLanguage, setSourceLanguage] = useState<ReportLanguage>(editing?.sourceLanguage || (locale === "zh-CN" ? "zh-CN" : "ja"));
  const [fields, setFields] = useState<ReportFields>(editing ? pickFields(editing) : emptyFields);
  const [attachments, setAttachments] = useState<Attachment[]>(editing?.attachments || []);
  const [files, setFiles] = useState<File[]>([]);
  const [link, setLink] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const existingForDate = useMemo(() => reports.find((item) => item.userId === profile?.uid && item.reportDate === reportDate), [profile?.uid, reportDate, reports]);

  useEffect(() => {
    if (!editing) return;
    setReportDate(editing.reportDate);
    setSourceLanguage(editing.sourceLanguage);
    setFields(pickFields(editing));
    setAttachments(editing.attachments || []);
  }, [editing]);

  function field<K extends keyof ReportFields>(key: K, value: ReportFields[K]) { setFields((current) => ({ ...current, [key]: value })); }
  function addLink() {
    try { setAttachments((current) => [...current, makeLinkAttachment(link)]); setLink(""); }
    catch (error) { notify("error", error instanceof Error ? error.message : t("error")); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    const target = editing || existingForDate || null;
    if (target && !reason.trim()) {
      notify("error", locale === "ja" ? "提出済み日報の修正理由を入力してください。" : "请输入修改已提交日报的原因。");
      return;
    }
    setBusy(true);
    try {
      const reportKey = target?.id || `${profile.uid}_${reportDate}`;
      const uploaded = files.length ? await uploadReportFiles(profile.uid, reportKey, files, attachments) : [];
      const result = await submitReport({
        reportId: target?.id,
        reportDate,
        sourceLanguage,
        fields,
        attachments: [...attachments, ...uploaded],
        correctionReason: target ? reason : undefined
      });
      notify("success", result.translationStatus === "failed" ? (locale === "ja" ? "日報を保存しました。日本語化は後で再実行できます。" : "日报已保存，日语生成可稍后重试。") : t("success"));
      onDone();
    } catch (error) { notify("error", friendlyError(error, t("error"))); }
    finally { setBusy(false); }
  }

  const activeCategories = categories.filter((item) => item.active !== false);
  return (
    <div className="page report-page">
      <div className="page-heading"><div><span className="eyebrow">DAILY WORK REPORT</span><h1>{editing || existingForDate ? t("editSubmitted") : t("dailyReport")}</h1><p>{formatDate(reportDate, locale === "ja" ? "ja-JP" : "zh-CN")}</p></div></div>
      <form className="card report-form" onSubmit={submit}>
        <div className="form-section report-form-header">
          <label><span>{locale === "ja" ? "日付" : "日期"}</span><input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} max={todayJst()} required /></label>
          <fieldset className="segmented-field"><legend>{t("sourceLanguage")}</legend><div><button type="button" className={sourceLanguage === "ja" ? "active" : ""} onClick={() => setSourceLanguage("ja")}>日本語</button><button type="button" className={sourceLanguage === "zh-CN" ? "active" : ""} onClick={() => setSourceLanguage("zh-CN")}>中文</button></div></fieldset>
        </div>
        {sourceLanguage === "zh-CN" && <div className="ai-banner"><Sparkles size={20} /><span><strong>{locale === "ja" ? "提出時にAIが日本語化します" : "提交时由AI生成日语版本"}</strong><small>{locale === "ja" ? "中国語の原文もそのまま保存されます。" : "中文原文也会完整保存。"}</small></span></div>}
        <div className="form-section form-grid two">
          <label><span>{t("category")} <b>*</b></span><select value={fields.category} onChange={(e) => field("category", e.target.value)} required><option value="">—</option>{activeCategories.map((item) => <option key={item.id} value={item.id}>{locale === "ja" ? item.labelJa : item.labelZh}</option>)}</select></label>
          <label><span>{t("area")} <b>*</b></span><input value={fields.area} onChange={(e) => field("area", e.target.value)} placeholder={locale === "ja" ? "例：茨城県 水戸市" : "例：茨城县 水户市"} required /></label>
        </div>
        <div className="form-section form-grid">
          <label><span>{t("destinations")} <b>*</b></span><textarea rows={2} value={fields.destinations} onChange={(e) => field("destinations", e.target.value)} placeholder={locale === "ja" ? "訪問した会社・店舗など（複数可）" : "访问的公司或店铺（可填写多个）"} required /></label>
          <label><span>{t("activities")} <b>*</b></span><textarea rows={5} value={fields.activities} onChange={(e) => field("activities", e.target.value)} placeholder={locale === "ja" ? "今日行った仕事を簡潔に入力" : "请简要填写今天完成的工作"} required /></label>
          <label><span>{t("findings")} <b>*</b></span><textarea rows={4} value={fields.findings} onChange={(e) => field("findings", e.target.value)} placeholder={locale === "ja" ? "商品の特徴、商談結果、市場性など" : "商品特点、洽谈结果、市场潜力等"} required /></label>
          <label><span>{t("nextPlan")}</span><textarea rows={3} value={fields.nextPlan} onChange={(e) => field("nextPlan", e.target.value)} placeholder={locale === "ja" ? "明日以降に行うこと" : "明天以后要做的事"} /></label>
        </div>
        <div className="form-section attachment-section">
          <div className="label-row"><span>{t("attachments")}</span><small>{locale === "ja" ? "最大5件・合計20MB" : "最多5个・合计20MB"}</small></div>
          <input ref={fileRef} hidden type="file" multiple accept="image/jpeg,image/png,application/pdf,.docx,.xlsx" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          <div className="attachment-actions"><button type="button" className="upload-box" onClick={() => fileRef.current?.click()}><UploadCloud size={24} /><span>{t("addFiles")}</span><small>JPG / PNG / PDF / Word / Excel</small></button><div className="link-box"><Link2 size={20} /><input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /><button type="button" onClick={addLink} disabled={!link}><Plus size={18} /></button></div></div>
          {(attachments.length > 0 || files.length > 0) && <div className="attachment-list">{attachments.map((item) => <div key={item.id}>{item.linkUrl ? <Link2 size={18} /> : item.contentType.startsWith("image/") ? <Image size={18} /> : <FileText size={18} />}<span>{item.name}</span><button type="button" onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 size={17} /></button></div>)}{files.map((file, index) => <div key={`${file.name}-${index}`}><Paperclip size={18} /><span>{file.name}</span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button></div>)}</div>}
        </div>
        {(editing || existingForDate) && <div className="form-section"><label><span>{t("correctionReason")} <b>*</b></span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={locale === "ja" ? "例：訪問先名の入力誤りを訂正" : "例：更正访问单位名称"} required /></label><p className="history-note">{locale === "ja" ? "修正前の内容と修正理由は履歴として保存されます。" : "修改前的内容和原因将保存在历史记录中。"}</p></div>}
        <div className="form-footer"><button type="button" className="button ghost" onClick={onDone}>{t("cancel")}</button><button className="button primary large" disabled={busy}>{busy ? t("submitting") : t("saveSubmit")}</button></div>
      </form>
    </div>
  );
}

function pickFields(report: DailyReport): ReportFields {
  return { category: report.category, area: report.area, destinations: report.destinations, activities: report.activities, findings: report.findings, nextPlan: report.nextPlan };
}

function friendlyError(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message.replace(/^FirebaseError:\s*/, "");
  return fallback;
}
