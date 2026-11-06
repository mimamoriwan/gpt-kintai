import { httpsCallable } from "firebase/functions";
import { auth, functions, prepareCallableSecurityContext } from "../../firebase";
import type { GenerateInput, GenerateProgress, GenerateResult } from "./aiModel";

// The installed Firebase SDK does not apply callable timeouts to streaming calls.
// Keep this beyond the server's work deadline and hard function timeout.
export const MEETING_RESUME_BROWSER_TIMEOUT_MS = 1_920_000;
const FINAL_RESULT_GRACE_MS = 1_000;

export async function generateMeetingResume(input: GenerateInput, progress: (event: GenerateProgress) => void, signal: AbortSignal): Promise<GenerateResult> {
  const user = auth.currentUser;
  if (!user) throw new Error("ログインが必要です。");
  const active = new AbortController();
  let deadlineReached = false, completed = false;
  let finalTimer: ReturnType<typeof setTimeout> | undefined;
  const localError = (code: string, ja: string, zh: string) => Object.assign(new Error(input.locale === "ja" ? ja : zh), { code });
  const cancelled = () => deadlineReached
    ? localError("functions/deadline-exceeded", "会議資料の作成が制限時間に達しました。現在の資料は保持しています。期間または対象を分けて再作成してください。", "会议资料创建已达到时间上限，已保留当前资料。请缩短期间或拆分对象后重试。")
    : new DOMException("会議資料の作成を中止しました。", "AbortError");
  let abortListener!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abortListener = () => reject(cancelled());
    active.signal.addEventListener("abort", abortListener, { once: true });
  });
  const forwardAbort = () => active.abort();
  signal.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => { deadlineReached = true; active.abort(); }, MEETING_RESUME_BROWSER_TIMEOUT_MS);
  const wait = <T,>(promise: Promise<T>) => Promise.race([promise, aborted]);
  const sameAccount = () => {
    if (auth.currentUser !== user) throw new Error("ログイン中のアカウントが変更されました。");
  };
  try {
    if (signal.aborted) throw cancelled();
    await wait(prepareCallableSecurityContext(false));
    sameAccount();
    const callable = httpsCallable<GenerateInput, GenerateResult, GenerateProgress>(functions, "generateMeetingResume", { timeout: MEETING_RESUME_BROWSER_TIMEOUT_MS });
    const result = await wait(callable.stream(input, { signal: active.signal }).then(response => ({
      stream: response.stream,
      // The SDK can resolve stream() with a rejected data promise after cancellation.
      // Attach this handler even if our deadline has already won the race.
      data: response.data.then(value => ({ value }), error => ({ error }))
    })));
    // Handle final rejection while consuming progress; neither a stalled stream nor a
    // missing final frame may keep the editor busy forever.
    const data = result.data;
    const iterator = result.stream[Symbol.asyncIterator]();
    while (true) {
      const item = await wait(iterator.next());
      if (item.done) break;
      sameAccount(); progress(item.value);
    }
    sameAccount();
    const missingFinal = new Promise<never>((_, reject) => {
      finalTimer = setTimeout(() => reject(localError("functions/unavailable", "作成結果を受信する前に通信が終了しました。現在の資料は保持しています。通信状態を確認して再作成してください。", "在收到创建结果前连接已结束，已保留当前资料。请检查网络后重试。")), FINAL_RESULT_GRACE_MS);
    });
    const final = await wait(Promise.race([data, missingFinal]));
    sameAccount();
    if ("error" in final) throw final.error;
    completed = true;
    return final.value;
  } finally {
    clearTimeout(timer);
    if (finalTimer !== undefined) clearTimeout(finalTimer);
    signal.removeEventListener("abort", forwardAbort);
    active.signal.removeEventListener("abort", abortListener);
    if (!completed) active.abort();
  }
}
