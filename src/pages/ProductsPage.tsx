import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft, Camera, Check, FileImage, ImagePlus, LoaderCircle, PackageSearch, Pencil, Plus, Search, Sparkles } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { compressProductImage, isValidJan, localizeProductWarnings, normalizeJan, normalizeProductFacts, normalizeProductMatch } from "../lib/product";
import { todayJst } from "../lib/format";
import {
  analyzeProductPhotos,
  attachProductPhotos,
  retryProductReasonTranslation,
  reviewProductObservation,
  saveProductCandidate,
  setProductEstimateRequested,
  setProductStatus,
  updateProductFacts,
  updateProductObservation,
  uploadProductPhotos
} from "../services/api";
import type {
  Product,
  ProductFacts,
  ProductObservation,
  ProductObservationReviewStatus,
  ProductPhotoKind,
  ProductRevision,
  ProductSource,
  ProductStatus,
  UserProfile
} from "../types";

type Notify = (type: "success" | "error", message: string) => void;
type View = { kind: "list" } | { kind: "new" } | { kind: "detail"; productId: string };

const emptyFacts: ProductFacts = { name: "", jan: "", makerBrand: "", ingredients: "" };
const statusValues: ProductStatus[] = ["new", "considering", "on_hold", "closed"];
const sourceValues: ProductSource[] = ["store", "business_trip", "internet", "flyer", "other"];
const photoKinds: ProductPhotoKind[] = ["front", "jan", "ingredients"];

