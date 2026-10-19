import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { I18nProvider } from "./i18n";
import { getAppCheckRecoveryState, recordAppCheckError, recordAppCheckSuccess } from "./lib/appCheckRecovery";
import type { DailyReport, Role, UserProfile } from "./types";

const authState = vi.hoisted(() => ({
  reports: [] as DailyReport[],
  signedIn: true,
  loading: false,
  recipientError: "",
  canManageAccounts: false,
  sessionReauthRequired: false,
  openPush: vi.fn(async () => ({ id: "push-post", authorId: "author", recipientIds: ["test-user"], isDemo: false })),
  watchAttendance: vi.fn(() => () => undefined),
  profile: {
    uid: "test-user",
    email: "test@example.com",
    displayName: "テスト利用者",
    role: "employee",
    locale: "ja",
    active: true
  } as UserProfile
}));

vi.mock("./auth", () => ({
  useAuth: () => ({
    user: authState.signedIn ? { uid: authState.profile.uid } : null,
    profile: authState.profile,
    loading: authState.loading,
    passwordChangePending: authState.sessionReauthRequired,
    sessionReauthRequired: authState.sessionReauthRequired,
    logout: vi.fn()
  })
}));

vi.mock("./features/business/api", () => ({ businessFeatureAvailable: true }));
vi.mock("./features/business/BusinessPage", () => ({ default: () => null }));
vi.mock("./components/AppUpdateNotice", () => ({ AppUpdateNotice: () => null }));
vi.mock("./services/accountManagement", () => ({ getAccountManagement: vi.fn(async () => ({ canManage: authState.canManageAccounts })) }));
vi.mock("./pages/AccountManagementPage", () => ({ AccountManagementPage: () => <h1>ログイン管理画面の内容</h1> }));
vi.mock("./pages/PasswordRecoveryPage", () => ({ PasswordRecoveryPage: () => <h1>パスワード再設定画面の内容</h1> }));

vi.mock("./services/api", () => {
  const watch = () => () => undefined;
  return {
    watchAttendance: authState.watchAttendance,
    watchCategories: watch,
    watchCompanyHolidayOverrides: watch,
    watchDailyReportAutomations: watch,
    watchDutyDefinitions: watch,
    watchEmploymentBases: watch,
    watchEvidenceReferences: watch,
    watchMonthlyPackages: watch,
    watchNonWorkingReasons: watch,
    watchPresidentInstructions: watch,
    watchProductObservations: watch,
    watchProductRevisions: watch,
    watchProducts: watch,
    watchRenewalChecklists: watch,
    watchReports: (_uid: string, _all: boolean, callback: (rows: DailyReport[]) => void) => { callback(authState.reports); return () => undefined; },
    markDailyReportCommentsRead: vi.fn(async () => undefined),
    watchSourceDocumentReferences: watch,
    watchUsers: watch,
    watchWeeklyMeetings: watch,
    watchWeeklyPlans: watch,
    watchWeeklyReports: watch,
    getAnnouncementRecipients: async () => {
      if (authState.recipientError) throw new Error(authState.recipientError);
      return [];
    },
    getAnnouncementForNotification: authState.openPush
  };
});

vi.mock("./components/PresidentInstructions", () => ({
  InstructionBanner: () => null,
  InstructionCenter: ({ open, selectedInstructionId }: { open: boolean; selectedInstructionId?: string }) => open ? <div role="dialog" aria-label="ホームから開いたお知らせ">{selectedInstructionId}</div> : null,
  InstructionShortcut: () => null
}));

vi.mock("./pages/HomePage", () => ({ HomePage: ({ onSection, onAnnouncements, homeVisit }: { onSection: (section: string) => void; onAnnouncements: () => void; homeVisit: number }) => <>
  <h1>ホーム画面の内容</h1><output aria-label="ホーム表示回数">{homeVisit}</output>
  <button onClick={() => onSection("updates")}>ホームアイコン：更新情報</button>
  <button onClick={onAnnouncements}>ホームアイコン：お知らせ</button>
</> }));
vi.mock("./pages/UpdatesPage", () => ({ UpdatesPage: () => <h1>更新履歴の内容</h1> }));
vi.mock("./pages/LoginPage", () => ({ LoginPage: () => null }));
vi.mock("./pages/AuthRecoveryPage", () => ({ AuthRecoveryPage: () => null }));
vi.mock("./pages/InitialPasswordChangePage", () => ({ InitialPasswordChangePage: () => null }));
vi.mock("./pages/ReportPage", () => ({ ReportPage: ({ initialDate }: { initialDate?: string }) => <output aria-label="追加先の日報日付">{initialDate}</output> }));
vi.mock("./pages/RecordsPage", () => ({ RecordsPage: () => null }));
vi.mock("./pages/AdminPage", () => ({ AdminPage: () => null }));
vi.mock("./pages/SettingsPage", () => ({ SettingsPage: () => null }));
vi.mock("./pages/HelpPage", () => ({ HelpPage: () => null }));
vi.mock("./pages/ProductsPage", () => ({ ProductsPage: () => null }));
vi.mock("./pages/WorkflowPage", () => ({ WorkflowPage: () => null }));
vi.mock("./features/weeklyTodo/WeeklyTodoPage", () => ({ WeeklyTodoPage: ({ onOpenReport }: { onOpenReport: (date: string) => void }) => <><h1>週間予定の内容</h1><button onClick={() => onOpenReport("2026-10-19")}>追加先の日報を開く</button></> }));

