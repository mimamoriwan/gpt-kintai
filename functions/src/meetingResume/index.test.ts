import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ owner: vi.fn(), collect: vi.fn(), pipeline: vi.fn(), ask: vi.fn(), secret: vi.fn(() => "test-placeholder"), options: {} as any, rows: new Map<string, any>() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({}) }));
vi.mock("firebase-admin/firestore", () => ({ Timestamp: { fromMillis: (n: number) => ({ toMillis: () => n }) }, getFirestore: () => ({
  doc: (path: string) => ({ path, get: async () => ({ data: () => mock.rows.get(path) }) }),
  runTransaction: async (work: any) => work({ get: async (ref: any) => ({ data: () => mock.rows.get(ref.path) }), set: (ref: any, data: any) => mock.rows.set(ref.path, data), delete: (ref: any) => mock.rows.delete(ref.path) })
}) }));
vi.mock("firebase-functions/params", () => ({ defineSecret: () => ({ value: mock.secret }) }));
vi.mock("firebase-functions/v2/https", async original => ({ ...await original<any>(), onCall: (options: any, handler: any) => { mock.options = options; return handler; } }));
vi.mock("../accountRecovery.js", () => ({ getAccountManagement: mock.owner }));
vi.mock("./collect.js", () => ({ collectEvidence: mock.collect }));
vi.mock("./pipeline.js", () => ({ generateBrief: mock.pipeline }));
vi.mock("./openai.js", () => ({ createMeetingAsk: mock.ask }));
vi.mock("firebase-functions/logger", () => ({ error: vi.fn() }));
import { generateMeetingResume } from "./index.js";
import { BriefValidationError } from "./domain.js";
import { error as logError } from "firebase-functions/logger";
const invoke = generateMeetingResume as unknown as (request: any, response?: any) => Promise<any>;
const input = { periodStart: "2026-10-01", periodEnd: "2026-10-28", userId: "", locale: "ja", sources: { daily: true, business: false, todo: true } };
beforeEach(() => {
  vi.clearAllMocks(); mock.rows.clear(); mock.owner.mockResolvedValue({ canManage: true });
  mock.collect.mockResolvedValue({ sources: [{ id: "S001" }], notices: [] }); mock.pipeline.mockResolvedValue({ headline: "結果" }); mock.ask.mockReturnValue(vi.fn());
});
describe("owner-only AI endpoint", () => {
  it("logs safe validation codes, withholds invalid content, and releases its lease", async () => {
    const validationIssues = [{ code: "unsupported_timeline_date" as const, path: "timeline[0].date" }];
    mock.pipeline.mockRejectedValueOnce(new BriefValidationError(validationIssues));
    await expect(invoke({ auth: { uid: "owner" }, data: input })).rejects.toMatchObject({ code: "data-loss", details: { validationIssues } });
    expect(logError).toHaveBeenCalledWith("meeting_resume_failed", expect.objectContaining({ validationIssues }));
    expect(mock.rows.size).toBe(0);
  });
  it("keeps the lease beyond the old 550 seconds and releases it after long generation", async () => {
    const now = Date.now();
    mock.pipeline.mockImplementationOnce(async () => {
      expect(mock.rows.get("meetingResumeLocks/owner").expiresAt.toMillis()).toBeGreaterThanOrEqual(now + 1920000);
      return { headline: "long result" };
    });
    await invoke({ auth: { uid: "owner" }, data: input });
    expect(mock.rows.has("meetingResumeLocks/owner")).toBe(false);
  });
  it("releases its lease on a stage timeout while preserving a replacement lease", async () => {
    const { HttpsError } = await import("firebase-functions/v2/https");
    mock.pipeline.mockRejectedValueOnce(new HttpsError("deadline-exceeded", "資料の構成に時間がかかりました"));
    await expect(invoke({ auth: { uid: "owner" }, data: input })).rejects.toMatchObject({ code: "deadline-exceeded" });
    expect(mock.rows.size).toBe(0);
    mock.pipeline.mockImplementationOnce(async () => { mock.rows.set("meetingResumeLocks/owner", { leaseId: "replacement" }); throw Error("failure"); });
    await expect(invoke({ auth: { uid: "owner" }, data: input })).rejects.toMatchObject({ code: "unavailable" });
    expect(mock.rows.get("meetingResumeLocks/owner").leaseId).toBe("replacement");
  });
  it("enforces App Check in production and binds the existing server secret", () => {
    expect(mock.options.enforceAppCheck).toBe(true); expect(mock.options.secrets).toHaveLength(1);
    expect(mock.options.concurrency).toBe(5); expect(mock.options.timeoutSeconds).toBe(1860);
  });
  it("denies role-only managers before collecting records or using AI", async () => {
    mock.owner.mockResolvedValue({ canManage: false });
    await expect(invoke({ auth: { uid: "other-manager" }, data: input })).rejects.toMatchObject({ code: "permission-denied" });
    expect(mock.collect).not.toHaveBeenCalled(); expect(mock.secret).not.toHaveBeenCalled(); expect(mock.ask).not.toHaveBeenCalled();
  });
  it("validates date ranges and forbids client-supplied records", async () => {
    for (const data of [{ ...input, periodStart: "2026-02-30" }, { ...input, injectedSources: [] }, { ...input, periodEnd: "2027-11-30" }]) await expect(invoke({ auth: { uid: "owner" }, data })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mock.collect).not.toHaveBeenCalled();
  });
  it("streams stages, rechecks authority, returns the actual AI result and releases its lease", async () => {
    const sendChunk = vi.fn(async () => true);
    const result = await invoke({ auth: { uid: "owner" }, data: input }, { sendChunk, signal: new AbortController().signal });
    expect(result.model).toBe("gpt-6.1-sol"); expect(result.brief.headline).toBe("結果"); expect(sendChunk).toHaveBeenCalledWith({ stage: "collecting" });
    expect(mock.owner).toHaveBeenCalledTimes(2); expect(mock.rows.has("meetingResumeLocks/owner")).toBe(false);
  });
  it("withholds all content if ownership is revoked during generation", async () => {
    mock.owner.mockResolvedValueOnce({ canManage: true }).mockResolvedValueOnce({ canManage: false });
    await expect(invoke({ auth: { uid: "owner" }, data: input })).rejects.toMatchObject({ code: "permission-denied" });
    expect(mock.rows.size).toBe(0);
  });
  it("blocks a second concurrent request without making another AI call", async () => {
    mock.rows.set("meetingResumeLocks/owner", { leaseId: "other", expiresAt: { toMillis: () => Date.now() + 100000 } });
    await expect(invoke({ auth: { uid: "owner" }, data: input })).rejects.toMatchObject({ code: "already-exists" });
    expect(mock.pipeline).not.toHaveBeenCalled();
  });
  it("does not return business records after sharing was revoked", async () => {
    await expect(invoke({ auth: { uid: "owner" }, data: { ...input, sources: { ...input.sources, business: true } } })).rejects.toMatchObject({ code: "permission-denied" });
    expect(mock.rows.size).toBe(0);
  });
});
