import { act, cleanup, render } from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth";
import type { UserProfile } from "./types";
import { recordAppCheckError, recordAppCheckSuccess } from "./lib/appCheckRecovery";

const firebaseMocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  completeInitialPasswordChange: vi.fn(),
  getIdTokenResult: vi.fn(),
  onSnapshot: vi.fn(),
  doc: vi.fn(),
  auth: { currentUser: null as User | null },
  db: {}
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: firebaseMocks.onAuthStateChanged,
  signInWithEmailAndPassword: firebaseMocks.signInWithEmailAndPassword,
  signOut: firebaseMocks.signOut
}));
vi.mock("firebase/firestore", () => ({ onSnapshot: firebaseMocks.onSnapshot, doc: firebaseMocks.doc }));
vi.mock("./firebase", () => ({ auth: firebaseMocks.auth, db: firebaseMocks.db }));
vi.mock("./services/api", () => ({ completeInitialPasswordChange: firebaseMocks.completeInitialPasswordChange }));

interface ProfileSubscription {
  uid: string;
  options: { includeMetadataChanges?: boolean };
  next: (snapshot: { exists: () => boolean; data: () => UserProfile | undefined; metadata: { fromCache: boolean } }) => void;
  error: (error: Error) => void;
  stop: ReturnType<typeof vi.fn>;
}

let authListener: (user: User | null) => void;
let stopAuth: ReturnType<typeof vi.fn>;
let subscriptions: ProfileSubscription[];
let latest: ReturnType<typeof useAuth>;

function Probe() {
  latest = useAuth();
  return null;
}

function mountProvider() {
  return render(<AuthProvider><Probe /></AuthProvider>);
}

function signIn(uid = "employee") {
  act(() => authListener({ uid, email: `${uid}@example.com`, getIdTokenResult: firebaseMocks.getIdTokenResult } as unknown as User));
}

function profile(uid = "employee", active = true): UserProfile {
  return { uid, displayName: "従業員", email: `${uid}@example.com`, role: "employee", locale: "ja", active };
}

function receive(subscription: ProfileSubscription, value: UserProfile | null, fromCache = false) {
  act(() => subscription.next({ exists: () => value !== null, data: () => value ?? undefined, metadata: { fromCache } }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  recordAppCheckSuccess(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  subscriptions = [];
  firebaseMocks.auth.currentUser = null;
  stopAuth = vi.fn();
  firebaseMocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
    authListener = (user) => {
      firebaseMocks.auth.currentUser = user;
      callback(user);
    };
    return stopAuth;
  });
  firebaseMocks.doc.mockImplementation((_db, _collection, uid) => ({ uid }));
  firebaseMocks.onSnapshot.mockImplementation((reference, options, next, error) => {
    const subscription = { uid: reference.uid, options, next, error, stop: vi.fn() };
    subscriptions.push(subscription);
    return subscription.stop;
  });
  firebaseMocks.signInWithEmailAndPassword.mockImplementation(async () => ({ user: firebaseMocks.auth.currentUser }));
  firebaseMocks.completeInitialPasswordChange.mockResolvedValue({ success: true });
  firebaseMocks.getIdTokenResult.mockResolvedValue({ claims: { auth_time: 200 } });
});

