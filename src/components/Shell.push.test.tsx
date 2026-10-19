import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./Shell";
const f = vi.hoisted(() => ({ get: vi.fn(), uid: "owner" }));
vi.mock("../auth", () => ({ useAuth: () => ({ profile: { uid: f.uid, role: "employee", active: true }, logout: vi.fn() }) }));
vi.mock("../i18n", () => ({ useI18n: () => ({ locale: "ja", t: (value: string) => value, setLocale: vi.fn() }) }));
vi.mock("../services/api", () => ({ getAnnouncementForNotification: f.get }));
vi.mock("../features/business/api", () => ({ businessFeatureAvailable: false }));
vi.mock("./AppUpdateNotice", () => ({ AppUpdateNotice: () => null }));
vi.mock("./AppCheckRecoveryNotice", () => ({ AppCheckRecoveryNotice: () => null }));
vi.mock("./InstructionReminder", () => ({ InstructionReminder: () => null }));
vi.mock("./PresidentInstructions", () => ({
  InstructionBanner: () => null, InstructionShortcut: () => null,
  InstructionCenter: ({ open, selectedInstructionId, instructions }: any) => open ? <div role="dialog">{selectedInstructionId}:{instructions.length}</div> : null
}));
beforeEach(() => { f.uid = "owner"; f.get.mockReset(); f.get.mockResolvedValue({ id: "post", authorId: "author", recipientIds: ["owner"], isDemo: false }); });
afterEach(cleanup);
describe("opening an announcement notification", () => {
  function show() {
    const handled = vi.fn(), notify = vi.fn();
    const view = render(<Shell section="report" onSection={vi.fn()} instructions={[]} users={[]} notify={notify} notificationInstructionId="post" onNotificationHandled={handled}><input defaultValue="unsaved text" aria-label="draft" /></Shell>);
    return { handled, notify, ...view };
  }
  it("opens the exact authorized post even before the list arrives without acknowledging or losing input", async () => {
    const f = show();
    expect(await screen.findByRole("dialog")).toHaveTextContent("post:1");
    expect(screen.getByLabelText("draft")).toHaveValue("unsaved text");
    expect(f.handled).toHaveBeenCalledOnce(); expect(f.notify).not.toHaveBeenCalled();
  });
  it.each(["missing", "not-recipient", "demo"])("rejects %s posts and explains failure", async kind => {
    if (kind === "missing") f.get.mockRejectedValue(new Error("not-found"));
    else f.get.mockResolvedValue({ id: "post", authorId: "author", recipientIds: kind === "not-recipient" ? ["other"] : ["owner"], isDemo: kind === "demo" });
    const state = show();
    await waitFor(() => expect(state.handled).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state.notify).toHaveBeenCalledWith("error", expect.stringContaining("対象のお知らせを開けません"));
  });
});
