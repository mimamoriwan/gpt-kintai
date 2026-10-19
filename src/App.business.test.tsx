import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { BusinessAnnouncementDraft } from "./features/business/types";
import type { UserProfile } from "./types";

const auth = vi.hoisted(() => ({ user: null as { uid: string } | null, profile: null as UserProfile | null, loading: false, passwordChangePending: false }));
const recipients = vi.hoisted(() => vi.fn(async () => []));
const flags = vi.hoisted(() => ({ enabled: true }));
const services = vi.hoisted(() => Object.fromEntries([
  "watchAttendance", "watchCategories", "watchCompanyHolidayOverrides", "watchDutyDefinitions", "watchEmploymentBases", "watchEvidenceReferences", "watchMonthlyPackages", "watchNonWorkingReasons",
  "watchProductObservations", "watchProductRevisions", "watchProducts", "watchRenewalChecklists", "watchReports", "watchSourceDocumentReferences", "watchUsers", "watchWeeklyMeetings",
  "watchWeeklyPlans", "watchWeeklyReports", "watchPresidentInstructions", "watchDailyReportAutomations"
].map((name) => [name, vi.fn(() => () => undefined)])));
vi.mock("./auth", () => ({ useAuth: () => auth }));
vi.mock("./i18n", () => ({ useI18n: () => ({ locale: "ja" }) }));
vi.mock("./features/business/api", () => ({ get businessFeatureAvailable() { return flags.enabled; } }));
vi.mock("./services/api", () => ({ ...services, getAnnouncementRecipients: recipients }));
vi.mock("./components/AppHeader", () => ({ AppHeader: ({ children }: { children: ReactNode }) => <header>{children}</header> }));
vi.mock("./components/AppUpdateNotice", () => ({ AppUpdateNotice: () => null }));
vi.mock("./components/Toast", () => ({ Toast: () => null }));
vi.mock("./components/Shell", () => ({ Shell: ({ children, onSection, announcementDraft }: { children: ReactNode | ((openInstructions: () => void) => ReactNode); onSection: (section: string) => void; announcementDraft?: BusinessAnnouncementDraft }) => <main>
  <button onClick={() => onSection("business")}>business menu</button><button onClick={() => onSection("home")}>home menu</button>
  {announcementDraft && <output aria-label="announcement request">{announcementDraft.body}</output>}{typeof children === "function" ? children(() => undefined) : children}
</main> }));
vi.mock("./pages/LoginPage", () => ({ LoginPage: () => <h1>Login</h1> }));
vi.mock("./pages/AuthRecoveryPage", () => ({ AuthRecoveryPage: () => <h1>Profile recovery</h1> }));
vi.mock("./pages/InitialPasswordChangePage", () => ({ InitialPasswordChangePage: () => <h1>Initial password change</h1> }));
vi.mock("./pages/HomePage", () => ({ HomePage: () => <h1>Home</h1> }));
vi.mock("./pages/ReportPage", () => ({ ReportPage: () => null }));
vi.mock("./pages/RecordsPage", () => ({ RecordsPage: () => null }));
vi.mock("./pages/AdminPage", () => ({ AdminPage: () => null }));
vi.mock("./pages/SettingsPage", () => ({ SettingsPage: () => null }));
vi.mock("./pages/HelpPage", () => ({ HelpPage: () => null }));
vi.mock("./pages/ProductsPage", () => ({ ProductsPage: () => null }));
vi.mock("./pages/WorkflowPage", () => ({ WorkflowPage: () => null }));
vi.mock("./features/business/BusinessPage", () => ({ default: function Page({ profile, initialInitiativeId, onCreateAnnouncement }: { profile: UserProfile; initialInitiativeId?: string; onCreateAnnouncement: (draft: BusinessAnnouncementDraft) => void }) {
  const [text, setText] = useState("");
  return <section><h1>Business {profile.uid}</h1><output aria-label="selected initiative">{initialInitiativeId || "all"}</output>
    <input aria-label="business draft" value={text} onChange={(event) => setText(event.target.value)} />
    <button onClick={() => onCreateAnnouncement({ key: "business-request", title: "title", body: `link for ${profile.uid}` })}>create announcement</button>
  </section>;
} }));