beforeEach(() => {
  recordAppCheckSuccess(true);
  authState.reports = [];
  authState.signedIn = true;
  authState.loading = false;
  authState.recipientError = "";
  authState.canManageAccounts = false;
  authState.sessionReauthRequired = false;
  authState.watchAttendance.mockClear();
  authState.openPush.mockClear();
  authState.profile.active = true;
  authState.profile.passwordChangeRequired = false;
  authState.profile.role = "employee";
  localStorage.removeItem("gyoumulog-locale");
  window.history.replaceState(null, "", "/");
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  recordAppCheckSuccess(true);
  localStorage.removeItem("gyoumulog-locale");
  document.documentElement.lang = "ja";
  vi.restoreAllMocks();
});

describe("App Check recovery integration", () => {
  it("opens the daily report for the transferred date from weekly To Do", async () => {
    await renderApp(); fireEvent.click(screen.getAllByRole("button", { name: "今週のTo Do" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "追加先の日報を開く" })); expect(screen.getByLabelText("追加先の日報日付")).toHaveTextContent("2026-10-19");
  });
  it.each(["employee", "employee_manager", "president_viewer"] as Role[])("opens weekly To Do from both menus for %s", async role => {
    authState.profile.role = role; await renderApp();
    const buttons = screen.getAllByRole("button", { name: "今週のTo Do" }); expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]); expect(screen.getByRole("heading", { name: "週間予定の内容" })).toBeInTheDocument();
  });
  it("replaces raw App Check notification text with a persistent notice inside the app header", async () => {
    authState.recipientError = "AppCheck: Requests throttled due to previous 403 error. Attempts allowed again after 17h:02m:23s (appCheck/throttled).";
    await renderApp();
    const notice = screen.getByRole("region", { name: "接続の確認が必要です" });
    expect(notice.closest(".app-header")).not.toBeNull();
    expect(notice).toHaveAccessibleDescription(/再読み込みでは入力中の内容は保存されません/);
    expect(getAppCheckRecoveryState()).toBe("throttled");
    expect(screen.queryByText(authState.recipientError)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ホーム画面の内容" })).toBeInTheDocument();
  });

  it.each(["signed out", "loading", "account recovery", "password change"])("keeps recovery guidance in the header while %s", async (page) => {
    recordAppCheckError({ code: "appCheck/throttled" });
    if (page === "signed out") authState.signedIn = false;
    if (page === "loading") authState.loading = true;
    if (page === "account recovery") authState.profile.active = false;
    if (page === "password change") authState.profile.passwordChangeRequired = true;
    await renderApp();
    const notice = screen.getByRole("region", { name: "接続の確認が必要です" });
    expect(notice.closest(".app-header")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "ホーム画面の内容" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

async function renderApp() {
  await act(async () => {
    render(<I18nProvider><App /></I18nProvider>);
  });
}

describe("update history navigation", () => {
  it("connects home icons to existing navigation and the shell announcement center", async () => {
    await renderApp();
    expect(screen.getByLabelText("ホーム表示回数")).toHaveTextContent("0");
    fireEvent.click(screen.getByRole("button", { name: "ホームアイコン：更新情報" }));
    expect(screen.getByRole("heading", { name: "更新履歴の内容" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "ホーム" }));
    expect(screen.getByLabelText("ホーム表示回数")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "ホームアイコン：お知らせ" }));
    expect(screen.getByRole("dialog", { name: "ホームから開いたお知らせ" })).toBeInTheDocument();
  });

  it.each<Role>(["employee", "employee_manager", "president_viewer"])(
    "shows update history only after selecting the sidebar entry for %s",
    async (role) => {
      authState.profile.role = role;
      await renderApp();
      const sidebar = within(screen.getByRole("complementary"));

      expect(screen.getByRole("heading", { name: "ホーム画面の内容" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "更新履歴の内容" })).not.toBeInTheDocument();

      fireEvent.click(sidebar.getByRole("button", { name: "更新情報" }));

      expect(screen.getByRole("heading", { name: "更新履歴の内容" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "ホーム画面の内容" })).not.toBeInTheDocument();

      fireEvent.click(sidebar.getByRole("button", { name: "ホーム" }));

      expect(screen.getByRole("heading", { name: "ホーム画面の内容" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "更新履歴の内容" })).not.toBeInTheDocument();
    }
  );

  it("opens update history from the mobile menu after switching to Chinese", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "中" }));
    const mobileMenu = within(screen.getByRole("navigation", { name: "页面菜单" }));
    const updatesButton = mobileMenu.getByRole("button", { name: "更新信息" });

    expect(updatesButton).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("heading", { name: "更新履歴の内容" })).not.toBeInTheDocument();

    fireEvent.click(updatesButton);

    expect(updatesButton).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "更新履歴の内容" })).toBeInTheDocument();
  });
});

