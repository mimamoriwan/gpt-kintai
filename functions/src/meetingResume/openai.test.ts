import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ create: vi.fn(), config: {} as any }));
vi.mock("openai", async original => {
  const real = await original<any>();
  return { default: class {
    static APIConnectionTimeoutError = real.default.APIConnectionTimeoutError;
    responses = { create: mock.create }; constructor(config: any) { mock.config = config; }
  } };
});
import { createMeetingAsk } from "./openai.js";
import { auditSchema } from "./domain.js";
import { AI_TIMEOUT_MS } from "./limits.js";
const request = { name: "meeting_brief" as const, instruction: "audit", data: { sources: [] }, schema: auditSchema, effort: "high" as const };
const complete = (text = '{"passed":true,"issues":[]}') => ({ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] } });
const stream = (...events: any[]) => (async function* () { yield* events; })();
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });
describe("OpenAI streaming contract", () => {
  it("keeps high-quality structured output private and accepts only the completed event", async () => {
    mock.create.mockResolvedValue(stream({ type: "response.output_text.delta", delta: 'unverified partial' }, complete()));
    const signal = new AbortController().signal;
    expect(await createMeetingAsk("placeholder-test-token", "owner", signal)(request)).toEqual({ passed: true, issues: [] });
    const [body, options] = mock.create.mock.calls[0];
    expect(body).toMatchObject({ model: "gpt-6.1-sol", reasoning: { effort: "high" }, stream: true, store: false, max_output_tokens: 24000, text: { format: { type: "json_schema", strict: true } } });
    expect(body.text.format.schema.additionalProperties).toBe(false); expect(body.safety_identifier).not.toBe("owner");
    expect(mock.config.maxRetries).toBe(0); expect(options.timeout).toBe(AI_TIMEOUT_MS.meeting_brief);
  });
  it("allows a composition to finish after the former 150-second cutoff", async () => {
    vi.useFakeTimers();
    mock.create.mockImplementation(async (_: any, { signal }: any) => (async function* () { await wait(151000, signal); yield complete(); })());
    let settled = false;
    const pending = createMeetingAsk("placeholder", "owner", new AbortController().signal)(request).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(150000); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1000); expect(await pending).toEqual({ passed: true, issues: [] });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds the entire stream, names the timed-out stage and never retries the paid call", async () => {
    vi.useFakeTimers();
    mock.create.mockImplementation(async (_: any, { signal }: any) => (async function* () { await wait(700000, signal); yield complete(); })());
    const check = expect(createMeetingAsk("placeholder", "owner", new AbortController().signal)(request)).rejects.toMatchObject({ code: "deadline-exceeded", message: expect.stringContaining("資料の構成") });
    await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS.meeting_brief); await check;
    expect(mock.create).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("propagates cancellation and does not start calls after the overall budget expires", async () => {
    vi.useFakeTimers(); const parent = new AbortController();
    mock.create.mockImplementation(async (_: any, { signal }: any) => (async function* () { await wait(700000, signal); yield complete(); })());
    const reason = new Error("overall-stop");
    const check = expect(createMeetingAsk("placeholder", "owner", parent.signal)(request)).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(1); parent.abort(reason); await check;
    await expect(createMeetingAsk("placeholder", "owner", parent.signal)(request)).rejects.toBe(reason);
    expect(mock.create).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    [[], "unavailable"],
    [[{ type: "response.output_text.delta", delta: '{"passed":true}' }], "unavailable"],
    [[{ type: "response.incomplete" }], "data-loss"],
    [[{ type: "response.failed" }], "unavailable"],
    [[complete("")], "data-loss"],
    [[complete("invalid json")], "data-loss"]
  ])("rejects missing, incomplete, failed or malformed completed outputs", async (events, code) => {
    mock.create.mockResolvedValue(stream(...events as any[]));
    await expect(createMeetingAsk("placeholder", "owner", new AbortController().signal)(request)).rejects.toMatchObject({ code });
  });
});