export function ProductsPage({ products, observations, revisions, users, notify }: {
  products: Product[];
  observations: ProductObservation[];
  revisions: ProductRevision[];
  users: UserProfile[];
  notify: Notify;
}) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const [view, setView] = useState<View>({ kind: "list" });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"" | ProductStatus>("");
  const [source, setSource] = useState<"" | ProductSource>("");
  const [observer, setObserver] = useState("");
  const [review, setReview] = useState<"" | ProductObservationReviewStatus>("");
  const [estimateOverrides, setEstimateOverrides] = useState<Record<string, boolean>>({});
  const canManage = profile?.role === "employee_manager";
  const readOnly = profile?.role === "president_viewer";

  useEffect(() => {
    setEstimateOverrides((current) => {
      let changed = false;
      const next = { ...current };
      for (const [productId, value] of Object.entries(current)) {
        const product = products.find((item) => item.id === productId);
        if (product && Boolean(product.estimateRequested) === value) {
          delete next[productId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [products]);

  function estimateRequestedFor(product: Product): boolean {
    return Object.prototype.hasOwnProperty.call(estimateOverrides, product.id)
      ? estimateOverrides[product.id]
      : Boolean(product.estimateRequested);
  }

  function overrideEstimateRequested(productId: string, value: boolean) {
    setEstimateOverrides((current) => ({ ...current, [productId]: value }));
  }

  const filtered = useMemo(() => products.filter((product) => {
    const productObservations = observations.filter((item) => item.productId === product.id);
    const text = normalizeProductMatch(`${product.name} ${product.jan} ${product.makerBrand} ${product.ingredients}`);
    return (!query || text.includes(normalizeProductMatch(query))) &&
      (!status || product.status === status) &&
      (!source || productObservations.some((item) => item.source === source)) &&
      (!observer || productObservations.some((item) => item.userId === observer)) &&
      (!review || productObservations.some((item) => item.reviewStatus === review));
  }), [observer, observations, products, query, review, source, status]);

  if (view.kind === "new") return <ProductRegistration products={products} notify={notify} onClose={() => setView({ kind: "list" })} />;
  if (view.kind === "detail") {
    const product = products.find((item) => item.id === view.productId);
    if (!product) return null;
    return <ProductDetail product={{ ...product, estimateRequested: estimateRequestedFor(product) }} observations={observations.filter((item) => item.productId === product.id)} revisions={revisions.filter((item) => item.productId === product.id)} canManage={canManage} canEditEstimate={!readOnly} notify={notify} onEstimateRequestedChange={(value) => overrideEstimateRequested(product.id, value)} onBack={() => setView({ kind: "list" })} />;
  }

  return <div className="page products-page">
    <div className="page-heading split">
      <div><span className="eyebrow">PRODUCT CANDIDATES</span><h1>{locale === "ja" ? "商品候補" : "商品候选"}</h1><p>{locale === "ja" ? "3人で共有する会社共通リストです。気になった商品と、その理由を発見者ごとに蓄積します。" : "这是三人共享的公司共用清单，按发现者记录感兴趣的商品和理由。"}</p></div>
      {!readOnly && <button className="button primary" onClick={() => setView({ kind: "new" })}><Plus size={18} />{locale === "ja" ? "商品を登録" : "登记商品"}</button>}
    </div>
    <section className="card product-filters">
      <label className="product-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={locale === "ja" ? "商品名・JAN・メーカー・原材料を検索" : "搜索商品名、JAN、品牌、配料"} /></label>
      <select value={status} onChange={(event) => setStatus(event.target.value as "" | ProductStatus)}><option value="">{locale === "ja" ? "すべての状態" : "全部状态"}</option>{statusValues.map((value) => <option key={value} value={value}>{statusLabel(value, locale)}</option>)}</select>
      <select value={observer} onChange={(event) => setObserver(event.target.value)}><option value="">{locale === "ja" ? "すべての発見者" : "全部发现者"}</option>{users.filter((user) => user.role !== "president_viewer").map((user) => <option key={user.uid} value={user.uid}>{user.displayName}</option>)}</select>
      <select value={source} onChange={(event) => setSource(event.target.value as "" | ProductSource)}><option value="">{locale === "ja" ? "すべての発見元" : "全部发现来源"}</option>{sourceValues.map((value) => <option key={value} value={value}>{sourceLabel(value, locale)}</option>)}</select>
      <select value={review} onChange={(event) => setReview(event.target.value as "" | ProductObservationReviewStatus)}><option value="">{locale === "ja" ? "すべての確認状態" : "全部确认状态"}</option><option value="unreviewed">{locale === "ja" ? "未確認" : "未确认"}</option><option value="reviewed">{locale === "ja" ? "確認済み" : "已确认"}</option><option value="needs_review">{locale === "ja" ? "修正後再確認" : "修改后需复核"}</option></select>
    </section>
    <section className="product-grid">
      {filtered.map((product) => <button key={product.id} className="card product-card" onClick={() => setView({ kind: "detail", productId: product.id })}>
        <span className="product-card-photo">{product.representativePhoto?.downloadUrl ? <img src={product.representativePhoto.downloadUrl} alt="" /> : <PackageSearch size={30} />}</span>
        <span className="product-card-body"><span className="product-card-chips"><span className={`status-chip product-${product.status}`}>{statusLabel(product.status, locale)}</span>{estimateRequestedFor(product) && <span className="status-chip estimate-requested">{locale === "ja" ? "見積もり希望" : "希望报价"}</span>}</span><strong>{product.name}</strong><small>{product.makerBrand || (locale === "ja" ? "メーカー未入力" : "未填写品牌")}</small><span className="product-card-meta"><span>JAN {product.jan || "—"}</span><span>{locale === "ja" ? `発見 ${product.observationCount}件` : `发现 ${product.observationCount}次`}</span></span><em>{locale === "ja" ? `最新：${product.latestObserverName}` : `最新：${product.latestObserverName}`}</em></span>
      </button>)}
      {filtered.length === 0 && <div className="card product-empty"><PackageSearch size={34} /><strong>{locale === "ja" ? "該当する商品候補はありません" : "没有符合条件的商品"}</strong></div>}
    </section>
  </div>;
}

function ProductRegistration({ products, notify, onClose }: { products: Product[]; notify: Notify; onClose: () => void }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const [draftId] = useState(() => crypto.randomUUID());
  const [facts, setFacts] = useState<ProductFacts>(emptyFacts);
  const [files, setFiles] = useState<Partial<Record<ProductPhotoKind, File>>>({});
  const [discoveredDate, setDiscoveredDate] = useState(todayJst());
  const [source, setSource] = useState<ProductSource>("store");
  const [sourceDetail, setSourceDetail] = useState("");
  const [reasonOriginal, setReasonOriginal] = useState("");
  const [estimateRequested, setEstimateRequested] = useState(false);
  const [addToWorkMemo, setAddToWorkMemo] = useState(false);
  const [busy, setBusy] = useState<"" | "ai" | "save">("");
  const [processingPhotos, setProcessingPhotos] = useState<ProductPhotoKind[]>([]);
  const photoSelectionVersion = useRef<Partial<Record<ProductPhotoKind, number>>>({});
  const janInputRef = useRef<HTMLInputElement>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [janReadByAi, setJanReadByAi] = useState(false);
  const [janConfirmed, setJanConfirmed] = useState(false);
  const [selectedExisting, setSelectedExisting] = useState("");
  const [confirmNew, setConfirmNew] = useState(false);
  const jan = normalizeJan(facts.jan);
  const janInvalid = Boolean(jan) && !isValidJan(jan);
  const noJanCandidates = useMemo(() => {
    if (jan || !facts.name.trim()) return [];
    const name = normalizeProductMatch(facts.name);
    const maker = normalizeProductMatch(facts.makerBrand);
    return products.filter((product) => {
      const candidateName = normalizeProductMatch(product.name);
      const candidateMaker = normalizeProductMatch(product.makerBrand);
      return (candidateName.includes(name) || name.includes(candidateName)) && (!maker || !candidateMaker || maker === candidateMaker);
    }).slice(0, 5);
  }, [facts.makerBrand, facts.name, jan, products]);

  async function chooseFile(kind: ProductPhotoKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const version = (photoSelectionVersion.current[kind] || 0) + 1;
    photoSelectionVersion.current[kind] = version;
    setProcessingPhotos((current) => [...new Set([...current, kind])]);
    try {
      const normalized = await compressProductImage(file);
      if (photoSelectionVersion.current[kind] === version) {
        setFiles((current) => ({ ...current, [kind]: normalized }));
      }
    } catch (error) {
      if (photoSelectionVersion.current[kind] === version) notify("error", message(error));
    } finally {
      if (photoSelectionVersion.current[kind] === version) {
        setProcessingPhotos((current) => current.filter((item) => item !== kind));
      }
    }
  }
  async function analyze() {
    if (!Object.keys(files).length) { notify("error", locale === "ja" ? "解析する写真を選択してください。" : "请选择要分析的照片。"); return; }
    setBusy("ai");
    try {
      const result = await analyzeProductPhotos(draftId, files);
      const normalizedFacts = normalizeProductFacts(result);
      setFacts(normalizedFacts);
      setWarnings(localizeProductWarnings(result.warnings, locale));
      setJanReadByAi(Boolean(normalizeJan(normalizedFacts.jan)));
      setJanConfirmed(false);
      notify("success", locale === "ja" ? "写真を読み取りました。内容を確認・修正してください。" : "照片识别完成，请确认并修改内容。");
    } catch (error) { notify("error", message(error)); }
    finally { setBusy(""); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (janInvalid) {
      notify("error", locale === "ja" ? "JANコードを写真と照合して修正するか、「JANなしで登録」を選択してください。" : "请对照照片修正JAN码，或选择“无JAN码登记”。");
      janInputRef.current?.focus();
      janInputRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      return;
    }
    if (janReadByAi && jan && !janConfirmed) {
      notify("error", locale === "ja" ? "写真と照合してJANコードを確認し、確認欄にチェックしてください。" : "请对照照片确认JAN码，并勾选确认框。");
      janInputRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      return;
    }
    if (!jan && noJanCandidates.length && !selectedExisting && !confirmNew) { notify("error", locale === "ja" ? "既存商品へ追加するか、新規商品として登録するか選択してください。" : "请选择添加到已有商品或新建商品。"); return; }
    setBusy("save");
    try {
      const result = await saveProductCandidate({ draftId, facts: { ...normalizeProductFacts(facts), jan }, discoveredDate, source, sourceDetail, reasonOriginal, reasonLanguage: locale, estimateRequested, addToWorkMemo, existingProductId: selectedExisting, createNewWithoutJan: !jan && !selectedExisting });
      let photoUploadFailed = false;
      if (profile && Object.keys(files).length) {
        try {
          const photos = await uploadProductPhotos(profile, result.observationId, files);
          await attachProductPhotos(result.observationId, photos);
        } catch {
          // The product and observation are already committed at this point.
          // Do not leave the form open because submitting it again would create
          // a duplicate observation. The record remains usable without photos.
          photoUploadFailed = true;
        }
      }
      const suffix = result.reportAlreadySubmitted ? (locale === "ja" ? " 提出済みの日報は自動変更されないため、必要に応じて再作成・修正してください。" : " 已提交的日报不会自动修改，请按需重新生成或修改。") : "";
      if (photoUploadFailed) {
        notify("error", (locale === "ja"
          ? "商品候補は登録できましたが、写真の保存に失敗しました。商品情報は重複登録せず、そのままご利用ください。"
          : "商品候选已登记，但照片保存失败。请勿重复登记，商品信息仍可正常使用。") + suffix);
      } else {
        notify("success", (locale === "ja" ? "商品候補を登録しました。" : "商品候选已登记。") + suffix);
      }
      onClose();
    } catch (error) { notify("error", message(error)); }
    finally { setBusy(""); }
  }

  return <div className="page products-page">
    <button className="back-link" onClick={onClose}><ArrowLeft size={17} />{locale === "ja" ? "商品一覧へ" : "返回商品列表"}</button>
    <div className="page-heading"><span className="eyebrow">NEW PRODUCT CANDIDATE</span><h1>{locale === "ja" ? "気になる商品を登録" : "登记感兴趣的商品"}</h1><p>{locale === "ja" ? "写真のAI読取も、写真なしの手入力も利用できます。" : "可使用AI识别照片，也可以不拍照手动填写。"}</p></div>
    <form className="product-form" onSubmit={submit}>
      <section className="card product-form-section"><div className="section-title"><span>{locale === "ja" ? "1. 写真（すべて任意）" : "1. 照片（全部可选）"}</span><span className="tag soft">{locale === "ja" ? "HEIC対応・JPEG 1MB以下へ自動調整" : "支持HEIC・自动转为1MB以下JPEG"}</span></div><div className="product-photo-grid">{photoKinds.map((kind) => <PhotoPicker key={kind} kind={kind} file={files[kind]} processing={processingPhotos.includes(kind)} locale={locale} onChange={chooseFile} onRemove={() => { photoSelectionVersion.current[kind] = (photoSelectionVersion.current[kind] || 0) + 1; setProcessingPhotos((current) => current.filter((item) => item !== kind)); setFiles((current) => { const next = { ...current }; delete next[kind]; return next; }); }} />)}</div><button type="button" className="button ai-button" disabled={Boolean(busy) || processingPhotos.length > 0 || !Object.keys(files).length} onClick={() => void analyze()}>{busy === "ai" ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}{locale === "ja" ? "選択した写真をAIで読み取る" : "用AI识别所选照片"}</button><small className="privacy-note">{locale === "ja" ? "撮影・選択した写真は端末上でJPEGへ変換・軽量化してから使用します。AIへ送信するのは選択した商品写真だけで、インターネット検索は行いません。" : "拍摄或选择的照片会先在设备上转换并压缩为JPEG。仅将所选商品照片发送给AI，不进行网络搜索。"}</small></section>
      <section className="card product-form-section"><div className="section-title"><span>{locale === "ja" ? "2. 読取結果を確認・修正" : "2. 确认并修改识别结果"}</span></div>{warnings.length > 0 && <div className="product-warning-list">{warnings.map((warning) => <span key={warning}>⚠ {warning}</span>)}</div>}<div className="form-grid two"><label><span>{locale === "ja" ? "商品名 *" : "商品名 *"}</span><input value={facts.name} maxLength={240} required onChange={(event) => setFacts({ ...facts, name: event.target.value })} /></label><label><span>JANコード</span><input ref={janInputRef} value={facts.jan} inputMode="numeric" maxLength={17} placeholder="JAN-8 / JAN-13" aria-invalid={janInvalid} onChange={(event) => { setFacts({ ...facts, jan: event.target.value }); if (janReadByAi) setJanConfirmed(false); }} />{janInvalid && <small className="field-error">{locale === "ja" ? "桁数またはチェックデジットを確認してください。" : "请确认位数或校验位。"}</small>}</label><label><span>{locale === "ja" ? "メーカー／ブランド" : "制造商／品牌"}</span><input value={facts.makerBrand} maxLength={240} onChange={(event) => setFacts({ ...facts, makerBrand: event.target.value })} /></label><label className="span-two"><span>{locale === "ja" ? "原材料名" : "配料"}</span><textarea value={facts.ingredients} maxLength={5000} rows={4} onChange={(event) => setFacts({ ...facts, ingredients: event.target.value })} /></label></div>{janReadByAi && jan && <div className={`jan-verification ${janInvalid ? "invalid" : "valid"}`}>{janInvalid ? <><strong>{locale === "ja" ? "このJANコードは登録できません" : "此JAN码无法登记"}</strong><p>{locale === "ja" ? "写真のバーコード下の番号と照合して修正してください。番号を確認できない場合は、JANを空欄にして商品を登録できます。" : "请对照照片中条码下方的数字进行修正。无法确认时，可将JAN留空后登记商品。"}</p><button type="button" className="button ghost" onClick={() => { setFacts({ ...facts, jan: "" }); setJanReadByAi(false); setJanConfirmed(false); setWarnings((current) => current.filter((warning) => !/JAN|バーコード/i.test(warning))); }}>{locale === "ja" ? "JANなしで登録する" : "无JAN码登记"}</button></> : <label className="jan-confirmation"><input type="checkbox" checked={janConfirmed} onChange={(event) => setJanConfirmed(event.target.checked)} /><span><strong>{locale === "ja" ? "写真と照合してJANコードを確認しました" : "已对照照片确认JAN码"}</strong><small>{locale === "ja" ? "AIの読取結果だけに頼らず、バーコード下の番号が一致していることを確認してください。" : "请勿只依赖AI识别结果，并确认与条码下方的数字一致。"}</small></span></label>}</div>}{!jan && noJanCandidates.length > 0 && <div className="duplicate-candidates"><strong>{locale === "ja" ? "似ている既存商品があります" : "发现相似的已有商品"}</strong>{noJanCandidates.map((product) => <label key={product.id}><input type="radio" name="duplicate" checked={selectedExisting === product.id} onChange={() => { setSelectedExisting(product.id); setConfirmNew(false); }} /><span>{product.name}<small>{product.makerBrand || "—"}・発見 {product.observationCount}件</small></span></label>)}<label><input type="radio" name="duplicate" checked={confirmNew} onChange={() => { setConfirmNew(true); setSelectedExisting(""); }} /><span>{locale === "ja" ? "別の商品として新規登録" : "作为不同商品新建"}</span></label></div>}</section>
      <section className="card product-form-section"><div className="section-title"><span>{locale === "ja" ? "3. 発見した状況と理由" : "3. 发现情况和理由"}</span></div><div className="form-grid two"><label><span>{locale === "ja" ? "発見日 *" : "发现日期 *"}</span><input type="date" value={discoveredDate} required onChange={(event) => setDiscoveredDate(event.target.value)} /></label><label><span>{locale === "ja" ? "発見元 *" : "发现来源 *"}</span><select value={source} onChange={(event) => setSource(event.target.value as ProductSource)}>{sourceValues.map((value) => <option key={value} value={value}>{sourceLabel(value, locale)}</option>)}</select></label><label className="span-two"><span>{locale === "ja" ? "発見元の詳細" : "来源详情"}</span><input value={sourceDetail} maxLength={2000} placeholder={locale === "ja" ? "店舗、地域、URLなど" : "店铺、地区、网址等"} onChange={(event) => setSourceDetail(event.target.value)} /></label><label className="span-two"><span>{locale === "ja" ? "気になる理由（入力推奨・任意）" : "感兴趣的理由（建议填写、可选）"}</span><textarea value={reasonOriginal} maxLength={5000} rows={5} placeholder={locale === "ja" ? "中国市場で気になった点など、あなた自身の視点を残してください。" : "请记录从中国市场角度关注的地方，以及您自己的看法。"} onChange={(event) => setReasonOriginal(event.target.value)} /></label></div><label className="checkbox-row estimate-request-row"><input type="checkbox" checked={estimateRequested} onChange={(event) => setEstimateRequested(event.target.checked)} /><span><strong>{locale === "ja" ? "この商品の見積もりを希望する" : "希望获取该商品的报价"}</strong><small>{locale === "ja" ? "チェックすると、商品一覧と詳細に「見積もり希望」と表示され、全員に共有されます。" : "勾选后，商品列表和详情中会显示“希望报价”，并与所有人共享。"}</small></span></label><label className="checkbox-row"><input type="checkbox" checked={addToWorkMemo} onChange={(event) => setAddToWorkMemo(event.target.checked)} /><span><strong>{locale === "ja" ? "その日の業務メモにも追加" : "同时添加到当天工作记录"}</strong><small>{locale === "ja" ? "「商品発掘」タグでメモを作成します。初期状態はオフです。" : "将以“商品发掘”标签创建记录，默认关闭。"}</small></span></label></section>
      <div className="product-submit-bar"><button type="button" className="button ghost" onClick={onClose}>{locale === "ja" ? "キャンセル" : "取消"}</button><button className="button primary" disabled={Boolean(busy) || processingPhotos.length > 0}>{busy === "save" ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}{locale === "ja" ? "この内容で登録" : "按此内容登记"}</button></div>
    </form>
  </div>;
}

function PhotoPicker({ kind, file, processing, locale, onChange, onRemove }: { kind: ProductPhotoKind; file?: File; processing: boolean; locale: string; onChange: (kind: ProductPhotoKind, event: ChangeEvent<HTMLInputElement>) => void; onRemove: () => void }) {
  const label = kind === "front" ? (locale === "ja" ? "商品正面" : "商品正面") : kind === "jan" ? "JANコード" : (locale === "ja" ? "原材料表示" : "配料表");
  const preview = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return <article className="product-photo-picker"><strong>{label}</strong><div>{processing ? <span className="photo-processing"><LoaderCircle className="spin" size={22} />{locale === "ja" ? "変換・軽量化中" : "正在转换压缩"}</span> : preview ? <img src={preview} alt="" /> : <ImagePlus size={29} />}</div><span className="photo-actions"><label><Camera size={15} />{locale === "ja" ? "撮影" : "拍照"}<input type="file" accept="image/*,.heic,.heif" capture="environment" disabled={processing} onChange={(event) => onChange(kind, event)} /></label><label><FileImage size={15} />{locale === "ja" ? "選択" : "选择"}<input type="file" accept="image/*,.heic,.heif" disabled={processing} onChange={(event) => onChange(kind, event)} /></label></span>{file && !processing && <button type="button" onClick={onRemove}>{locale === "ja" ? "削除" : "删除"}</button>}</article>;
}

function ProductDetail({ product, observations, revisions, canManage, canEditEstimate, notify, onEstimateRequestedChange, onBack }: { product: Product; observations: ProductObservation[]; revisions: ProductRevision[]; canManage: boolean; canEditEstimate: boolean; notify: Notify; onEstimateRequestedChange: (value: boolean) => void; onBack: () => void }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const [editingFacts, setEditingFacts] = useState(false);
  const [facts, setFacts] = useState<ProductFacts>({ name: product.name, jan: product.jan, makerBrand: product.makerBrand, ingredients: product.ingredients });
  const [factReason, setFactReason] = useState("");
  const [editingObservation, setEditingObservation] = useState<ProductObservation | null>(null);
  const [editReason, setEditReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [estimateBusy, setEstimateBusy] = useState(false);
  const [estimateRequested, setEstimateRequested] = useState(Boolean(product.estimateRequested));
  useEffect(() => setEstimateRequested(Boolean(product.estimateRequested)), [product.estimateRequested]);
  async function changeStatus(value: ProductStatus) { setBusy(true); try { await setProductStatus(product.id, value); notify("success", locale === "ja" ? "検討状態を変更しました。" : "状态已更新。"); } catch (error) { notify("error", message(error)); } finally { setBusy(false); } }
  async function changeEstimateRequest(value: boolean) { const previous = estimateRequested; setEstimateRequested(value); onEstimateRequestedChange(value); setEstimateBusy(true); try { await setProductEstimateRequested(product.id, value); notify("success", locale === "ja" ? (value ? "見積もり希望に設定しました。" : "見積もり希望を解除しました。") : (value ? "已设为希望报价。" : "已取消希望报价。")); } catch (error) { setEstimateRequested(previous); onEstimateRequestedChange(previous); notify("error", message(error)); } finally { setEstimateBusy(false); } }
  async function saveFacts() { setBusy(true); try { await updateProductFacts(product.id, { ...facts, jan: normalizeJan(facts.jan) }, factReason); notify("success", locale === "ja" ? "商品情報を修正し、履歴を保存しました。" : "商品信息已修改并保存历史。" ); setEditingFacts(false); setFactReason(""); } catch (error) { notify("error", message(error)); } finally { setBusy(false); } }
  async function reviewObservation(id: string) { setBusy(true); try { await reviewProductObservation(id); notify("success", locale === "ja" ? "発見記録を確認済みにしました。" : "发现记录已确认。" ); } catch (error) { notify("error", message(error)); } finally { setBusy(false); } }
  async function saveObservation() { if (!editingObservation) return; setBusy(true); try { await updateProductObservation({ observationId: editingObservation.id, discoveredDate: editingObservation.discoveredDate, source: editingObservation.source, sourceDetail: editingObservation.sourceDetail, reasonOriginal: editingObservation.reasonOriginal, reasonLanguage: editingObservation.reasonLanguage, correctionReason: editReason }); notify("success", locale === "ja" ? "発見記録を修正しました。" : "发现记录已修改。" ); setEditingObservation(null); setEditReason(""); } catch (error) { notify("error", message(error)); } finally { setBusy(false); } }
  return <div className="page products-page"><button className="back-link" onClick={onBack}><ArrowLeft size={17} />{locale === "ja" ? "商品一覧へ" : "返回商品列表"}</button><div className="product-detail-heading"><span className="product-detail-photo">{product.representativePhoto?.downloadUrl ? <img src={product.representativePhoto.downloadUrl} alt="" /> : <PackageSearch size={38} />}</span><div><span className="product-card-chips"><span className={`status-chip product-${product.status}`}>{statusLabel(product.status, locale)}</span>{estimateRequested && <span className="status-chip estimate-requested">{locale === "ja" ? "見積もり希望" : "希望报价"}</span>}</span><h1>{product.name}</h1><p>{product.makerBrand || "—"}・JAN {product.jan || "—"}</p></div>{canManage && <label className="status-select"><span>{locale === "ja" ? "検討状態" : "评估状态"}</span><select value={product.status} disabled={busy} onChange={(event) => void changeStatus(event.target.value as ProductStatus)}>{statusValues.map((value) => <option key={value} value={value}>{statusLabel(value, locale)}</option>)}</select></label>}</div>
    {canEditEstimate && <section className={`card product-estimate-card ${estimateRequested ? "active" : ""}`}><label className="product-estimate-toggle"><input type="checkbox" checked={estimateRequested} disabled={estimateBusy} onChange={(event) => void changeEstimateRequest(event.target.checked)} /><span><strong>{locale === "ja" ? "この商品の見積もりを希望する" : "希望获取该商品的报价"}</strong><small>{locale === "ja" ? "登録後も変更できます。オンにすると、商品一覧に「見積もり希望」タグが表示されます。" : "登记后也可修改。开启后，商品列表中会显示“希望报价”标签。"}</small></span>{estimateBusy && <LoaderCircle className="spin" size={18} />}</label></section>}
    <section className="card product-facts-card"><div className="section-title"><span>{locale === "ja" ? "商品情報" : "商品信息"}</span>{canManage && !editingFacts && <button className="button ghost" onClick={() => setEditingFacts(true)}><Pencil size={16} />{locale === "ja" ? "事実情報を修正" : "修改商品事实"}</button>}</div>{editingFacts ? <div className="form-grid two"><label><span>{locale === "ja" ? "商品名" : "商品名"}</span><input value={facts.name} onChange={(event) => setFacts({ ...facts, name: event.target.value })} /></label><label><span>JAN</span><input value={facts.jan} onChange={(event) => setFacts({ ...facts, jan: event.target.value })} /></label><label><span>{locale === "ja" ? "メーカー／ブランド" : "制造商／品牌"}</span><input value={facts.makerBrand} onChange={(event) => setFacts({ ...facts, makerBrand: event.target.value })} /></label><label className="span-two"><span>{locale === "ja" ? "原材料" : "配料"}</span><textarea rows={4} value={facts.ingredients} onChange={(event) => setFacts({ ...facts, ingredients: event.target.value })} /></label><label className="span-two"><span>{locale === "ja" ? "修正理由 *" : "修改理由 *"}</span><input value={factReason} minLength={3} required onChange={(event) => setFactReason(event.target.value)} /></label><div className="span-two modal-actions"><button className="button ghost" onClick={() => setEditingFacts(false)}>{locale === "ja" ? "キャンセル" : "取消"}</button><button className="button primary" disabled={busy || factReason.trim().length < 3} onClick={() => void saveFacts()}>{locale === "ja" ? "履歴を残して保存" : "保存并记录历史"}</button></div></div> : <div className="product-facts-view"><div><small>{locale === "ja" ? "商品名" : "商品名"}</small><p>{product.name}</p></div><div><small>JAN</small><p>{product.jan || "—"}</p></div><div><small>{locale === "ja" ? "メーカー／ブランド" : "制造商／品牌"}</small><p>{product.makerBrand || "—"}</p></div><div className="span-two"><small>{locale === "ja" ? "原材料" : "配料"}</small><p>{product.ingredients || "—"}</p></div></div>}</section>
    <section className="product-observations"><div className="section-title"><span>{locale === "ja" ? "気になった記録" : "感兴趣的记录"}</span><span className="count-badge">{observations.length}</span></div>{observations.map((observation) => <article className="card product-observation" key={observation.id}><div className="observation-heading"><span><strong>{observation.userName}</strong><small>{observation.discoveredDate}・{sourceLabel(observation.source, locale)}</small></span><span className={`status-chip ${observation.reviewStatus === "reviewed" ? "green" : "amber"}`}>{reviewLabel(observation.reviewStatus, locale)}</span></div>{observation.photos?.length > 0 && <div className="observation-photos">{observation.photos.map((photo) => <a key={photo.storagePath} href={photo.downloadUrl} target="_blank" rel="noreferrer"><img src={photo.downloadUrl} alt={photo.kind} /></a>)}</div>}<dl><div><dt>{locale === "ja" ? "発見元の詳細" : "来源详情"}</dt><dd>{observation.sourceDetail || "—"}</dd></div><div><dt>{locale === "ja" ? "気になる理由（原文）" : "感兴趣的理由（原文）"}</dt><dd>{observation.reasonOriginal || "—"}</dd></div>{observation.reasonLanguage === "zh-CN" && <div><dt>{locale === "ja" ? "日本語版" : "日语版"}</dt><dd>{observation.reasonJapanese || (observation.translationStatus === "failed" ? (locale === "ja" ? "翻訳に失敗しました" : "翻译失败") : "—")}</dd></div>}</dl><div className="observation-actions">{observation.userId === profile?.uid && <button className="button ghost" onClick={() => { setEditingObservation({ ...observation }); setEditReason(""); }}><Pencil size={15} />{locale === "ja" ? "自分の記録を修正" : "修改自己的记录"}</button>}{canManage && observation.reviewStatus !== "reviewed" && <button className="button secondary" disabled={busy} onClick={() => void reviewObservation(observation.id)}><Check size={15} />{locale === "ja" ? "確認済みにする" : "标记为已确认"}</button>}{observation.translationStatus === "failed" && observation.userId === profile?.uid && <button className="button ghost" onClick={async () => { try { await retryProductReasonTranslation(observation.id); notify("success", locale === "ja" ? "翻訳を再実行しました。" : "已重新翻译。"); } catch (error) { notify("error", message(error)); } }}>{locale === "ja" ? "翻訳を再実行" : "重新翻译"}</button>}</div></article>)}</section>
    {canManage && revisions.length > 0 && <section className="card revision-list"><div className="section-title"><span>{locale === "ja" ? "商品情報の変更履歴" : "商品信息修改历史"}</span></div>{revisions.map((revision) => <div key={revision.id}><strong>{revision.reason}</strong><small>{revision.changedAt?.toDate?.().toLocaleString(locale === "ja" ? "ja-JP" : "zh-CN")}</small><p>{revision.before.name} → {revision.after.name}</p></div>)}</section>}
    {editingObservation && <div className="modal-backdrop"><div className="modal wide"><h2>{locale === "ja" ? "自分の発見記録を修正" : "修改自己的发现记录"}</h2><label><span>{locale === "ja" ? "発見日" : "发现日期"}</span><input type="date" value={editingObservation.discoveredDate} onChange={(event) => setEditingObservation({ ...editingObservation, discoveredDate: event.target.value })} /></label><label><span>{locale === "ja" ? "発見元" : "发现来源"}</span><select value={editingObservation.source} onChange={(event) => setEditingObservation({ ...editingObservation, source: event.target.value as ProductSource })}>{sourceValues.map((value) => <option key={value} value={value}>{sourceLabel(value, locale)}</option>)}</select></label><label><span>{locale === "ja" ? "発見元の詳細" : "来源详情"}</span><input value={editingObservation.sourceDetail} onChange={(event) => setEditingObservation({ ...editingObservation, sourceDetail: event.target.value })} /></label><label><span>{locale === "ja" ? "気になる理由" : "感兴趣的理由"}</span><textarea rows={5} value={editingObservation.reasonOriginal} onChange={(event) => setEditingObservation({ ...editingObservation, reasonOriginal: event.target.value })} /></label><label><span>{locale === "ja" ? "修正理由 *" : "修改理由 *"}</span><input value={editReason} minLength={3} onChange={(event) => setEditReason(event.target.value)} /></label><div className="modal-actions"><button className="button ghost" onClick={() => setEditingObservation(null)}>{locale === "ja" ? "キャンセル" : "取消"}</button><button className="button primary" disabled={busy || editReason.trim().length < 3} onClick={() => void saveObservation()}>{locale === "ja" ? "履歴を残して修正" : "保存修改历史"}</button></div></div></div>}
  </div>;
}

function statusLabel(value: ProductStatus, locale: string): string { const ja = { new: "新規候補", considering: "検討中", on_hold: "保留", closed: "終了" }; const zh = { new: "新候选", considering: "评估中", on_hold: "暂缓", closed: "结束" }; return (locale === "ja" ? ja : zh)[value]; }
function sourceLabel(value: ProductSource, locale: string): string { const ja = { store: "店頭", business_trip: "出張先", internet: "ネット", flyer: "チラシ", other: "その他" }; const zh = { store: "店内", business_trip: "出差地", internet: "网络", flyer: "宣传单", other: "其他" }; return (locale === "ja" ? ja : zh)[value]; }
function reviewLabel(value: ProductObservationReviewStatus, locale: string): string { const ja = { unreviewed: "未確認", reviewed: "確認済み", needs_review: "修正後再確認" }; const zh = { unreviewed: "未确认", reviewed: "已确认", needs_review: "修改后需复核" }; return (locale === "ja" ? ja : zh)[value]; }
function message(error: unknown): string { return error instanceof Error ? error.message : "処理に失敗しました。"; }
