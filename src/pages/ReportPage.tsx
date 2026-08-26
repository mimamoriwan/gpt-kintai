import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarDays, FileText, Image, Link2, MapPinned, Paperclip, Pencil, Plus, Sparkles, Tags, Trash2, WandSparkles, X } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { validateFiles } from "../lib/files";
import { formatDate, formatTime, todayJst } from "../lib/format";
import {
  addWorkLog,
  generateReportDraft,
  makeLinkAttachment,
  removeWorkLog,
  saveWorkTag,
  submitReport,
  updateWorkLog,
  watchWorkLogs,
  watchWorkTags
} from "../services/api";
import type { Attachment, AttendanceRecord, Category, DailyReport, GeneratedReportDraft, ReportFields, ReportLanguage, WorkLogEntry, WorkTag } from "../types";

const emptyFields: ReportFields = { category: "", area: "", destinations: "", activities: "", findings: "", nextPlan: "" };
const defaultTags = [
  { id: "product_discovery", ja: "商品発掘", zh: "商品发掘" },
  { id: "manufacturer_visit", ja: "メーカー訪問", zh: "厂家访问" },
  { id: "market_research", ja: "市場調査", zh: "市场调查" },
  { id: "negotiation", ja: "商談・交渉", zh: "商务洽谈" },
  { id: "product_evaluation", ja: "商品評価", zh: "商品评估" },
  { id: "report_writing", ja: "報告書作成", zh: "报告制作" },
  { id: "internal_work", ja: "社内業務", zh: "公司内部工作" },
  { id: "other", ja: "その他", zh: "其他" }
] as const;

