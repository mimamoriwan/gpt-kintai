import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { businessFeatureAvailable } from "../features/business/api";
import type { BusinessAnnouncementDraft } from "../features/business/types";
import type { UserProfile } from "../types";

export function businessIdFromHash(hash: string): string | undefined {
  return /^#business\/([A-Za-z0-9_-]{1,128})$/.exec(hash)?.[1];
}

/** Keep ordinary announcement text unchanged; only the app's own initiative links navigate. */
export function BusinessLinkText({ text }: { text: string }) {
  if (!businessFeatureAvailable) return <>{text}</>;
  return <>{text.split(/(https?:\/\/[^\s<>"']+)/g).map((part, index) => {
    let target: URL;
    try { target = new URL(part); } catch { return part; }
    if (target.origin !== window.location.origin || target.pathname !== "/" || target.search || !businessIdFromHash(target.hash)) return part;
    return <a key={index} href={target.href} data-business-link="true" onClick={(event) => {
      // Re-select even if the page's current hash already equals this link.
      if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && target.hash === window.location.hash) {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    }}>{part}</a>;
  })}</>;
}

function clearBusinessHash() {
  if (window.location.hash.startsWith("#business/")) {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }
}

/** The initial link may survive login, but never a logout or account change. */
export function useBusinessEntry(uid: string | undefined, onNavigate: (section: "home" | "business") => void) {
  const pendingLink = useRef(businessFeatureAvailable ? businessIdFromHash(window.location.hash) : undefined);
  const previousUid = useRef<string | undefined>(undefined);
  const [entry, setEntry] = useState<{ uid?: string; initiativeId?: string; draft?: BusinessAnnouncementDraft }>({});

  useEffect(() => {
    if (previousUid.current === uid) return;
    if (previousUid.current) {
      pendingLink.current = undefined;
      clearBusinessHash();
    }
    previousUid.current = uid;
    const initiativeId = uid && businessFeatureAvailable ? pendingLink.current : undefined;
    if (uid) pendingLink.current = undefined;
    setEntry({ uid, initiativeId });
    onNavigate(initiativeId ? "business" : "home");
  }, [uid, onNavigate]);

  useEffect(() => {
    const followLink = () => {
      if (!businessFeatureAvailable) return;
      const initiativeId = businessIdFromHash(window.location.hash);
      if (!uid) {
        pendingLink.current = initiativeId;
      } else if (initiativeId) {
        setEntry((current) => ({ ...(current.uid === uid ? current : {}), uid, initiativeId }));
        onNavigate("business");
      }
    };
    window.addEventListener("hashchange", followLink);
    return () => window.removeEventListener("hashchange", followLink);
  }, [uid, onNavigate]);

  const clearRoute = useCallback(() => {
    pendingLink.current = undefined;
    clearBusinessHash();
    setEntry((current) => ({ ...current, initiativeId: undefined }));
  }, []);

  const createAnnouncement = useCallback((draft: BusinessAnnouncementDraft) => {
    if (businessFeatureAvailable && uid && previousUid.current === uid) {
      setEntry((current) => ({ ...(current.uid === uid ? current : {}), uid, draft }));
    }
  }, [uid]);

  return {
    initialInitiativeId: entry.uid === uid ? entry.initiativeId : undefined,
    announcementDraft: uid && entry.uid === uid ? entry.draft : undefined,
    createAnnouncement,
    clearRoute
  };
}

class BusinessBoundary extends Component<{ children: ReactNode; onRetry: () => void; locale: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="card" role="alert">
      <p>{this.props.locale === "ja" ? "会社の取り組みを表示できませんでした。再試行してください。" : "无法显示公司事项，请重试。"}</p>
      <button type="button" className="button primary" onClick={this.props.onRetry}>{this.props.locale === "ja" ? "再試行" : "重试"}</button>
    </section>;
  }
}

const loadBusinessPage = () => lazy(() => import("../features/business/BusinessPage"));

export function BusinessFeatureEntry(props: { profile: UserProfile; onCreateAnnouncement: (draft: BusinessAnnouncementDraft) => void; initialInitiativeId?: string }) {
  const { locale } = useI18n();
  const [Page, setPage] = useState(loadBusinessPage);
  const [attempt, setAttempt] = useState(0);
  if (!businessFeatureAvailable) return null;
  return <BusinessBoundary key={attempt} locale={locale} onRetry={() => { setPage(loadBusinessPage); setAttempt((current) => current + 1); }}>
    <Suspense fallback={<section className="card" role="status">{locale === "ja" ? "会社の取り組みを読み込んでいます…" : "正在加载公司事项…"}</section>}>
      <Page {...props} key={props.profile.uid} />
    </Suspense>
  </BusinessBoundary>;
}