const profile = { uid: "yasushi", displayName: "ヤスシ", email: "yasushi@example.test", locale: "ja", role: "employee_manager", active: true } as UserProfile;
beforeEach(() => {
  vi.clearAllMocks();
  auth.user = null; auth.profile = null; auth.loading = false; auth.passwordChangePending = false; flags.enabled = true;
  Object.values(services).forEach((watch) => watch.mockImplementation(() => () => undefined));
  window.history.replaceState(null, "", "/");
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("App business navigation integration", () => {
  it("keeps a restored session with an old token out of work feeds even when password setup is complete", () => {
    auth.user = { uid: profile.uid };
    auth.profile = { ...profile, passwordChangeRequired: false, passwordAuthTimeAfter: 100 };
    // The provider derives this gate from token.auth_time <= passwordAuthTimeAfter.
    auth.passwordChangePending = true;
    window.history.replaceState(null, "", "/#business/initiative-1");
    render(<App />);

    expect(screen.getByRole("heading", { name: "Initial password change" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "business menu" })).not.toBeInTheDocument();
    for (const watcher of Object.values(services)) expect(watcher).not.toHaveBeenCalled();
    expect(recipients).not.toHaveBeenCalled();
  });

  it("blocks work feeds and all app navigation until password setup and renewed authentication finish", async () => {
    auth.user = { uid: profile.uid };
    auth.profile = { ...profile, passwordChangeRequired: true };
    const { rerender } = render(<App />);
    expect(screen.getByRole("heading", { name: "Initial password change" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "business menu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Home" })).not.toBeInTheDocument();
    for (const watcher of Object.values(services)) expect(watcher).not.toHaveBeenCalled();
    expect(recipients).not.toHaveBeenCalled();

    auth.passwordChangePending = true;
    auth.profile = { ...profile, passwordChangeRequired: false };
    rerender(<App />);
    expect(screen.getByRole("heading", { name: "Initial password change" })).toBeVisible();
    for (const watcher of Object.values(services)) expect(watcher).not.toHaveBeenCalled();
    expect(recipients).not.toHaveBeenCalled();

    auth.passwordChangePending = false;
    auth.loading = true;
    auth.profile = null;
    rerender(<App />);
    for (const watcher of Object.values(services)) expect(watcher).not.toHaveBeenCalled();

    auth.loading = false;
    auth.profile = { ...profile, passwordChangeRequired: false };
    rerender(<App />);
    expect(await screen.findByRole("heading", { name: "Home" })).toBeVisible();
    expect(services.watchAttendance).toHaveBeenCalledOnce();
    expect(recipients).toHaveBeenCalledOnce();
  });

  it("does not open a business deep link while an initial password change is required", () => {
    auth.user = { uid: profile.uid };
    auth.profile = { ...profile, passwordChangeRequired: true };
    window.history.replaceState(null, "", "/#business/initiative-1");
    render(<App />);
    expect(screen.getByRole("heading", { name: "Initial password change" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Business yasushi" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "business draft" })).not.toBeInTheDocument();
    for (const watcher of Object.values(services)) expect(watcher).not.toHaveBeenCalled();
  });

  it("keeps an inactive account blocked even when password change is required", () => {
    auth.user = { uid: profile.uid };
    auth.profile = { ...profile, active: false, passwordChangeRequired: true };
    render(<App />);
    expect(screen.getByRole("heading", { name: "Profile recovery" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Initial password change" })).not.toBeInTheDocument();
    for (const watcher of Object.values(services)) expect(watcher).not.toHaveBeenCalled();
  });

  it("routes a signed-in user to recovery until an active profile is available", async () => {
    auth.user = { uid: profile.uid };
    const { rerender } = render(<App />);
    expect(screen.getByRole("heading", { name: "Profile recovery" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Login" })).not.toBeInTheDocument();
    auth.profile = { ...profile, active: false };
    rerender(<App />);
    expect(screen.getByRole("heading", { name: "Profile recovery" })).toBeVisible();
    auth.profile = profile;
    rerender(<App />);
    expect(await screen.findByRole("heading", { name: "Home" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Profile recovery" })).not.toBeInTheDocument();
  });

  it("opens an exact login link, forwards a draft, and clears feature state on logout and same-user login", async () => {
    window.history.replaceState(null, "", "/#business/initiative-1");
    const { rerender } = render(<App />);
    expect(screen.getByRole("heading", { name: "Login" })).toBeVisible();
    auth.user = { uid: profile.uid }; auth.profile = profile;
    rerender(<App />);
    expect(await screen.findByRole("heading", { name: "Business yasushi" })).toBeVisible();
    expect(screen.getByLabelText("selected initiative")).toHaveTextContent("initiative-1");
    fireEvent.change(screen.getByRole("textbox", { name: "business draft" }), { target: { value: "unsaved old user" } });
    fireEvent.click(screen.getByRole("button", { name: "create announcement" }));
    expect(screen.getByLabelText("announcement request")).toHaveTextContent("link for yasushi");
    auth.user = null; auth.profile = null; rerender(<App />);
    expect(screen.queryByLabelText("announcement request")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");
    auth.user = { uid: profile.uid }; auth.profile = profile; rerender(<App />);
    expect(screen.getByRole("heading", { name: "Home" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "business menu" }));
    expect(await screen.findByRole("textbox", { name: "business draft" })).toHaveValue("");
    expect(screen.getByLabelText("selected initiative")).toHaveTextContent("all");
    expect(screen.queryByLabelText("announcement request")).not.toBeInTheDocument();
  });

  it("unmounts the feature while auth/profile identities disagree and never carries the old draft to the next account", async () => {
    auth.user = { uid: profile.uid }; auth.profile = profile;
    window.history.replaceState(null, "", "/#business/initiative-1");
    const { rerender } = render(<App />);
    await screen.findByRole("heading", { name: "Business yasushi" });
    fireEvent.click(screen.getByRole("button", { name: "create announcement" }));
    auth.user = { uid: "president" };
    rerender(<App />);
    expect(screen.queryByRole("heading", { name: "Business yasushi" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("announcement request")).not.toBeInTheDocument();
    auth.profile = { ...profile, uid: "president", role: "president_viewer" }; rerender(<App />);
    fireEvent.click(screen.getByRole("button", { name: "business menu" }));
    await screen.findByRole("heading", { name: "Business president" });
    expect(screen.getByLabelText("selected initiative")).toHaveTextContent("all");
    expect(screen.queryByLabelText("announcement request")).not.toBeInTheDocument();
  });

  it("opens in-session links but refuses the business section when the feature is disabled", async () => {
    auth.user = { uid: profile.uid }; auth.profile = profile;
    const { rerender } = render(<App />);
    act(() => { window.history.replaceState(null, "", "/#business/from-announcement"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await screen.findByRole("heading", { name: "Business yasushi" });
    expect(screen.getByLabelText("selected initiative")).toHaveTextContent("from-announcement");
    fireEvent.click(screen.getByRole("button", { name: "home menu" }));
    expect(window.location.hash).toBe("");
    flags.enabled = false; rerender(<App />);
    fireEvent.click(screen.getByRole("button", { name: "business menu" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Home" })).toBeVisible());
    expect(screen.queryByRole("heading", { name: "Business yasushi" })).not.toBeInTheDocument();
  });
});