describe("post-reset session validation", () => {
  it("does not submit a password if the Firebase account no longer matches the rendered account", async () => {
    mountProvider();
    signIn();
    receive(subscriptions[0], { ...profile(), passwordChangeRequired: true });
    firebaseMocks.auth.currentUser = { uid: "other", email: "other@example.com" } as User;

    await act(async () => { await expect(latest.completeInitialPasswordChange("new-password")).rejects.toMatchObject({ code: "auth/requires-recent-login" }); });

    expect(firebaseMocks.completeInitialPasswordChange).not.toHaveBeenCalled();
    expect(firebaseMocks.signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it("does not read tokens for legacy profiles without a reset boundary", () => {
    mountProvider();
    signIn();
    receive(subscriptions[0], profile());
    expect(latest.loading).toBe(false);
    expect(latest.passwordChangePending).toBe(false);
    expect(firebaseMocks.getIdTokenResult).not.toHaveBeenCalled();
  });

  it.each([99, 100, undefined])("requires password sign-in for auth_time %s at boundary 100", async (authTime) => {
    firebaseMocks.getIdTokenResult.mockResolvedValue({ claims: { auth_time: authTime } });
    mountProvider();
    signIn();
    receive(subscriptions[0], { ...profile(), passwordChangeRequired: false, passwordAuthTimeAfter: 100 });
    expect(latest.loading).toBe(true);
    expect(latest.profile).toBeNull();

    await act(async () => {});

    expect(latest.loading).toBe(false);
    expect(latest.profile?.passwordChangeRequired).toBe(false);
    expect(latest.passwordChangePending).toBe(true);
    expect(latest.passwordChangeNeedsReauth).toBe(true);
    expect(firebaseMocks.completeInitialPasswordChange).not.toHaveBeenCalled();
  });

  it("allows a session strictly newer than the reset boundary", async () => {
    firebaseMocks.getIdTokenResult.mockResolvedValue({ claims: { auth_time: 101 } });
    mountProvider();
    signIn();
    receive(subscriptions[0], { ...profile(), passwordAuthTimeAfter: 100 });
    await act(async () => {});
    expect(latest.loading).toBe(false);
    expect(latest.passwordChangePending).toBe(false);
    expect(latest.passwordChangeNeedsReauth).toBe(false);
    expect(latest.profile?.uid).toBe("employee");
  });

  it("keeps a failed token read out of the app and allows retry", async () => {
    firebaseMocks.getIdTokenResult.mockRejectedValueOnce(new Error("private token detail"));
    mountProvider();
    signIn();
    receive(subscriptions[0], { ...profile(), passwordAuthTimeAfter: 100 });
    await act(async () => {});
    expect(latest).toMatchObject({ profile: null, loading: false, profileError: "session-unavailable" });

    act(() => latest.retryProfile());
    receive(subscriptions[1], { ...profile(), passwordAuthTimeAfter: 100 });
    await act(async () => {});
    expect(latest).toMatchObject({ profile: profileWithBoundary(), loading: false, profileError: null });
    expect(latest.passwordChangePending).toBe(false);
  });

  it("uses auth.currentUser after same-UID sign-in and renews without saving the password again", async () => {
    firebaseMocks.getIdTokenResult.mockResolvedValue({ claims: { auth_time: 100 } });
    const freshToken = vi.fn().mockResolvedValue({ claims: { auth_time: 101 } });
    mountProvider();
    signIn();
    receive(subscriptions[0], profileWithBoundary());
    await act(async () => {});
    expect(latest.passwordChangeNeedsReauth).toBe(true);
    const freshUser = { uid: "employee", email: "employee@example.com", getIdTokenResult: freshToken } as unknown as User;
    firebaseMocks.signInWithEmailAndPassword.mockImplementationOnce(async () => {
      firebaseMocks.auth.currentUser = freshUser;
      return { user: freshUser };
    });

    await act(async () => latest.completeInitialPasswordChange("new-password"));
    expect(firebaseMocks.completeInitialPasswordChange).not.toHaveBeenCalled();
    expect(latest.loading).toBe(true);
    expect(latest.user).toBe(freshUser);
    receive(subscriptions[1], profileWithBoundary());
    await act(async () => {});

    expect(freshToken).toHaveBeenCalledOnce();
    expect(firebaseMocks.getIdTokenResult).toHaveBeenCalledOnce();
    expect(latest.passwordChangePending).toBe(false);
    expect(latest.passwordChangeNeedsReauth).toBe(false);
  });

  it.each(["new snapshot", "retry", "another account", "listener failure"])("ignores an old token result after %s", async (change) => {
    let finish!: (value: unknown) => void;
    firebaseMocks.getIdTokenResult.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    mountProvider();
    signIn();
    receive(subscriptions[0], profileWithBoundary());
    if (change === "new snapshot") receive(subscriptions[0], profile("employee", false));
    if (change === "retry") { act(() => latest.retryProfile()); receive(subscriptions[1], profile()); }
    if (change === "another account") { signIn("another"); receive(subscriptions[1], profile("another")); }
    if (change === "listener failure") act(() => subscriptions[0].error(new Error("unavailable")));
    const expected = latest;

    await act(async () => { finish({ claims: { auth_time: 100 } }); });

    expect(latest).toBe(expected);
  });
});

function profileWithBoundary(): UserProfile { return { ...profile(), passwordAuthTimeAfter: 100 }; }

describe("initial password completion", () => {
  it("keeps the gate closed until the new password renews authentication and reloads the profile", async () => {
    let save!: () => void;
    let renew!: () => void;
    firebaseMocks.completeInitialPasswordChange.mockImplementationOnce(() => new Promise<void>((resolve) => { save = resolve; }));
    firebaseMocks.signInWithEmailAndPassword.mockImplementationOnce(() => new Promise<void>((resolve) => { renew = resolve; }));
    mountProvider();
    signIn();
    receive(subscriptions[0], { ...profile(), passwordChangeRequired: true });
    let completion!: Promise<void>;

    act(() => { completion = latest.completeInitialPasswordChange(" chosen password "); });
    expect(latest.passwordChangePending).toBe(true);
    receive(subscriptions[0], { ...profile(), passwordChangeRequired: false });
    expect(latest.passwordChangePending).toBe(true);
    expect(firebaseMocks.signInWithEmailAndPassword).not.toHaveBeenCalled();

    await act(async () => { save(); });
    expect(firebaseMocks.signInWithEmailAndPassword).toHaveBeenCalledWith(firebaseMocks.auth, "employee@example.com", " chosen password ");
    expect(latest.passwordChangePending).toBe(true);
    await act(async () => { renew(); await completion; });

    expect(latest.passwordChangePending).toBe(false);
    expect(latest.loading).toBe(true);
    expect(latest.profile).toBeNull();
    expect(subscriptions).toHaveLength(2);
    receive(subscriptions[1], { ...profile(), passwordChangeRequired: false });
    expect(latest.loading).toBe(false);
  });

  it("retries only sign-in when password saving succeeded but authentication renewal failed", async () => {
    mountProvider();
    signIn();
    receive(subscriptions[0], { ...profile(), passwordChangeRequired: true });
    firebaseMocks.signInWithEmailAndPassword.mockRejectedValueOnce({ code: "auth/network-request-failed", message: "private detail" });

    await act(async () => {
      await expect(latest.completeInitialPasswordChange("new-password")).rejects.toMatchObject({ code: "auth/password-change-reauth-required" });
    });
    receive(subscriptions[0], { ...profile(), passwordChangeRequired: false });
    expect(latest.passwordChangePending).toBe(true);
    expect(latest.passwordChangeNeedsReauth).toBe(true);

    await act(async () => latest.completeInitialPasswordChange("new-password"));

    expect(firebaseMocks.completeInitialPasswordChange).toHaveBeenCalledOnce();
    expect(firebaseMocks.signInWithEmailAndPassword).toHaveBeenCalledTimes(2);
    expect(latest.passwordChangePending).toBe(false);
    expect(latest.passwordChangeNeedsReauth).toBe(false);
  });

  it("keeps the gate closed after an uncertain save and retries the idempotent callable", async () => {
    mountProvider();
    signIn();
    receive(subscriptions[0], { ...profile(), passwordChangeRequired: true });
    const error = { code: "functions/unavailable", details: { reason: "password-change-retry-same-password" } };
    firebaseMocks.completeInitialPasswordChange.mockRejectedValueOnce(error);

    await act(async () => { await expect(latest.completeInitialPasswordChange("new-password")).rejects.toBe(error); });
    receive(subscriptions[0], { ...profile(), passwordChangeRequired: false });
    expect(latest.passwordChangePending).toBe(true);
    expect(latest.passwordChangeNeedsReauth).toBe(false);

    await act(async () => latest.completeInitialPasswordChange("new-password"));

    expect(firebaseMocks.completeInitialPasswordChange).toHaveBeenCalledTimes(2);
    expect(latest.passwordChangePending).toBe(false);
  });

  it("does not renew the previous account when it changed while saving", async () => {
    let save!: () => void;
    firebaseMocks.completeInitialPasswordChange.mockImplementationOnce(() => new Promise<void>((resolve) => { save = resolve; }));
    mountProvider();
    signIn();
    receive(subscriptions[0], { ...profile(), passwordChangeRequired: true });
    let completion!: Promise<void>;
    act(() => { completion = latest.completeInitialPasswordChange("new-password"); });

    signIn("other");
    receive(subscriptions[1], profile("other"));
    await act(async () => { save(); await expect(completion).rejects.toMatchObject({ code: "auth/initial-password-change-cancelled" }); });

    expect(firebaseMocks.signInWithEmailAndPassword).not.toHaveBeenCalled();
    expect(latest.user?.uid).toBe("other");
    expect(latest.passwordChangePending).toBe(false);
  });
});

afterEach(cleanup);

async function resume(event = "focus") {
  await act(async () => { (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event)); });
}

describe("authentication recovery after returning to the app", () => {
  it.each(["focus", "pageshow", "visibilitychange", "online"])("restarts a failed profile listener on %s", async (event) => {
    mountProvider();
    signIn();
    const failed = subscriptions[0];
    receive(failed, profile());
    act(() => failed.error(new Error("unavailable")));

    await resume(event);

    expect(subscriptions).toHaveLength(2);
    expect(failed.stop).toHaveBeenCalledOnce();
    expect(latest).toMatchObject({ loading: true, profile: null, profileError: null });
    receive(subscriptions[1], profile());
    act(() => failed.error(new Error("late failure")));
    expect(latest).toMatchObject({ loading: false, profile: profile(), profileError: null });
  });

  it("retries a failed token read without bypassing the password boundary", async () => {
    firebaseMocks.getIdTokenResult.mockRejectedValueOnce(new Error("network unavailable"));
    firebaseMocks.getIdTokenResult.mockResolvedValueOnce({ claims: { auth_time: 99 } });
    mountProvider();
    signIn();
    receive(subscriptions[0], profileWithBoundary());
    await act(async () => {});
    expect(latest.profileError).toBe("session-unavailable");

    await resume();
    receive(subscriptions[1], profileWithBoundary());
    await act(async () => {});
    expect(latest).toMatchObject({ loading: false, sessionReauthRequired: true, profileError: null });
    await resume();
    expect(subscriptions).toHaveLength(2);
  });

  it.each(["healthy", "missing", "inactive", "password required", "loading"])("does not restart a %s profile on resume or App Check recovery", async (status) => {
    mountProvider();
    signIn();
    if (status === "healthy") receive(subscriptions[0], profile());
    if (status === "missing") receive(subscriptions[0], null);
    if (status === "inactive") receive(subscriptions[0], profile("employee", false));
    if (status === "password required") receive(subscriptions[0], { ...profile(), passwordChangeRequired: true });
    const before = latest;
    await resume("focus");
    await resume("pageshow");
    await resume("visibilitychange");
    await resume("online");
    await act(async () => {
      recordAppCheckError({ code: "appCheck/fetch-network-error" });
      recordAppCheckSuccess();
    });
    expect(subscriptions).toHaveLength(1);
    expect(latest).toBe(before);
  });

  it.each(["hidden", "offline"])("waits until the app is usable after %s events", async (status) => {
    mountProvider();
    signIn();
    act(() => subscriptions[0].error(new Error("unavailable")));
    if (status === "hidden") vi.mocked(Object.getOwnPropertyDescriptor(document, "visibilityState")!.get!).mockReturnValue("hidden");
    if (status === "offline") vi.mocked(Object.getOwnPropertyDescriptor(navigator, "onLine")!.get!).mockReturnValue(false);
    await resume();
    await act(async () => {
      recordAppCheckError({ code: "appCheck/fetch-network-error" });
      recordAppCheckSuccess();
    });
    expect(subscriptions).toHaveLength(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await resume(status === "hidden" ? "visibilitychange" : "online");
    expect(subscriptions).toHaveLength(2);
  });

  it("coalesces event bursts and does not retry a pending or repeatedly failing subscription", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    mountProvider();
    signIn();
    act(() => subscriptions[0].error(new Error("unavailable")));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("pageshow"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    expect(subscriptions).toHaveLength(2);
    await resume();
    expect(subscriptions).toHaveLength(2);
    act(() => subscriptions[1].error(new Error("still unavailable")));
    await resume();
    expect(subscriptions).toHaveLength(2);
    now.mockReturnValue(15_000);
    await resume();
    expect(subscriptions).toHaveLength(3);
  });

  it("recovers after App Check succeeds, including inside the resume cooldown", async () => {
    mountProvider();
    signIn();
    act(() => subscriptions[0].error(new Error("unavailable")));
    await resume();
    act(() => subscriptions[1].error(new Error("still unavailable")));
    await act(async () => { recordAppCheckError({ code: "appCheck/initial-throttle", customData: { httpStatus: 403 } }); });
    await resume();
    expect(subscriptions).toHaveLength(2);
    await act(async () => { recordAppCheckSuccess(true); });
    expect(subscriptions).toHaveLength(3);
    receive(subscriptions[2], profile());
    expect(latest.profile).toEqual(profile());
  });

  it("does not use a queued recovery after sign-out or unmount", async () => {
    const view = mountProvider();
    signIn();
    act(() => subscriptions[0].error(new Error("unavailable")));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      authListener(null);
    });
    expect(subscriptions).toHaveLength(1);
    signIn();
    act(() => subscriptions[1].error(new Error("unavailable")));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      view.unmount();
    });
    await resume();
    await act(async () => {
      recordAppCheckError({ code: "appCheck/fetch-network-error" });
      recordAppCheckSuccess();
    });
    expect(subscriptions).toHaveLength(2);
  });

  it("does not restart after rejected credentials and retries only after successful same-user login", async () => {
    mountProvider();
    signIn();
    act(() => subscriptions[0].error(new Error("unavailable")));
    firebaseMocks.signInWithEmailAndPassword.mockRejectedValueOnce({ code: "auth/invalid-credential" });
    await act(async () => { await expect(latest.login("employee@example.com", "wrong")).rejects.toMatchObject({ code: "auth/invalid-credential" }); });
    expect(subscriptions).toHaveLength(1);
    await act(async () => latest.login("employee@example.com", "correct"));
    expect(subscriptions).toHaveLength(2);
  });

  it("uses the fresh User after same-UID login and ignores an older token rejection", async () => {
    let rejectOld!: (reason: Error) => void;
    firebaseMocks.getIdTokenResult.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectOld = reject; }));
    mountProvider();
    signIn();
    receive(subscriptions[0], profileWithBoundary());
    const freshUser = { uid: "employee", getIdTokenResult: vi.fn().mockResolvedValue({ claims: { auth_time: 201 } }) } as unknown as User;
    firebaseMocks.signInWithEmailAndPassword.mockImplementationOnce(async () => {
      firebaseMocks.auth.currentUser = freshUser;
      return { user: freshUser };
    });
    await act(async () => latest.login("employee@example.com", "correct"));
    expect(subscriptions).toHaveLength(2);
    receive(subscriptions[1], profileWithBoundary());
    await act(async () => { rejectOld(new Error("old request failed")); });
    expect(latest).toMatchObject({ user: freshUser, profile: profileWithBoundary(), loading: false, profileError: null, sessionReauthRequired: false });
  });

  it("does not duplicate the subscription for a new account's auth event", async () => {
    mountProvider();
    signIn();
    firebaseMocks.signInWithEmailAndPassword.mockImplementationOnce(async () => {
      signIn("other");
      return { user: firebaseMocks.auth.currentUser };
    });
    await act(async () => latest.login("other@example.com", "correct"));
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[1].uid).toBe("other");
  });

  it.each(["sign-out", "another account", "unmount", "newer login"])("ignores a late login completion after %s", async (change) => {
    const view = mountProvider();
    signIn();
    const oldUser = firebaseMocks.auth.currentUser;
    act(() => subscriptions[0].error(new Error("unavailable")));
    let finish!: (value: { user: User | null }) => void;
    firebaseMocks.signInWithEmailAndPassword.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = latest.login("employee@example.com", "correct"); });
    if (change === "sign-out") await act(async () => latest.logout());
    if (change === "another account") signIn("other");
    if (change === "unmount") view.unmount();
    if (change === "newer login") await act(async () => latest.login("employee@example.com", "correct"));
    const count = subscriptions.length;
    await act(async () => { finish({ user: oldUser }); await pending; });
    expect(subscriptions).toHaveLength(count);
  });
});