export function ReportPage({ reports, categories, attendance, editing, onDone, notify }: {
  reports: DailyReport[];
  categories: Category[];
  attendance: AttendanceRecord[];
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
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [draftMeta, setDraftMeta] = useState<GeneratedReportDraft["aiMeta"] | null>(null);
  const [memoBusy, setMemoBusy] = useState(false);
  const [hasTravel, setHasTravel] = useState(Boolean(editing?.area || editing?.destinations));
  const [workTags, setWorkTags] = useState<WorkTag[]>([]);
  const [workLogs, setWorkLogs] = useState<WorkLogEntry[]>([]);
  const [selectedTag, setSelectedTag] = useState<string>(defaultTags[0].id);
  const [workMemo, setWorkMemo] = useState("");
  const [workAttachments, setWorkAttachments] = useState<Attachment[]>([]);
  const [workFiles, setWorkFiles] = useState<File[]>([]);
  const [workLink, setWorkLink] = useState("");
  const [newTag, setNewTag] = useState("");
  const [showTagInput, setShowTagInput] = useState(false);
  const [editingWorkLogId, setEditingWorkLogId] = useState<string | null>(null);
  const workMemoRef = useRef<HTMLTextAreaElement>(null);
  const workFileRef = useRef<HTMLInputElement>(null);
  const existingForDate = useMemo(() => reports.find((item) => item.userId === profile?.uid && item.reportDate === reportDate), [profile?.uid, reportDate, reports]);
  const activeReport = editing || existingForDate || null;
  const todayAttendance = useMemo(() => attendance.find((item) => item.userId === profile?.uid && item.workDate === reportDate), [attendance, profile?.uid, reportDate]);

  const availableTags = useMemo(() => {
    const defaults = defaultTags.map((item) => ({ id: item.id, label: sourceLanguage === "zh-CN" ? item.zh : item.ja }));
    const personal = workTags.filter((item) => item.active !== false).map((item) => ({ id: item.id, label: item.label }));
    return [...defaults, ...personal];
  }, [sourceLanguage, workTags]);
  const categoryOptions = useMemo(() => {
    const company = categories.filter((item) => item.active !== false).map((item) => locale === "ja" ? item.labelJa : item.labelZh);
    return Array.from(new Set([...company, ...availableTags.map((item) => item.label)]));
  }, [availableTags, categories, locale]);
  const workLogSignature = useMemo(
    () => workLogs.map((item) => `${item.id}:${item.updatedAt?.toMillis?.() || 0}:${item.attachments?.length || 0}`).join("|"),
    [workLogs]
  );

  useEffect(() => {
    if (!profile) return;
    const unsubscribeTags = watchWorkTags(profile.uid, setWorkTags, (error) => notify("error", error.message));
    const unsubscribeLogs = watchWorkLogs(profile.uid, reportDate, setWorkLogs, (error) => notify("error", error.message));
    return () => { unsubscribeTags(); unsubscribeLogs(); };
  }, [notify, profile, reportDate]);

  useEffect(() => {
    if (!activeReport) return;
    setReportDate(activeReport.reportDate);
    setSourceLanguage(activeReport.sourceLanguage);
    setFields(pickFields(activeReport));
    setAttachments(activeReport.attachments || []);
    setReason("");
    setHasTravel(Boolean(activeReport.area || activeReport.destinations));
  }, [activeReport?.id]);

  useEffect(() => {
    if (!activeReport) setHasTravel(todayAttendance?.workMode === "business_trip");
  }, [activeReport?.id, todayAttendance?.workMode]);

  useEffect(() => {
    setDraftMeta(null);
  }, [hasTravel, reportDate, sourceLanguage, workLogSignature]);

  useEffect(() => {
    resizeTextarea(workMemoRef.current);
  }, [workMemo]);

  useEffect(() => {
    const resize = () => resizeTextarea(workMemoRef.current);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function resetWorkLogComposer() {
    setEditingWorkLogId(null);
    setWorkMemo("");
    setWorkAttachments([]);
    setWorkFiles([]);
    setWorkLink("");
    if (workFileRef.current) workFileRef.current.value = "";
  }

  function changeReportDate(nextDate: string) {
    setReportDate(nextDate);
    // A submitted report keeps its contents when its date itself is corrected.
    if (editing) return;
    const nextReport = reports.find((item) => item.userId === profile?.uid && item.reportDate === nextDate);
    if (nextReport) return; // The report hydration effect loads this date after rendering.
    setFields(emptyFields);
    setAttachments([]);
    setReason("");
    resetWorkLogComposer();
    const nextAttendance = attendance.find((item) => item.userId === profile?.uid && item.workDate === nextDate);
    setHasTravel(nextAttendance?.workMode === "business_trip");
  }

  function field<K extends keyof ReportFields>(key: K, value: ReportFields[K]) { setFields((current) => ({ ...current, [key]: value })); }
  function addWorkLink() {
    try {
      const next = [...workAttachments, makeLinkAttachment(workLink)];
      const validation = validateFiles(workFiles, next);
      if (validation) throw new Error(validation);
      setWorkAttachments(next);
      setWorkLink("");
    }
    catch (error) { notify("error", error instanceof Error ? error.message : t("error")); }
  }

  function selectWorkFiles(nextFiles: File[]) {
    const knownFiles = new Set(workFiles.map(fileIdentity));
    const uniqueNextFiles = nextFiles.filter((file) => {
      const identity = fileIdentity(file);
      if (knownFiles.has(identity)) return false;
      knownFiles.add(identity);
      return true;
    });
    const combinedFiles = [...workFiles, ...uniqueNextFiles];
    const validation = validateFiles(combinedFiles, workAttachments);
    if (validation) {
      notify("error", validation);
      if (workFileRef.current) workFileRef.current.value = "";
      return;
    }
    setWorkFiles(combinedFiles);
    if (workFileRef.current) workFileRef.current.value = "";
  }

  function editWorkLog(item: WorkLogEntry) {
    const matchingTag = availableTags.find((tag) => tag.id === item.tagId)
      || availableTags.find((tag) => tag.label === item.tagLabel);
    setEditingWorkLogId(item.id);
    setSelectedTag(matchingTag?.id || availableTags[0]?.id || defaultTags[0].id);
    setWorkMemo(item.text);
    setWorkAttachments(item.attachments || []);
    setWorkFiles([]);
    setWorkLink("");
    window.requestAnimationFrame(() => {
      document.getElementById("work-memo-input")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      workMemoRef.current?.focus();
    });
  }

  async function deleteWorkLog(id: string) {
    try {
      await removeWorkLog(id);
      if (editingWorkLogId === id) resetWorkLogComposer();
      setDraftMeta(null);
    } catch (error) {
      notify("error", friendlyError(error, t("error")));
    }
  }

  async function addMemo() {
    if (!profile || !workMemo.trim()) return;
    const tag = availableTags.find((item) => item.id === selectedTag) || availableTags[0];
    setMemoBusy(true);
    try {
      if (editingWorkLogId) {
        await updateWorkLog(
          editingWorkLogId,
          { tagId: tag.id, tagLabel: tag.label, text: workMemo },
          profile,
          workFiles,
          workAttachments
        );
        notify("success", locale === "ja" ? "追加済みの報告を更新しました。" : "已更新添加的报告。");
      } else {
        await addWorkLog(
          { userId: profile.uid, workDate: reportDate, tagId: tag.id, tagLabel: tag.label, text: workMemo, isDemo: profile.isDemo, demoDatasetId: profile.demoDatasetId, seedVersion: profile.seedVersion },
          profile,
          workFiles,
          workAttachments
        );
      }
      resetWorkLogComposer();
      setDraftMeta(null);
      if (!fields.category) field("category", tag.label);
    } catch (error) { notify("error", friendlyError(error, t("error"))); }
    finally { setMemoBusy(false); }
  }

  async function addPersonalTag() {
    if (!profile || !newTag.trim()) return;
    try {
      const id = await saveWorkTag(profile.uid, newTag, Date.now(), profile);
      setSelectedTag(id);
      setNewTag("");
      setShowTagInput(false);
      notify("success", locale === "ja" ? "個人タグを追加しました。" : "已添加个人标签。");
    } catch (error) { notify("error", friendlyError(error, t("error"))); }
  }

  async function buildDraft() {
    if (!workLogs.length) {
      notify("error", locale === "ja" ? "先に今日行った業務を1件以上追加してください。" : "请先添加至少一条今天的工作记录。");
      return;
    }
    setAiBusy(true);
    try {
      const draft = await generateReportDraft(reportDate, sourceLanguage, hasTravel);
      setFields({ category: draft.category, area: draft.area, destinations: draft.destinations, activities: draft.activities, findings: draft.findings, nextPlan: draft.nextPlan });
      setDraftMeta(draft.aiMeta);
      const linkNote = draft.aiMeta.skippedLinkCount > 0
        ? (locale === "ja" ? ` URLリンク${draft.aiMeta.skippedLinkCount}件は自動解析していません。` : ` 未自动分析${draft.aiMeta.skippedLinkCount}个URL链接。`)
        : "";
      if (draft.aiMeta.cached) {
        notify("success", locale === "ja"
          ? `同じ入力内容の保存済み下書きを表示しました（API再実行なし）。${linkNote}`
          : `已显示相同输入内容的已保存草稿（未再次调用API）。${linkNote}`);
      } else {
        notify("success", locale === "ja"
          ? `メモとAIへ送信した添付資料${draft.aiMeta.analyzedAttachmentCount}件から下書きを作成しました。${linkNote}`
          : `已根据备忘和发送给AI的${draft.aiMeta.analyzedAttachmentCount}个附件生成草稿。${linkNote}`);
      }
      document.getElementById("report-details")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) { notify("error", friendlyError(error, locale === "ja" ? "AIで下書きを作成できませんでした。手入力で提出できます。" : "AI无法生成草稿，您仍可手动填写提交。")); }
    finally { setAiBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    const target = activeReport;
    if (target && !reason.trim()) {
      notify("error", locale === "ja" ? "提出済み日報の修正理由を入力してください。" : "请输入修改已提交日报的原因。");
      return;
    }
    setBusy(true);
    try {
      const normalizedFields = hasTravel ? fields : { ...fields, area: "", destinations: "" };
      const result = await submitReport({ reportId: target?.id, reportDate, sourceLanguage, fields: normalizedFields, attachments, correctionReason: target ? reason : undefined });
      notify("success", result.translationStatus === "failed" ? (locale === "ja" ? "日報を保存しました。日本語化は後で再実行できます。" : "日报已保存，日语生成可稍后重试。") : t("success"));
      onDone();
    } catch (error) { notify("error", friendlyError(error, t("error"))); }
    finally { setBusy(false); }
  }

  return (
    <div className="page report-page">
      <div className="page-heading"><div><span className="eyebrow">DAILY WORK REPORT</span><h1>{activeReport ? t("editSubmitted") : t("dailyReport")}</h1><p>{locale === "ja" ? "記録する日を最初に選んでください" : "请先选择要记录的日期"}</p></div></div>
      <section className="card report-date-card">
        <label>
          <span><CalendarDays size={18} />{locale === "ja" ? "日報の日付" : "日报日期"}</span>
          <input type="date" value={reportDate} onChange={(e) => changeReportDate(e.target.value)} max={todayJst()} required />
        </label>
        <div>
          <strong>{formatDate(reportDate, locale === "ja" ? "ja-JP" : "zh-CN")}</strong>
          {activeReport && <span className="status-chip amber">{locale === "ja" ? "提出済み・修正中" : "已提交・修改中"}</span>}
        </div>
      </section>
      <section className="card work-log-card">
        <div className="work-log-heading"><span><Tags size={20} /><strong>{locale === "ja" ? "今日の業務メモ" : "今天的工作记录"}</strong></span><small>{locale === "ja" ? "仕事のたびに短く追加できます" : "每完成一项工作即可简短记录"}</small></div>
        <div className="work-tag-list">
          {availableTags.map((tag) => <button type="button" key={tag.id} className={selectedTag === tag.id ? "active" : ""} onClick={() => setSelectedTag(tag.id)}>{tag.label}</button>)}
          <button type="button" className="add-tag" onClick={() => setShowTagInput((value) => !value)}><Plus size={15} />{locale === "ja" ? "個人タグ" : "个人标签"}</button>
        </div>
        {showTagInput && <div className="new-tag-row"><input value={newTag} onChange={(e) => setNewTag(e.target.value)} maxLength={40} placeholder={locale === "ja" ? "例：食品卸、資料整理" : "例：食品批发、资料整理"} /><button type="button" className="button secondary" onClick={() => void addPersonalTag()} disabled={!newTag.trim()}>{t("save")}</button></div>}
        {editingWorkLogId && <div className="work-log-editing-notice"><span><Pencil size={16} />{locale === "ja" ? "追加済みの報告を編集中です" : "正在编辑已添加的报告"}</span><button type="button" onClick={resetWorkLogComposer}><X size={15} />{t("cancel")}</button></div>}
        <div className="work-memo-row"><textarea ref={workMemoRef} id="work-memo-input" rows={3} value={workMemo} onChange={(e) => setWorkMemo(e.target.value)} maxLength={1200} placeholder={locale === "ja" ? "今行った仕事を短く入力（複数行可）" : "简短填写刚完成的工作（可多行）"} /></div>
        <div className="work-log-attachment-picker">
          <div className="work-log-attachment-actions">
            <input ref={workFileRef} hidden type="file" multiple accept="image/jpeg,image/png,application/pdf,.docx,.xlsx" onChange={(event) => selectWorkFiles(Array.from(event.target.files || []))} />
            <button type="button" className="work-log-file-button" onClick={() => workFileRef.current?.click()}><Paperclip size={18} />{locale === "ja" ? "この報告に書類を添付" : "为此报告添加文件"}</button>
            <div className="work-log-link-box"><Link2 size={17} /><input type="url" value={workLink} onChange={(event) => setWorkLink(event.target.value)} placeholder="https://" /><button type="button" onClick={addWorkLink} disabled={!workLink}><Plus size={16} /></button></div>
          </div>
          {(workAttachments.length > 0 || workFiles.length > 0) && <AttachmentList attachments={workAttachments} files={workFiles} onRemoveAttachment={(id) => setWorkAttachments((current) => current.filter((item) => item.id !== id))} onRemoveFile={(index) => setWorkFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} />}
          <small>{locale === "ja" ? "選んだ資料は、上の入力内容と一緒に1件の業務報告として保存されます（最大5件・合計20MB）。" : "所选资料将与上方内容一起保存为一条工作报告（最多5个・合计20MB）。"}</small>
        </div>
        <div className="work-log-submit-row">{editingWorkLogId && <button type="button" className="button ghost" onClick={resetWorkLogComposer} disabled={memoBusy}>{t("cancel")}</button>}<button type="button" className="button primary work-log-add-button" onClick={() => void addMemo()} disabled={memoBusy || !workMemo.trim()}>{editingWorkLogId ? <Pencil size={17} /> : <Plus size={18} />}{memoBusy ? (locale === "ja" ? "保存中…" : "保存中…") : editingWorkLogId ? (locale === "ja" ? "変更を保存" : "保存修改") : (locale === "ja" ? "報告を追加" : "添加报告")}</button></div>
        {workLogs.length > 0 && <div className="work-log-list">{workLogs.map((item) => <div className={`work-log-entry${editingWorkLogId === item.id ? " editing" : ""}`} key={item.id}><span className="tag soft">{item.tagLabel}</span><div className="work-log-content"><p>{item.text}</p>{Boolean(item.attachments?.length) && <div className="work-log-saved-attachments">{item.attachments?.map((attachment) => <a key={attachment.id} href={attachment.linkUrl || attachment.downloadUrl} target="_blank" rel="noreferrer">{attachment.linkUrl ? <Link2 size={14} /> : <Paperclip size={14} />}{attachment.name}</a>)}</div>}</div><time>{formatTime(item.createdAt)}</time><div className="work-log-entry-actions"><button className="work-log-edit" type="button" aria-label={locale === "ja" ? "編集" : "编辑"} onClick={() => editWorkLog(item)}><Pencil size={16} /></button><button className="work-log-delete" type="button" aria-label={locale === "ja" ? "削除" : "删除"} onClick={() => void deleteWorkLog(item.id)}><Trash2 size={16} /></button></div></div>)}</div>}
        <button type="button" className="button ai-draft-button" onClick={() => void buildDraft()} disabled={aiBusy || !workLogs.length}><WandSparkles size={19} />{aiBusy ? (locale === "ja" ? "下書きを作成中…" : "正在生成草稿…") : (locale === "ja" ? "AIでメモ・添付から日報を作成" : "用AI根据备忘和附件生成日报")}</button>
        {draftMeta && <div className="ai-draft-result" role="status"><strong>{draftMeta.cached ? (locale === "ja" ? "保存済み下書きを再利用" : "已复用保存的草稿") : (locale === "ja" ? "AIで新しい下書きを作成" : "AI已生成新草稿")}</strong><span>{locale === "ja" ? `AIへ送信した添付資料：${draftMeta.analyzedAttachmentCount}件${draftMeta.skippedLinkCount ? `／未解析URL：${draftMeta.skippedLinkCount}件` : ""}` : `发送给AI的附件：${draftMeta.analyzedAttachmentCount}个${draftMeta.skippedLinkCount ? `／未分析URL：${draftMeta.skippedLinkCount}个` : ""}`}</span>{Boolean(draftMeta.analyzedAttachmentNames?.length) && <small>{locale === "ja" ? "送信済み：" : "已发送："}{draftMeta.analyzedAttachmentNames?.join("、")}</small>}</div>}
        <p className="ai-privacy-note">{locale === "ja" ? "このボタンを押すと、タグ・業務メモ・保存した添付ファイルをOpenAI APIへ送信して下書きを作ります。URLリンクは自動解析しません。生成した下書きは再利用のため保存し、同じ内容ではAPIを再実行しません。現在、生成回数の上限は設けていません。" : "点击此按钮后，会把标签、工作备忘和已保存的附件发送到OpenAI API以生成草稿。不会自动分析URL链接。生成的草稿会保存以便复用，相同内容不会再次调用API。目前不限制生成次数。"}</p>
      </section>

      <form className="card report-form" onSubmit={submit} id="report-details">
        <div className="form-section report-form-header language-only">
          <fieldset className="segmented-field"><legend>{t("sourceLanguage")}</legend><div><button type="button" className={sourceLanguage === "ja" ? "active" : ""} onClick={() => setSourceLanguage("ja")}>日本語</button><button type="button" className={sourceLanguage === "zh-CN" ? "active" : ""} onClick={() => setSourceLanguage("zh-CN")}>中文</button></div></fieldset>
        </div>
        {sourceLanguage === "zh-CN" && <div className="ai-banner"><Sparkles size={20} /><span><strong>{locale === "ja" ? "提出時にAIが日本語化します" : "提交时由AI生成日语版本"}</strong><small>{locale === "ja" ? "中国語の原文もそのまま保存されます。" : "中文原文也会完整保存。"}</small></span></div>}
        <div className="form-section form-grid">
          <label><span>{t("category")} <b>*</b></span><input list="report-categories" value={fields.category} onChange={(e) => field("category", e.target.value)} placeholder={locale === "ja" ? "選択または入力" : "选择或输入"} required /><datalist id="report-categories">{categoryOptions.map((label) => <option key={label} value={label} />)}</datalist></label>
          <label className="travel-toggle"><input type="checkbox" checked={hasTravel} onChange={(e) => setHasTravel(e.target.checked)} /><span><MapPinned size={18} />{locale === "ja" ? "訪問・出張・外回りがありました" : "今天有访问、出差或外勤"}</span></label>
        </div>
        {hasTravel && <div className="form-section form-grid two travel-fields"><label><span>{t("area")}</span><input value={fields.area} onChange={(e) => field("area", e.target.value)} placeholder={locale === "ja" ? "例：茨城県 水戸市" : "例：茨城县 水户市"} /></label><label><span>{t("destinations")}</span><textarea rows={2} value={fields.destinations} onChange={(e) => field("destinations", e.target.value)} placeholder={locale === "ja" ? "訪問した会社・店舗など（複数可）" : "访问的公司或店铺（可填写多个）"} /></label></div>}
        <div className="form-section form-grid">
          <label><span>{t("activities")} <b>*</b></span><textarea rows={6} value={fields.activities} onChange={(e) => field("activities", e.target.value)} placeholder={locale === "ja" ? "AI下書きを確認・修正するか、手入力してください" : "请确认并修改AI草稿，或手动填写"} required /></label>
          <label><span>{t("findings")} <small>{locale === "ja" ? "（任意）" : "（选填）"}</small></span><textarea rows={4} value={fields.findings} onChange={(e) => field("findings", e.target.value)} placeholder={locale === "ja" ? "商品の特徴、商談結果、市場性など" : "商品特点、洽谈结果、市场潜力等"} /></label>
          <label><span>{t("nextPlan")} <small>{locale === "ja" ? "（任意）" : "（选填）"}</small></span><textarea rows={3} value={fields.nextPlan} onChange={(e) => field("nextPlan", e.target.value)} placeholder={locale === "ja" ? "業務メモに予定があればAIが抽出します" : "工作记录中如有计划，AI会自动提取"} /></label>
        </div>
        {attachments.length > 0 && <div className="form-section legacy-report-attachments"><div className="label-row"><span>{locale === "ja" ? "以前の日報全体に添付された資料" : "以前附加到整份日报的资料"}</span><small>{locale === "ja" ? "既存資料を保持しています" : "保留已有资料"}</small></div><div className="attachment-list">{attachments.map((item) => <div key={item.id}>{item.linkUrl ? <Link2 size={18} /> : item.contentType.startsWith("image/") ? <Image size={18} /> : <FileText size={18} />}<a href={item.linkUrl || item.downloadUrl} target="_blank" rel="noreferrer">{item.name}</a><button type="button" onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 size={17} /></button></div>)}</div><p className="storage-note">{locale === "ja" ? "今後の資料は、上の各業務報告に添付してください。" : "今后的资料请附加到上方各条工作报告中。"}</p></div>}
        {activeReport && <div className="form-section"><label><span>{t("correctionReason")} <b>*</b></span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={locale === "ja" ? "例：訪問先名の入力誤りを訂正" : "例：更正访问单位名称"} required /></label><p className="history-note">{locale === "ja" ? "修正前の内容と修正理由は履歴として保存されます。" : "修改前的内容和原因将保存在历史记录中。"}</p></div>}
        <div className="form-footer"><button type="button" className="button ghost" onClick={onDone}>{t("cancel")}</button><button className="button primary large" disabled={busy}>{busy ? t("submitting") : t("saveSubmit")}</button></div>
      </form>
    </div>
  );
}

function AttachmentList({ attachments, files, onRemoveAttachment, onRemoveFile }: {
  attachments: Attachment[];
  files: File[];
  onRemoveAttachment: (id: string) => void;
  onRemoveFile: (index: number) => void;
}) {
  return <div className="attachment-list">{attachments.map((item) => <div key={item.id}>{item.linkUrl ? <Link2 size={18} /> : item.contentType.startsWith("image/") ? <Image size={18} /> : <FileText size={18} />}{item.linkUrl || item.downloadUrl ? <a href={item.linkUrl || item.downloadUrl} target="_blank" rel="noreferrer">{item.name}</a> : <span>{item.name}</span>}<button type="button" onClick={() => onRemoveAttachment(item.id)}><Trash2 size={17} /></button></div>)}{files.map((file, index) => <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`}><Paperclip size={18} /><span>{file.name}</span><button type="button" onClick={() => onRemoveFile(index)}><Trash2 size={17} /></button></div>)}</div>;
}

function resizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function fileIdentity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function pickFields(report: DailyReport): ReportFields {
  return { category: report.category, area: report.area || "", destinations: report.destinations || "", activities: report.activities, findings: report.findings || "", nextPlan: report.nextPlan || "" };
}

function friendlyError(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message.replace(/^FirebaseError:\s*/, "");
  return fallback;
}
