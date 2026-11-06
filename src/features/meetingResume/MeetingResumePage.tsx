import { useEffect, useRef, useState } from "react";
import { Download, FileText, Printer, Sparkles } from "lucide-react";
import { useI18n } from "../../i18n";
import { todayJst } from "../../lib/format";
import { warnBeforeLeaving } from "../../pwaUpdate";
import { reportPeriodError } from "../../lib/reportPeriod";
import type { DailyReport, UserProfile, WeeklyReport } from "../../types";
import { buildResume, hasLegacyClipping, MAX_RESUME_DRAFT_BYTES, MAX_RESUME_TEXT_LENGTH, parseResumeDraft, serializeResumeDraft, sourceReports, type MeetingResume, type ResumeTheme } from "./model";
import { ResumeDocument } from "./ResumeDocument";
import { documentStyle } from "./documentStyle";
import { downloadResume } from "./download";
import { generateMeetingResume } from "./api";
import { resumeFromAi, type GenerateProgress, type SourceSelection } from "./aiModel";
import "./meetingResume.css";

interface Props { allowed: boolean; profile: UserProfile; reports: DailyReport[]; users: UserProfile[]; monthlyReports: WeeklyReport[] }
export function MeetingResumePage(props: Props) {
  // Recheck the verified owner capability at the page boundary as well as navigation.
  if (!props.allowed || !props.profile.active || props.profile.isDemo || props.profile.role !== "employee_manager") return null;
  return <ResumeEditor key={props.profile.uid} {...props} />;
}
function ResumeEditor({ profile, reports, users, monthlyReports }: Props) {
  const { locale } = useI18n();
  const l = (ja: string, zh: string) => locale === "ja" ? ja : zh;
  const [from, setFrom] = useState(`${todayJst().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayJst());
  const [userId, setUserId] = useState(profile.uid);
  const [draft, setDraft] = useState<MeetingResume | null>(null);
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const [selection, setSelection] = useState<SourceSelection>({ daily: true, business: import.meta.env.VITE_BUSINESS_FEATURE_ENABLED === "true", todo: true });
  const controller = useRef<AbortController | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const error = reportPeriodError(from, to, locale === "zh-CN");
  const rows = sourceReports(reports, userId, from, to);
  const saved = monthlyReports.filter(r => r.reportKind === "monthly" && r.userId === userId && r.periodStart === from && r.periodEnd === to && !r.isDemo).sort((a, b) => b.revision - a.revision)[0];
  const members = [...new Map([profile, ...users.filter(u => !u.isDemo), ...reports.filter(r => !r.isDemo).map(r => ({ uid: r.userId, displayName: r.userName }))].map(u => [u.uid, u])).values()];
  const mismatched = draft && (draft.from !== from || draft.to !== to || draft.userId !== userId || (draft.ai && JSON.stringify(draft.ai.sourceSelection) !== JSON.stringify(selection)));
  const sourceChanged = draft && !draft.ai && !mismatched && (draft.sources.length !== rows.length || draft.sources.some(s => {
    const r = rows.find(row => row.id === s.id);
    return !r || s.activities !== (draft.locale === "ja" ? r.translatedFields?.activities?.trim() || r.activities.trim() : r.activities.trim()) || s.findings !== (draft.locale === "ja" ? r.translatedFields?.findings?.trim() || r.findings?.trim() || "" : r.findings?.trim() || "") || s.nextPlan !== (draft.locale === "ja" ? r.translatedFields?.nextPlan?.trim() || r.nextPlan?.trim() || "" : r.nextPlan?.trim() || "");
  }));
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => warnBeforeLeaving(event, dirty, busy);
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty, busy]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))), 1_000);
    return () => clearInterval(timer);
  }, [busy]);
  function replaceOk() { return !draft || !dirty || window.confirm(l("現在の編集内容を置き換えます。必要なら先に下書きを保存してください。", "将替换当前编辑内容，请先保存需要保留的草稿。")); }
  function create(monthly?: WeeklyReport) {
    if (!replaceOk()) return;
    try { setDraft(buildResume({ reports, userId, from, to, owner: profile, locale, createdDate: todayJst(), monthly })); setDirty(true); setMessage(""); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
  }
  async function createAi() {
    if (busy || !replaceOk()) return;
    const active = new AbortController(); controller.current = active;
    setElapsedSeconds(0); setBusy(true); setProgress({ stage: "collecting" }); setMessage("");
    try {
      const input = { periodStart: from, periodEnd: to, userId, locale, sources: selection };
      const result = await generateMeetingResume(input, event => { if (!active.signal.aborted) setProgress(event); }, active.signal);
      if (active.signal.aborted) return;
      if (result.input.periodStart !== input.periodStart || result.input.periodEnd !== input.periodEnd || result.input.userId !== input.userId || result.input.locale !== input.locale || (Object.keys(selection) as (keyof SourceSelection)[]).some(key => result.input.sources[key] !== selection[key])) throw new Error(l("作成結果の対象条件が一致しません。現在の資料は保持しています。再作成してください。", "创建结果的对象条件不一致，已保留当前资料，请重试。"));
      const subject = userId ? members.find(u => u.uid === userId)?.displayName || userId : l("会社全体", "全公司");
      const value = resumeFromAi(result, profile, subject, todayJst());
      // Apply the same bounded validation as a saved draft before accepting a server result.
      setDraft(parseResumeDraft(serializeResumeDraft(value), profile.uid)); setDirty(true);
    } catch (e) {
      if (!active.signal.aborted) setMessage(e instanceof Error ? e.message : l("AI整理に失敗しました。現在の資料は保持しています。", "AI整理失败，已保留当前资料。"));
    } finally { if (controller.current === active) { setBusy(false); setProgress(null); controller.current = null; } }
  }
  function change(patch: Partial<MeetingResume>) { setDraft(draft ? { ...draft, ...patch, ...(draft.ai ? { ai: { ...draft.ai, ...patch.ai, reviewed: false } } : {}) } : null); setDirty(true); }
  function theme(index: number, patch: Partial<ResumeTheme>) { if (draft) change({ themes: draft.themes.map((t, i) => i === index ? { ...t, ...patch } : t) }); }
  async function restore(selected?: File) {
    if (!selected || !replaceOk()) return;
    try {
      if (selected.size > MAX_RESUME_DRAFT_BYTES) throw new Error(l("下書きファイルは20MB以内にしてください。", "草稿文件请小于20MB。"));
      const value = parseResumeDraft(await selected.text(), profile.uid);
      setDraft(value); setFrom(value.from); setTo(value.to); setUserId(value.userId); if (value.ai) setSelection(value.ai.sourceSelection); setDirty(false); setMessage("");
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
  }
  const clipped = draft ? hasLegacyClipping(draft) : false;
  const hasThemes = !!draft?.themes.some(t => t.included);
  return <div className="page meeting-resume-page">
    <div className="page-heading"><div><span className="eyebrow">MEETING BRIEF</span><h1>{l("会議レジュメ", "会议简报")}</h1><p>{l("今月の進展と、次の判断が伝わる会議資料に。", "创建清晰传达本月进展与后续判断的会议资料。")}</p></div><span className="tag soft">{l("本人専用", "仅本人可用")}</span></div>
    <section className="card mr-controls"><h2>{l("1. 対象を選ぶ", "1. 选择对象")}</h2><fieldset disabled={busy} className="mr-fieldset"><div className="mr-form-grid"><label>{l("開始日", "开始日期")}<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>{l("終了日", "结束日期")}<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label><label>{l("対象者", "对象")}<select value={userId} onChange={e => setUserId(e.target.value)}>{members.map(u => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}<option value="">{l("会社全体（全員）", "全公司（全员）")}</option></select></label></div>
      <div className="mr-source-choices">{([ ["daily", l("提出済み日報", "已提交日报")], ["business", l("会社の取り組みの投稿・変更履歴", "公司举措帖子与变更历史")], ["todo", l("共有済みTo Do・振り返り", "已共享待办与复盘")] ] as const).map(([key, label]) => <label className="mr-checkbox" key={key}><input type="checkbox" checked={selection[key]} onChange={e => setSelection({ ...selection, [key]: e.target.checked })} />{label}</label>)}</div>
      {error ? <p role="alert">{error}</p> : <p>{l(`提出済み日報 ${rows.length} 件。本人確認前の仮作成日報・デモは含みません。`, `已提交日报 ${rows.length} 份，不含待本人确认的临时日报和演示数据。`)}</p>}
      <div className="mr-actions"><button className="button primary" disabled={!!error || !Object.values(selection).some(Boolean)} onClick={() => void createAi()}><Sparkles size={17} />{l("AIで会議資料を作成", "使用AI创建会议资料")}</button><input ref={file} hidden type="file" accept=".json,application/json" onChange={e => { void restore(e.target.files?.[0]); e.target.value = ""; }} /><button className="button ghost" onClick={() => file.current?.click()}>{l("下書きを読み込む", "载入草稿")}</button></div>
      <p className="mr-help">{l("選択した記録をAIへ送り、全件の読み取り・テーマの再構成・原記録との照合を行います。日報がなくても共有記録から作成できます。未共有の下書きは送りません。予定と実績を区別し、根拠番号付きの文章・時系列・進捗を作成します。件数や文字量によって時間がかかります。", "将所选记录发送给AI，逐项阅读、重组主题并核对原记录。无日报也可根据共享记录创建，不发送未共享草稿。区分计划与实绩，生成带依据编号的文字、时间线和进度图。耗时取决于记录数量与文字量。")}</p>
      <details className="mr-legacy"><summary>{l("以前の作成方法（AI整理なし）", "原有创建方式（无AI整理）")}</summary><div className="mr-actions"><button className="button secondary" disabled={!!error || !rows.length} onClick={() => create()}><FileText size={17} />{l("日報からたたき台を作成", "从日报创建初稿")}</button>{saved && <button className="button secondary" disabled={!!error || !rows.length} onClick={() => create(saved)}>{l("保存済み月次レポートから作成", "从已保存月报创建")}</button>}</div><p className="mr-help">{l("全文をカテゴリ別に取り込む方法です。AIによる再整理は行いません。", "按分类导入全文，不使用AI重组内容。")}</p></details>
      </fieldset>
      {busy && <div className="mr-generation" role="status" aria-live="polite"><b>{l("会議資料を作成しています", "正在创建会议资料")}</b><ol>{[l("記録を取得", "获取记录"), l("全件を読み取り", "逐项阅读"), l("テーマ・図解を構成", "构建主题与图解"), l("原記録と照合", "核对原记录")].map((label, i) => { const step = progress?.stage === "collecting" ? 0 : progress?.stage === "reading" ? 1 : ["composing", "repairing"].includes(progress?.stage || "") ? 2 : 3; return <li className={step === i ? "active" : step > i ? "done" : ""} key={i}>{label}</li>; })}</ol><p>{progress?.stage === "reading" ? l(`読み取り ${progress.current} / ${progress.total}（対象 ${progress.count} 件）`, `阅读 ${progress.current} / ${progress.total}（共 ${progress.count} 项）`) : progress?.stage === "repairing" ? l("照合で見つかった点を修正しています。", "正在修正核对发现的问题。") : l("完了後に現在の資料を置き換えます。", "完成后替换当前资料。")}</p><p>{l("関連する記録の整理・図解・照合には、記録量により数分かかることがあります。完了までこの画面を開いてお待ちください。", "整理相关记录、制作图解及核对可能需要数分钟，具体取决于记录量。请保持此页面打开直至完成。")}</p><p role="timer" aria-live="off">{l(`経過 ${Math.floor(elapsedSeconds / 60)}分${String(elapsedSeconds % 60).padStart(2, "0")}秒`, `已用时 ${Math.floor(elapsedSeconds / 60)}分${String(elapsedSeconds % 60).padStart(2, "0")}秒`)}</p><button className="button ghost" onClick={() => controller.current?.abort()}>{l("作成を中止", "停止创建")}</button></div>}
    </section>
    {message && <p role="alert" className="mr-error">{message}</p>}
    {draft && <>
      {draft.ai && <p className="mr-help">{l(`GPT-6.1 Solで全 ${draft.sources.length} 件を読み取り・整理。本文の根拠として個別に使わなかった記録 ${draft.ai.notFeatured.length} 件も確認できます。要点は対象全体、テーマ本文・図解は掲載選択を反映します。`, `GPT-6.1 Sol已逐项阅读整理 ${draft.sources.length} 项记录，可查看未在正文单列的 ${draft.ai.notFeatured.length} 项记录。要点覆盖全部对象，主题正文和图解反映刊载选择。`)}</p>}
      {(draft.textVersion !== 2 || clipped) && <p className="mr-warning" role="alert">{l("以前の作成方式による省略が残っている可能性があります。要点・実施内容・報告・次の対応を確認してください。「日報からたたき台を作成」で同じ期間を作り直すと全文を取り込めます。編集内容を残す場合は先に下書きを保存してください。", "旧版生成方式可能遗留省略内容。请检查要点、实施内容、报告及后续行动。使用相同期间点击从日报创建初稿即可导入全文。如需保留编辑，请先保存草稿。")}</p>}
      {clipped && <p className="mr-error" role="alert">{l("元の日報を途中で切った文章が残っているため、印刷・配布用HTMLの保存を停止しています。全文で再作成するか、該当の文章を最後まで修正してください。", "检测到从原日报截断的文字，已暂停打印和分发HTML保存。请重新生成全文或将相关文字修改完整。")}</p>}
      {(mismatched || sourceChanged) && <p className="mr-warning" role="status">{mismatched ? l("対象条件が変わりました。プレビューは前回作成した資料です。新しい条件を反映するには作成ボタンを押してください。", "对象条件已更改。预览仍为上次资料，点击创建按钮应用新条件。") : l("参照日報に更新があります。現在の資料は作成時点の内容です。必要に応じて再作成してください。", "参考日报已更新。当前资料保留创建时内容，需要时请重新创建。")}</p>}
      <fieldset className="mr-fieldset" disabled={busy}><section className="card mr-controls"><h2>{l("2. 要点を整える", "2. 编辑要点")}</h2><div className="mr-form-grid"><label>{l("資料タイトル", "资料标题")}<input value={draft.title} maxLength={200} onChange={e => change({ title: e.target.value })} /></label><label>{l("対象・作成者の表示", "对象与创建者显示")}<input value={draft.subject} maxLength={200} onChange={e => change({ subject: e.target.value })} /></label></div>{draft.ai && <label>{l("全体の結論", "整体结论")}<input value={draft.ai.headline} maxLength={160} onChange={e => change({ ai: { ...draft.ai!, headline: e.target.value } })} /></label>}<label>{l("今回の要点（1行に1項目）", "本期要点（每行一项）")}<textarea rows={4} maxLength={MAX_RESUME_TEXT_LENGTH} value={draft.summary} onChange={e => change({ summary: e.target.value })} /></label>
        <div className="mr-edit-themes">{draft.themes.map((t, i) => <details key={`${t.id}-${i}`}><summary><input type="checkbox" aria-label={l(`テーマ${i + 1}を掲載`, `刊载主题${i + 1}`)} checked={t.included} onClick={e => e.stopPropagation()} onChange={e => theme(i, { included: e.target.checked })} />{t.title || l("名称未設定", "未命名")}</summary><label>{l("テーマ名", "主题名称")}<input value={t.title} maxLength={200} onChange={e => theme(i, { title: e.target.value })} /></label>{t.purpose !== undefined && <label>{l("目的・位置づけ", "目的与定位")}<textarea value={t.purpose} rows={2} maxLength={MAX_RESUME_TEXT_LENGTH} onChange={e => theme(i, { purpose: e.target.value })} /></label>}{([["activities", l("実施内容", "实施内容")], ["findings", l("報告・進展", "报告与进展")], ["issues", l("課題", "课题")], ["nextAction", l("次の対応", "后续行动")]] as const).map(([key, label]) => <label key={key}>{label}<textarea rows={3} maxLength={MAX_RESUME_TEXT_LENGTH} value={t[key]} onChange={e => theme(i, { [key]: e.target.value })} /></label>)}<p className="mr-help">{l("参照", "参考")}：{t.references.join(" / ")}</p></details>)}</div>
        {draft.ai && draft.ai.decisions.map((decision, i) => <details className="mr-decision-editor" key={i}><summary>{l("会議で決めたいこと", "会议待决定事项")} {i + 1}：{decision.title}</summary>{([["title", l("議題", "议题")], ["question", l("確認したいこと", "待确认事项")], ["reason", l("判断が必要な理由", "判断原因")], ["proposal", l("検討案（未決定）", "讨论方案（尚未决定）")]] as const).map(([key, label]) => <label key={key}>{label}<textarea rows={2} maxLength={2400} value={decision[key]} onChange={e => change({ ai: { ...draft.ai!, decisions: draft.ai!.decisions.map((d, j) => j === i ? { ...d, [key]: e.target.value } : d) } })} /></label>)}</details>)}<label>{l("会議で確認・相談したいこと", "会议确认与讨论事项")}<textarea rows={3} maxLength={MAX_RESUME_TEXT_LENGTH} value={draft.discussion} onChange={e => change({ discussion: e.target.value })} /></label>
        <label className="mr-checkbox"><input type="checkbox" checked={draft.includeSources} onChange={e => change({ includeSources: e.target.checked })} />{draft.ai ? l("対象記録の全文を参考資料として配布物にも付ける", "将目标记录全文附加到分发资料") : l("日報の全文を参考資料として配布物にも付ける", "将日报全文附加到分发资料")}</label>
        <details className="mr-source-review"><summary>{draft.ai ? l(`根拠記録 ${draft.sources.length} 件の全文を確認（通常は配布物に含みません）`, `查看 ${draft.sources.length} 项依据记录全文（默认不刊载）`) : l(`参照日報 ${draft.sources.length} 件の全文を確認（通常は配布物に含みません）`, `查看 ${draft.sources.length} 份参考日报全文（默认不刊载）`)}</summary>{draft.sources.map((s, i) => <article key={`${s.id}-${i}`}><strong>{draft.ai ? `${s.id} · ` : ""}{s.date} · {s.name} · {s.category}</strong><p>{s.activities}</p>{s.findings && <p>{l("報告・所見", "报告与见解")}：{s.findings}</p>}{s.nextPlan && <p>{l("今後の予定", "后续计划")}：{s.nextPlan}</p>}</article>)}</details>{draft.ai && <details className="mr-source-review"><summary>{l(`本文に個別掲載しなかった記録 ${draft.ai.notFeatured.length} 件`, `未在正文单列的记录 ${draft.ai.notFeatured.length} 项`)}</summary><ul>{draft.ai.notFeatured.map(n => <li key={n.sourceId}>{n.sourceId}：{n.reason}</li>)}</ul></details>}
      </section>
      <section className="card mr-controls"><h2>{l("3. 確認して配布する", "3. 确认并分发")}</h2><p className="mr-help">{l("編集内容はログアウト・再読み込みで消えます。再編集用の下書きを保存してください。配布にはPDFまたはHTMLを使います。日報・添付ファイル・コメントは変更しません。下書きJSONには対象記録の全文が入るため、保管用として扱ってください。", "退出登录或刷新页面后编辑内容将消失，请保存草稿以继续编辑。分发使用PDF或HTML。本功能不修改日报、附件或评论。草稿JSON含目标记录全文，请妥善保管。")}</p>{draft.ai && <label className="mr-checkbox mr-review-confirm"><input type="checkbox" checked={draft.ai.reviewed} onChange={e => { setDraft({ ...draft, ai: { ...draft.ai!, reviewed: e.target.checked } }); setDirty(true); }} />{l("要点・図解・会議の議題と根拠記録を確認した", "已确认要点、图解、会议议题及依据记录")}</label>}{!hasThemes && <p role="alert">{l("掲載テーマを1件以上選択してください。", "请至少选择一个刊载主题。")}</p>}<div className="mr-actions"><button className="button primary" disabled={!hasThemes || clipped || printing || !!(draft.ai && !draft.ai.reviewed)} onClick={() => { setPrinting(true); void import("./export").then(module => module.printResume(draft, locale)).catch(() => setMessage(l("印刷画面を開けませんでした。HTMLを保存してブラウザから印刷してください。", "无法打开打印窗口，请保存HTML后在浏览器中打印。"))).finally(() => setPrinting(false)); }}><Printer size={17} />{l("印刷・PDF保存", "打印／保存PDF")}</button><button className="button secondary" disabled={!hasThemes || clipped || !!(draft.ai && !draft.ai.reviewed)} onClick={() => { void import("./export").then(module => downloadResume(`meeting-resume-${draft.from}-${draft.to}.html`, module.resumeHtml(draft, locale), "text/html;charset=utf-8")).catch(() => setMessage(l("HTMLを作成できませんでした。通信状態を確認して再試行してください。", "无法创建HTML，请检查网络并重试。"))); }}><Download size={17} />{l("配布用HTMLを保存", "保存分发HTML")}</button><button className="button ghost" onClick={() => { try { downloadResume(`meeting-resume-draft-${draft.from}-${draft.to}.json`, serializeResumeDraft(draft), "application/json"); setDirty(false); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>{l("再編集用の下書きを保存", "保存可继续编辑的草稿")}</button></div><p className="mr-help">{l("PDF：印刷画面の保存先で「PDFに保存」を選びます。A4縦・倍率100％を推奨。HTMLはブラウザで開くと図表入りの資料を確認できます。", "PDF：在打印窗口选择保存为PDF，建议A4纵向、100％缩放。HTML可直接在浏览器中查看图表资料。")}</p>
      </section>
      </fieldset><style>{documentStyle}</style><ResumeDocument resume={draft} locale={locale} />
    </>}
    {!draft && <div className="card mr-empty"><FileText size={34} /><h2>{l("今月の進展と、次の判断を一つに。", "把月底活动整理成清晰的脉络。")}</h2><p>{l("期間と対象者を指定して作成すると、ここに図表入りのレジュメが表示されます。", "指定期间和对象后创建，图表简报将显示在这里。")}</p></div>}
  </div>;
}