describe("AuthProvider profile recovery", () => {
  it("waits for the signed-in user's profile before ending loading", () => {
    mountProvider();
    expect(latest.loading).toBe(true);
    act(() => authListener(null));
    expect(latest).toMatchObject({ user: null, profile: null, loading: false, profileError: null });

    signIn();
    expect(latest).toMatchObject({ user: { uid: "employee" }, profile: null, loading: true, profileError: null });
    receive(subscriptions[0], profile());
    expect(latest).toMatchObject({ profile: profile(), loading: false, profileError: null });
  });

  it("recovers a failed listener for the same UID without another auth event", async () => {
    mountProvider();
    signIn();
    const failed = subscriptions[0];
    act(() => failed.error(new Error("permission denied")));
    expect(latest).toMatchObject({ user: { uid: "employee" }, profile: null, loading: false, profileError: "unavailable" });

    // Firebase does not emit an auth-state change when the UID stays the same.
    await act(async () => latest.login(" employee@example.com ", " unchanged password "));
    expect(firebaseMocks.signInWithEmailAndPassword).toHaveBeenCalledWith(firebaseMocks.auth, "employee@example.com", " unchanged password ");
    expect(failed.stop).toHaveBeenCalledOnce();
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[1].uid).toBe("employee");
    expect(latest).toMatchObject({ profile: null, loading: true, profileError: null });
    receive(subscriptions[1], profile());
    expect(latest).toMatchObject({ profile: profile(), loading: false, profileError: null });

    act(() => failed.error(new Error("late error")));
    receive(failed, null);
    expect(latest).toMatchObject({ profile: profile(), loading: false, profileError: null });
  });

  it("distinguishes a missing profile and accepts its later creation", () => {
    mountProvider();
    signIn();
    receive(subscriptions[0], null);
    expect(latest).toMatchObject({ profile: null, loading: false, profileError: "missing" });

    receive(subscriptions[0], profile());
    expect(latest).toMatchObject({ profile: profile(), loading: false, profileError: null });
  });

  it("does not report a missing profile until the server confirms an empty cache result", () => {
    mountProvider();
    signIn();
    const subscription = subscriptions[0];
    receive(subscription, null, true);
    expect(latest).toMatchObject({ user: { uid: "employee" }, profile: null, loading: false, profileError: "unavailable" });

    // Both snapshots are empty: metadata changes must be enabled to receive confirmation.
    expect(subscription.options.includeMetadataChanges).toBe(true);
    receive(subscription, null, false);
    expect(latest).toMatchObject({ user: { uid: "employee" }, profile: null, loading: false, profileError: "missing" });
  });

  it("retries after an empty offline cache and accepts the server profile", () => {
    mountProvider();
    signIn();
    const offline = subscriptions[0];
    receive(offline, null, true);
    expect(latest.profileError).toBe("unavailable");

    act(() => latest.retryProfile());
    expect(offline.stop).toHaveBeenCalledOnce();
    expect(latest).toMatchObject({ profile: null, loading: true, profileError: null });
    receive(subscriptions[1], profile(), false);
    expect(latest).toMatchObject({ profile: profile(), loading: false, profileError: null });
    receive(offline, null, false);
    expect(latest).toMatchObject({ profile: profile(), loading: false, profileError: null });
  });

  it("preserves an inactive profile so the app can explain the account restriction", () => {
    mountProvider();
    signIn();
    receive(subscriptions[0], profile("employee", false));
    expect(latest).toMatchObject({ profile: { active: false }, loading: false, profileError: null });
  });

  it("clears the old user's profile immediately and ignores their queued callbacks", () => {
    mountProvider();
    signIn("first");
    const oldSubscription = subscriptions[0];
    receive(oldSubscription, profile("first"));

    signIn("second");
    expect(oldSubscription.stop).toHaveBeenCalledOnce();
    expect(latest).toMatchObject({ user: { uid: "second" }, profile: null, loading: true, profileError: null });
    receive(oldSubscription, profile("first"));
    act(() => oldSubscription.error(new Error("late error")));
    expect(latest).toMatchObject({ user: { uid: "second" }, profile: null, loading: true, profileError: null });

    receive(subscriptions[1], profile("second"));
    expect(latest.profile?.uid).toBe("second");
  });

  it("ignores an earlier retry even when it returns the same user's profile", () => {
    mountProvider();
    signIn();
    const first = subscriptions[0];
    act(() => latest.retryProfile());
    receive(first, profile());
    expect(latest).toMatchObject({ profile: null, loading: true, profileError: null });
    receive(subscriptions[1], profile());
    expect(latest.profile).toEqual(profile());
  });

  it("clears profile failures on sign-out and does not retry signed-out profiles", () => {
    mountProvider();
    signIn();
    const signedInSubscription = subscriptions[0];
    act(() => signedInSubscription.error(new Error("unavailable")));
    act(() => authListener(null));
    expect(signedInSubscription.stop).toHaveBeenCalledOnce();
    receive(signedInSubscription, profile());
    act(() => latest.retryProfile());
    expect(subscriptions).toHaveLength(1);
    expect(latest).toMatchObject({ user: null, profile: null, loading: false, profileError: null });
  });

  it("allows retry after synchronous listener setup fails", () => {
    mountProvider();
    firebaseMocks.onSnapshot.mockImplementationOnce(() => { throw new Error("listener unavailable"); });
    signIn();
    expect(latest).toMatchObject({ profile: null, loading: false, profileError: "unavailable" });
    act(() => latest.retryProfile());
    receive(subscriptions[0], profile());
    expect(latest).toMatchObject({ profile: profile(), loading: false, profileError: null });
  });

  it("stops subscriptions and ignores queued auth events after unmount", () => {
    const view = mountProvider();
    signIn();
    const subscription = subscriptions[0];
    const retry = latest.retryProfile;
    view.unmount();
    expect(stopAuth).toHaveBeenCalledOnce();
    expect(subscription.stop).toHaveBeenCalledOnce();
    act(() => authListener({ uid: "late-user" } as User));
    act(() => retry());
    expect(subscriptions).toHaveLength(1);
  });
});
