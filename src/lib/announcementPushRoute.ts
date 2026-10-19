import { useCallback, useEffect, useState } from "react";

export function announcementIdFromHash(hash: string): string | null {
  const match = /^#announcement=([A-Za-z0-9_-]{1,128})$/.exec(hash);
  return match?.[1] || null;
}
export function useAnnouncementPushRoute() {
  const [instructionId, setInstructionId] = useState(() => announcementIdFromHash(window.location.hash));
  useEffect(() => {
    const capture = () => setInstructionId(announcementIdFromHash(window.location.hash));
    const receive = (event: MessageEvent) => {
      const id = event.data?.instructionId;
      if (event.data?.type === "OPEN_ANNOUNCEMENT" && typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#announcement=${id}`);
        setInstructionId(id);
      }
    };
    window.addEventListener("hashchange", capture);
    navigator.serviceWorker?.addEventListener("message", receive);
    return () => { window.removeEventListener("hashchange", capture); navigator.serviceWorker?.removeEventListener("message", receive); };
  }, []);
  const clear = useCallback(() => {
    if (announcementIdFromHash(window.location.hash)) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setInstructionId(null);
  }, []);
  return { instructionId, clear };
}
