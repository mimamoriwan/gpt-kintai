import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiFixture } from "./__fixtures__/ai";
const mock = vi.hoisted(() => ({ auth: { currentUser: { uid: "owner" } as { uid: string } | null }, prepare: vi.fn(), stream: vi.fn(), callable: vi.fn() }));
vi.mock("../../firebase", () => ({ auth: mock.auth, functions: {}, prepareCallableSecurityContext: mock.prepare }));
vi.mock("firebase/functions", () => ({ httpsCallable: mock.callable }));
import { generateMeetingResume, MEETING_RESUME_BROWSER_TIMEOUT_MS } from "./api";
beforeEach(() => { vi.clearAllMocks(); mock.auth.currentUser = { uid: "owner" }; mock.prepare.mockResolvedValue(undefined); mock.callable.mockReturnValue({ stream: mock.stream }); });
afterEach(() => { vi.useRealTimers(); });
describe("authenticated AI streaming client", () => {
  it("delivers real stage events and the final artifact with the request's abort signal", async () => {
    const value = aiFixture(), events = [{ stage: "reading", current: 1, total: 1 }, { stage: "checking" }];
    mock.stream.mockResolvedValue({ stream: (async function* () { yield* events; })(), data: Promise.resolve(value) });
    const signal = new AbortController().signal, progress = vi.fn();
    expect(await generateMeetingResume(value.input, progress, signal)).toBe(value);
    expect(progress.mock.calls.map(([event]) => event)).toEqual(events);
    expect(mock.stream).toHaveBeenCalledWith(value.input, { signal: expect.any(AbortSignal) }); expect(mock.prepare.mock.invocationCallOrder[0]).toBeLessThan(mock.stream.mock.invocationCallOrder[0]);
    expect(mock.callable.mock.calls[0][1]).toBe("generateMeetingResume");
  });
  it("does not start generation without authentication or a valid security context", async () => {
    mock.auth.currentUser = null;
    await expect(generateMeetingResume(aiFixture().input, vi.fn(), new AbortController().signal)).rejects.toThrow("ログイン");
    mock.auth.currentUser = { uid: "owner" }; mock.prepare.mockRejectedValue(new Error("appcheck"));
    await expect(generateMeetingResume(aiFixture().input, vi.fn(), new AbortController().signal)).rejects.toThrow("appcheck"); expect(mock.stream).not.toHaveBeenCalled();
  });
  it("never returns a previous account's artifact after the final data await", async () => {
    let resolve!: (value: ReturnType<typeof aiFixture>) => void;
    mock.stream.mockResolvedValue({ stream: (async function* () {})(), data: new Promise(done => { resolve = done; }) });
    const pending = generateMeetingResume(aiFixture().input, vi.fn(), new AbortController().signal);
    await vi.waitFor(() => expect(mock.stream).toHaveBeenCalledOnce());
    mock.auth.currentUser = { uid: "other" }; resolve(aiFixture());
    await expect(pending).rejects.toThrow("アカウントが変更");
  });
  it("propagates a failed final result without silently retrying a paid generation", async () => {
    mock.stream.mockResolvedValue({ stream: (async function* () {})(), data: Promise.reject(new Error("generation-failed")) });
    await expect(generateMeetingResume(aiFixture().input, vi.fn(), new AbortController().signal)).rejects.toThrow("generation-failed"); expect(mock.stream).toHaveBeenCalledOnce();
  });
  it("allows long composition beyond the previous limits and cleans up its own deadline", async () => {
    vi.useFakeTimers();
    const fixture = aiFixture();
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    mock.stream.mockResolvedValue({ stream: (async function* () { yield { stage: "composing" }; await done; })(), data: done.then(() => fixture) });
    const pending = generateMeetingResume(fixture.input, vi.fn(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mock.stream.mock.calls[0][1].signal.aborted).toBe(false);
    expect(mock.stream).toHaveBeenCalledOnce();
    finish(); expect(await pending).toBe(fixture);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts a stalled stream at the explicit browser deadline and reports a time limit", async () => {
    vi.useFakeTimers();
    mock.stream.mockResolvedValue({ stream: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) }, data: new Promise(() => undefined) });
    const pending = generateMeetingResume(aiFixture().input, vi.fn(), new AbortController().signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "functions/deadline-exceeded" });
    await vi.advanceTimersByTimeAsync(MEETING_RESUME_BROWSER_TIMEOUT_MS);
    await rejected;
    expect(mock.stream.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(mock.stream).toHaveBeenCalledOnce();
  });
  it("detects a closed stream without a final result instead of waiting indefinitely", async () => {
    vi.useFakeTimers();
    mock.stream.mockResolvedValue({ stream: (async function* () {})(), data: new Promise(() => undefined) });
    const pending = generateMeetingResume(aiFixture().input, vi.fn(), new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow("作成結果を受信する前に通信が終了");
    await vi.advanceTimersByTimeAsync(1_000); await rejected;
    expect(mock.stream.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("forwards user cancellation before stream setup finishes and handles the SDK's late rejected result", async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    mock.stream.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = generateMeetingResume(aiFixture().input, vi.fn(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(); await rejected;
    expect(mock.stream.mock.calls[0][1].signal.aborted).toBe(true);
    finish({ stream: (async function* () {})(), data: Promise.reject(new Error("SDK cancelled")) });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not start an already cancelled request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(generateMeetingResume(aiFixture().input, vi.fn(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mock.prepare).not.toHaveBeenCalled(); expect(mock.stream).not.toHaveBeenCalled();
  });
});