describe("owner account management navigation", () => {
  it("accepts a recovery link opened in the already-running app and clears its fragment", async () => {
    await renderApp();
    expect(screen.getByRole("heading", { name: "ホーム画面の内容" })).toBeInTheDocument();
    await act(async () => {
      window.history.replaceState(null, "", "/#password-recovery=" + "b".repeat(43));
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("heading", { name: "パスワード再設定画面の内容" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "ホーム画面の内容" })).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });
  it("requires a new login after email changes without claiming the password changed", async () => {
    authState.sessionReauthRequired = true;
    await renderApp();
    expect(screen.getByRole("heading", { name: "ログインし直してください" })).toBeInTheDocument();
    expect(screen.getByText(/メールアドレスだけの変更ではパスワードは変わりません/)).toBeInTheDocument();
    expect(authState.watchAttendance).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "ホーム画面の内容" })).not.toBeInTheDocument();
  });
  it("shows management only after the server confirms owner capability", async () => {
    authState.profile.role = "employee_manager";
    await renderApp();
    expect(screen.queryByRole("button", { name: "ログイン管理" })).not.toBeInTheDocument();
    cleanup();
    authState.canManageAccounts = true;
    await renderApp();
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "ログイン管理" }));
    expect(screen.getByRole("heading", { name: "ログイン管理画面の内容" })).toBeInTheDocument();
  });

  it.each<Role>(["employee", "president_viewer"])("does not expose management to %s", async (role) => {
    authState.profile.role = role;
    authState.canManageAccounts = true;
    await renderApp();
    expect(screen.queryByRole("button", { name: "ログイン管理" })).not.toBeInTheDocument();
  });

  it.each([true, false])("opens recovery before any ordinary app screen and removes its secret from history (signedIn=%s)", async (signedIn) => {
    authState.signedIn = signedIn;
    window.history.replaceState(null, "", "/#password-recovery=" + "a".repeat(43));
    await renderApp();
    expect(screen.getByRole("heading", { name: "パスワード再設定画面の内容" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "ホーム画面の内容" })).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(authState.watchAttendance).not.toHaveBeenCalled();
  });
});

describe("daily report reply integration", () => {
  it("shows the owner's replies on the home screen and opens the older report", async () => {
    authState.reports = [{ id: "r1", userId: "test-user", status: "submitted", reportDate: "2026-08-01", activities: "テストの日報", comments: [{ id: "c1", authorId: "president", authorName: "テスト管理者", authorRole: "president_viewer", body: "日報の返信です", createdAt: { toDate: () => new Date("2026-08-01T00:00:00Z") } }] }] as unknown as DailyReport[];
    await renderApp();
    expect(screen.getByRole("region", { name: "日報への返信通知" })).toHaveTextContent("未確認 1件");
    fireEvent.click(screen.getByText("返信のある日報を選ぶ"));
    fireEvent.click(screen.getByRole("button", { name: /返信 1件を確認/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("日報の返信です");
    expect(screen.getByRole("heading", { name: "ホーム画面の内容" })).toBeInTheDocument();
  });
});

describe("notification entry after authentication", () => {
  it("preserves a notification target through login and opens it after the account gate passes", async () => {
    authState.signedIn = false;
    window.history.replaceState(null, "", "/#announcement=push-post");
    const view = render(<I18nProvider><App /></I18nProvider>);
    expect(authState.openPush).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#announcement=push-post");
    authState.signedIn = true;
    await act(async () => view.rerender(<I18nProvider><App /></I18nProvider>));
    expect(authState.openPush).toHaveBeenCalledWith("push-post");
    expect(await screen.findByRole("dialog", { name: "ホームから開いたお知らせ" })).toHaveTextContent("push-post");
    expect(window.location.hash).toBe("");
  });
  it("does not fetch notification content during required reauthentication", async () => {
    authState.sessionReauthRequired = true;
    window.history.replaceState(null, "", "/#announcement=push-post");
    await renderApp();
    expect(authState.openPush).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#announcement=push-post");
  });
});
