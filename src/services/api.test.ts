import { markDailyReportCommentsRead } from "./api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  prepare: vi.fn(),
  httpsCallable: vi.fn(),
  uploadBytes: vi.fn(),
  storageRef: vi.fn(),
  onSnapshot: vi.fn(),
  unsubscribe: vi.fn()
}));

vi.mock("firebase/firestore", async (importOriginal) => ({
  ...await importOriginal<typeof import("firebase/firestore")>(),
  collection: (_db: unknown, path: string) => ({ path }),
  where: (field: string, operator: string, value: unknown) => ({ field, operator, value }),
  query: (reference: unknown, ...constraints: unknown[]) => ({ reference, constraints }),
  onSnapshot: mocks.onSnapshot
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mocks.httpsCallable
}));

vi.mock("firebase/storage", () => ({
  getDownloadURL: vi.fn(),
  ref: mocks.storageRef,
  uploadBytes: mocks.uploadBytes
}));

vi.mock("../firebase", () => ({
  db: {},
  functions: {},
  prepareCallableSecurityContext: mocks.prepare,
  storage: {}
}));

import { acknowledgePresidentInstruction, clockIn, completeInitialPasswordChange, correctAttendance, createPresidentInstruction, generateReportDraft, remindPresidentInstruction, replacePresidentInstruction, uploadPresidentInstructionFiles, watchEvidenceReferences } from "./api";
import type { Attachment, UserProfile } from "../types";

