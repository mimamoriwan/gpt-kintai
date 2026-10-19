import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../../i18n";
import type { Locale } from "../../types";
import { translateBusinessContent } from "./api";
import type { BusinessContentKind, BusinessTranslation } from "./types";

type Resource = { id: string; contentVersion: string; sourceLocale: Locale };
type Store = { uid: string; active: boolean; running: number; queue: Array<() => void>; values: Map<string, BusinessTranslation>; pending: Map<string, Promise<BusinessTranslation>> };
const TranslationContext = createContext<Store | null>(null);

/** Cache lifetime is one mounted account, never persisted shared content. */
export function BusinessTranslationProvider({ uid, children }: { uid: string; children: ReactNode }) {
  const store = useMemo<Store>(() => ({ uid, active: true, running: 0, queue: [], values: new Map(), pending: new Map() }), [uid]);
  useEffect(() => { store.active = true; return () => { store.active = false; store.values.clear(); store.pending.clear(); while (store.queue.length) store.queue.shift()?.(); }; }, [store]);
  return <TranslationContext.Provider value={store}>{children}</TranslationContext.Provider>;
}
export function useBusinessTranslation(kind: BusinessContentKind, resource: Resource) {
  const { locale } = useI18n();
  const store = useContext(TranslationContext);
  if (!store) throw new Error("BusinessTranslationProvider is missing");
  const key = JSON.stringify([store.uid, kind, resource.id, resource.contentVersion, locale]);
  const current = useRef(key); current.current = key;
  const [result, setResult] = useState<{ key: string; value?: BusinessTranslation; error?: boolean; loading?: boolean }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (resource.sourceLocale === locale) return;
    let active = true;
    const cached = store.values.get(key);
    if (cached) { setResult({ key, value: cached }); return; }
    setResult({ key, loading: true });
    let pending = store.pending.get(key);
    if (!pending) {
      pending = new Promise<BusinessTranslation>((resolve, reject) => {
        const start = () => {
          if (!store.active) { reject(new Error("Account changed")); return; }
          store.running += 1;
          void translateBusinessContent({ kind, id: resource.id, expectedContentVersion: resource.contentVersion, targetLocale: locale })
            .then(resolve, reject).finally(() => { store.running -= 1; store.queue.shift()?.(); });
        };
        if (store.running < 3) start(); else store.queue.push(start);
      });
      store.pending.set(key, pending);
    }
    void pending.then(value => {
      if (!active || current.current !== key) return;
      if (value.kind !== kind || value.id !== resource.id || value.contentVersion !== resource.contentVersion || value.targetLocale !== locale) { setResult({ key, error: true }); return; }
      store.values.set(key, value); setResult({ key, value });
    }).catch(() => { if (active && current.current === key) setResult({ key, error: true }); })
      .finally(() => { if (store.pending.get(key) === pending) store.pending.delete(key); });
    return () => { active = false; };
  }, [key, kind, resource.id, resource.contentVersion, resource.sourceLocale, locale, store, attempt]);
  const retry = useCallback(() => { store.values.delete(key); store.pending.delete(key); setAttempt(a => a + 1); }, [key, store]);
  const valid = result?.key === key && resource.sourceLocale !== locale ? result : undefined;
  return { fields: valid?.value?.fields, error: valid?.error ?? false, loading: valid?.loading ?? false, retry };
}
export function TranslatedText({ kind, resource, field, text, compact = false }: { kind: BusinessContentKind; resource: Resource; field: string; text: string; compact?: boolean }) {
  const { locale } = useI18n();
  const tr = useBusinessTranslation(kind, resource);
  const [original, setOriginal] = useState(false);
  const translated = tr.fields?.[field];
  return <span className={`business-translated${compact ? " business-translated-compact" : ""}`}>
    <span lang={original || !translated ? resource.sourceLocale : locale}>{original || !translated ? text : translated}</span>
    {resource.sourceLocale !== locale && <span className="business-translation-tools">
      {translated && <button type="button" className="business-text-button" onClick={() => setOriginal(v => !v)}>{original ? (locale === "ja" ? "翻訳を表示" : "显示译文") : "原文"}</button>}
      {tr.loading && <small>{locale === "ja" ? "翻訳中・原文を表示" : "翻译中・显示原文"}</small>}
      {tr.error && <><small>{locale === "ja" ? "翻訳できませんでした・原文を表示" : "翻译失败・显示原文"}</small><button type="button" className="business-text-button" onClick={tr.retry}>{locale === "ja" ? "翻訳を再試行" : "重试翻译"}</button></>}
    </span>}
  </span>;
}