describe("callable authentication", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prepare.mockResolvedValue(undefined);
    mocks.httpsCallable.mockImplementation((_functions, name: string) =>
      (input: unknown) => mocks.invoke(name, input)
    );
  });

  it("verifies the security context before sending the unchanged initial password", async () => {
    mocks.invoke.mockImplementation(async () => {
      expect(mocks.prepare).toHaveBeenCalledWith(false);
      return { data: { success: true } };
    });
    await expect(completeInitialPasswordChange({ newPassword: " new password " })).resolves.toEqual({ success: true });
    expect(mocks.invoke).toHaveBeenCalledWith("completeInitialPasswordChange", { newPassword: " new password " });
  });

  it("verifies credentials and recovers an expired session before reminding recipients", async () => {
    mocks.invoke
      .mockRejectedValueOnce(Object.assign(new Error("Unauthenticated"), { code: "functions/unauthenticated" }))
      .mockResolvedValueOnce({ data: { ok: true, recipientCount: 2 } });
    await expect(remindPresidentInstruction("notice-1")).resolves.toEqual({ ok: true, recipientCount: 2 });
    expect(mocks.prepare.mock.calls).toEqual([[false], [true]]);
    expect(mocks.invoke.mock.calls).toEqual([
      ["remindPresidentInstruction", { instructionId: "notice-1" }],
      ["remindPresidentInstruction", { instructionId: "notice-1" }]
    ]);
  });

  it("does not send a reminder when security preparation is blocked", async () => {
    const error = Object.assign(new Error("App Check throttled"), { code: "appCheck/throttled" });
    mocks.prepare.mockRejectedValueOnce(error);
    await expect(remindPresidentInstruction("notice-1")).rejects.toBe(error);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("refreshes expired credentials and retries a manual clock-in once", async () => {
    const manual = {
      startedAt: "2026-09-01T23:04:00.000Z",
      reason: "始業打刻を忘れたため"
    };
    mocks.invoke
      .mockRejectedValueOnce(Object.assign(new Error("Unauthenticated"), { code: "functions/unauthenticated" }))
      .mockResolvedValueOnce({ data: { id: "attendance-1" } });

    await expect(clockIn("office", manual)).resolves.toBe("attendance-1");

    expect(mocks.prepare.mock.calls).toEqual([[false], [true]]);
    expect(mocks.invoke.mock.calls).toEqual([
      ["clockIn", { workMode: "office", ...manual }],
      ["clockIn", { workMode: "office", ...manual }]
    ]);
  });

  it("prepares credentials before generating a daily report", async () => {
    const draft = { activities: "資料を確認した。" };
    mocks.invoke.mockImplementation(async () => {
      expect(mocks.prepare).toHaveBeenCalledWith(false);
      return { data: draft };
    });

    await expect(generateReportDraft("2026-09-07", "ja", false)).resolves.toBe(draft);

    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "generateDailyReportDraft", { timeout: 180_000 });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it.each(["appCheck/throttled", "appCheck/initial-throttle"])("does not submit a missed clock-out while authentication is blocked by %s", async (code) => {
    const error = Object.assign(new Error("Requests throttled due to previous 403 error"), { code });
    mocks.prepare.mockRejectedValueOnce(error);

    await expect(correctAttendance({
      id: "attendance-previous-day",
      startedAt: "2026-09-10T20:52:00.000Z",
      endedAt: "2026-09-11T09:30:00.000Z",
      reason: "前日の終業打刻を忘れたため",
      correctionKind: "missed_clock_out"
    })).rejects.toBe(error);

    expect(mocks.prepare.mock.calls).toEqual([[false]]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("sends the selected previous-day clock-out unchanged after authentication recovers", async () => {
    const input = {
      id: "attendance-previous-day",
      startedAt: "2026-09-10T20:52:00.000Z",
      endedAt: "2026-09-11T09:30:00.000Z",
      reason: "前日の終業打刻を忘れたため",
      correctionKind: "missed_clock_out" as const
    };
    mocks.invoke.mockImplementation(async () => {
      expect(mocks.prepare.mock.calls).toEqual([[false]]);
      return { data: { ok: true } };
    });

    await expect(correctAttendance(input)).resolves.toBeUndefined();
    expect(mocks.invoke.mock.calls).toEqual([["correctAttendance", input]]);
  });

  it("refreshes credentials and retries daily report generation once after an authentication failure", async () => {
    const draft = { activities: "資料を確認した。" };
    const input = { reportDate: "2026-09-07", sourceLanguage: "ja", hasTravel: false };
    mocks.invoke
      .mockRejectedValueOnce(Object.assign(new Error("Unauthenticated"), { code: "functions/unauthenticated" }))
      .mockResolvedValueOnce({ data: draft });

    await expect(generateReportDraft(input.reportDate, "ja", input.hasTravel)).resolves.toBe(draft);

    expect(mocks.prepare.mock.calls).toEqual([[false], [true]]);
    expect(mocks.invoke.mock.calls).toEqual([
      ["generateDailyReportDraft", input],
      ["generateDailyReportDraft", input]
    ]);
  });

  it("recovers an App Check preparation failure before sending the daily report request", async () => {
    const draft = { activities: "資料を確認した。" };
    mocks.prepare
      .mockRejectedValueOnce(Object.assign(new Error("Network error"), { code: "appCheck/fetch-network-error" }))
      .mockResolvedValueOnce(undefined);
    mocks.invoke.mockResolvedValueOnce({ data: draft });

    await expect(generateReportDraft("2026-09-07", "ja", false)).resolves.toBe(draft);

    expect(mocks.prepare.mock.calls).toEqual([[false], [true]]);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not send the daily report request if App Check preparation still fails", async () => {
    const error = Object.assign(new Error("Network error"), { code: "appCheck/fetch-network-error" });
    mocks.prepare.mockRejectedValue(error);

    await expect(generateReportDraft("2026-09-07", "ja", false)).rejects.toBe(error);

    expect(mocks.prepare.mock.calls).toEqual([[false], [true]]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("stops after a repeated daily report authentication failure", async () => {
    const error = Object.assign(new Error("Unauthenticated"), { code: "functions/unauthenticated" });
    mocks.invoke.mockRejectedValue(error);

    await expect(generateReportDraft("2026-09-07", "ja", false)).rejects.toBe(error);

    expect(mocks.prepare.mock.calls).toEqual([[false], [true]]);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("does not repeat daily report generation for unrelated errors", async () => {
    const error = Object.assign(new Error("添付資料を確認してください。"), { code: "functions/invalid-argument" });
    mocks.invoke.mockRejectedValue(error);

    await expect(generateReportDraft("2026-09-07", "ja", false)).rejects.toBe(error);

    expect(mocks.prepare.mock.calls).toEqual([[false]]);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});

describe("president instruction callable authentication", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prepare.mockResolvedValue(undefined);
    mocks.httpsCallable.mockImplementation((_functions, name: string) =>
      (input: unknown) => mocks.invoke(name, input)
    );
  });

  it("refreshes expired credentials and retries acknowledgement once", async () => {
    mocks.invoke
      .mockRejectedValueOnce(Object.assign(new Error("Unauthenticated"), { code: "functions/unauthenticated" }))
      .mockResolvedValueOnce({ data: { ok: true } });

    await expect(acknowledgePresidentInstruction("instruction-1")).resolves.toBeUndefined();

    expect(mocks.prepare.mock.calls).toEqual([[false], [true]]);
    expect(mocks.invoke.mock.calls).toEqual([
      ["acknowledgePresidentInstruction", { instructionId: "instruction-1" }],
      ["acknowledgePresidentInstruction", { instructionId: "instruction-1" }]
    ]);
  });

  it.each(["create", "replace"] as const)("prepares credentials before %s and keeps its instruction ID on retry", async (operation) => {
    const input = { instructionId: "draft-id", title: "資料", body: "資料を確認してください", priority: "normal" as const, dueDate: "", recipientIds: ["recipient"], attachments: [] };
    const result = { id: input.instructionId, translationStatus: "completed" };
    mocks.invoke
      .mockRejectedValueOnce(Object.assign(new Error("Unauthenticated"), { code: "functions/unauthenticated" }))
      .mockResolvedValueOnce({ data: result });

    await expect(operation === "create"
      ? createPresidentInstruction(input)
      : replacePresidentInstruction("old-id", "内容を訂正", input)).resolves.toEqual(result);

    expect(mocks.prepare.mock.calls).toEqual([[false], [true]]);
    expect(mocks.invoke.mock.calls[0]).toEqual(mocks.invoke.mock.calls[1]);
    expect(mocks.invoke).toHaveBeenCalledWith(
      operation === "create" ? "createPresidentInstruction" : "replacePresidentInstruction",
      operation === "create" ? input : { instructionId: "old-id", reason: "内容を訂正", replacement: input }
    );
  });
});

describe("president instruction attachment uploads", () => {
  const profile = { uid: "author", role: "employee", displayName: "発信者", active: true } as UserProfile;
  const files = [443 * 1024, Math.round(1.1 * 1024 * 1024), Math.round(8.1 * 1024 * 1024)]
    .map((size, index) => new File([new Uint8Array(size)], `catalog-${index + 1}.pdf`, { type: "application/pdf" }));

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prepare.mockResolvedValue(undefined);
    mocks.storageRef.mockImplementation((_storage, path: string) => ({ fullPath: path }));
    mocks.uploadBytes.mockResolvedValue({});
  });

  it("verifies credentials before uploading three PDFs within the displayed limits", async () => {
    const onUploaded = vi.fn();
    const onProgress = vi.fn();
    mocks.prepare.mockImplementation(async () => {
      expect(mocks.uploadBytes).not.toHaveBeenCalled();
    });

    const attachments = await uploadPresidentInstructionFiles(profile, "draft-id", files, [], { onUploaded, onProgress });

    expect(mocks.prepare.mock.calls).toEqual([[false]]);
    expect(mocks.uploadBytes).toHaveBeenCalledTimes(3);
    expect(attachments.map(({ name, size }) => ({ name, size }))).toEqual(files.map(({ name, size }) => ({ name, size })));
    expect(onProgress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(onUploaded.mock.calls.map(([attachment]) => attachment)).toEqual(attachments);
    for (let index = 0; index < files.length; index += 1) {
      expect(mocks.uploadBytes.mock.calls[index]).toEqual([
        { fullPath: attachments[index].storagePath }, files[index],
        { contentType: "application/pdf", customMetadata: { ownerId: profile.uid, instructionId: "draft-id" } }
      ]);
    }
  });

  it("does not start uploads or retry when App Check rejects preparation", async () => {
    const error = Object.assign(new Error("Requests throttled"), { code: "appCheck/throttled" });
    const onUploaded = vi.fn();
    mocks.prepare.mockRejectedValueOnce(error);

    await expect(uploadPresidentInstructionFiles(profile, "draft-id", files, [], { onUploaded })).rejects.toBe(error);

    expect(mocks.prepare.mock.calls).toEqual([[false]]);
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("reports each successful attachment before a later failure so only remaining files need retrying", async () => {
    const saved: Attachment[] = [];
    const error = new Error("upload interrupted");
    mocks.uploadBytes.mockResolvedValueOnce({}).mockRejectedValueOnce(error);

    await expect(uploadPresidentInstructionFiles(profile, "draft-id", files, [], { onUploaded: (attachment) => saved.push(attachment) })).rejects.toBe(error);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe(files[0].name);

    const remaining = await uploadPresidentInstructionFiles(profile, "draft-id", files.slice(1), saved);
    expect([...saved, ...remaining].map((attachment) => attachment.name)).toEqual(files.map((file) => file.name));
    expect(mocks.uploadBytes.mock.calls.map(([, file]) => file.name)).toEqual([files[0].name, files[1].name, files[1].name, files[2].name]);
  });

  it("rejects a document above 10 MB before authentication or uploads", async () => {
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" });

    await expect(uploadPresidentInstructionFiles(profile, "draft-id", [oversized], [])).rejects.toThrow("10MB以下");

    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
  });
});

describe("evidence reference subscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onSnapshot.mockReturnValue(mocks.unsubscribe);
  });

  it.each([
    { role: "employee", canViewAll: false, constraints: [
      { field: "subjectUserId", operator: "==", value: "employee-1" },
      { field: "visibility", operator: "==", value: "work" }
    ] },
    { role: "employee_manager", canViewAll: true, constraints: [] },
    { role: "president_viewer", canViewAll: true, constraints: [] }
  ])("uses the permitted evidence scope for $role", ({ canViewAll, constraints }) => {
    watchEvidenceReferences("employee-1", canViewAll, vi.fn());

    expect(mocks.onSnapshot.mock.calls[0][0]).toEqual({
      reference: { path: "evidenceReferences" },
      constraints
    });
  });

  it("delivers document IDs and empty snapshots and returns the listener cleanup", () => {
    const onRows = vi.fn();
    const stop = watchEvidenceReferences("employee-1", false, onRows);
    const onSnapshot = mocks.onSnapshot.mock.calls[0][1];

    onSnapshot({ docs: [{ id: "work-1", data: () => ({ title: "業務資料" }) }] });
    onSnapshot({ docs: [] });

    expect(onRows.mock.calls).toEqual([
      [[{ id: "work-1", title: "業務資料" }]],
      [[]]
    ]);
    expect(stop).toBe(mocks.unsubscribe);
    stop();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("forwards a denied subscription without reporting an empty successful result", () => {
    const onRows = vi.fn();
    const onError = vi.fn();
    const error = Object.assign(new Error("Permission denied"), { code: "permission-denied" });
    watchEvidenceReferences("employee-1", false, onRows, onError);

    mocks.onSnapshot.mock.calls[0][2](error);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
    expect(onRows).not.toHaveBeenCalled();
  });
});

describe("daily report reply confirmation API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prepare.mockResolvedValue(undefined);
    mocks.httpsCallable.mockImplementation((_functions, name: string) => (input: unknown) => mocks.invoke(name, input));
  });
  it("does not save acknowledgement while App Check is blocked", async () => {
    mocks.prepare.mockRejectedValueOnce(Object.assign(new Error("throttled"), { code: "appCheck/throttled" }));
    await expect(markDailyReportCommentsRead("r1", ["c1"])).rejects.toThrow("throttled");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("prepares credentials and retries an expired session with the same displayed IDs", async () => {
    mocks.invoke.mockRejectedValueOnce(Object.assign(new Error("Unauthenticated"), { code: "functions/unauthenticated" })).mockResolvedValueOnce({ data: { ok: true } });
    await markDailyReportCommentsRead("r1", ["c1"]);
    expect(mocks.prepare.mock.calls).toEqual([[false], [true]]);
    expect(mocks.invoke.mock.calls).toEqual([["markDailyReportCommentsRead", { reportId: "r1", commentIds: ["c1"] }], ["markDailyReportCommentsRead", { reportId: "r1", commentIds: ["c1"] }]]);
  });
});
