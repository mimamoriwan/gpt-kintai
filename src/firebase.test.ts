import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  idToken: vi.fn(),
  appToken: vi.fn(),
  initializeAppCheck: vi.fn(),
  startLifecycle: vi.fn(),
  recordError: vi.fn(),
  recordSuccess: vi.fn(),
  auth: { currentUser: null as null | { getIdToken: (refresh: boolean) => Promise<string> } },
  appCheck: {}
}));

vi.mock("firebase/app", () => ({ initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({ getAuth: () => mocks.auth, setPersistence: vi.fn(), browserLocalPersistence: {}, connectAuthEmulator: vi.fn() }));
vi.mock("firebase/firestore", () => ({ getFirestore: () => ({}), connectFirestoreEmulator: vi.fn() }));
vi.mock("firebase/functions", () => ({ getFunctions: () => ({}), connectFunctionsEmulator: vi.fn() }));
vi.mock("firebase/storage", () => ({ getStorage: () => ({}), connectStorageEmulator: vi.fn() }));
vi.mock("firebase/app-check", () => ({
  initializeAppCheck: mocks.initializeAppCheck,
  ReCaptchaEnterpriseProvider: vi.fn(),
  getToken: mocks.appToken
}));
vi.mock("./lib/appCheckLifecycle", () => ({ startAppCheckLifecycle: mocks.startLifecycle }));
vi.mock("./lib/appCheckRecovery", () => ({ recordAppCheckError: mocks.recordError, recordAppCheckSuccess: mocks.recordSuccess }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("VITE_USE_FIREBASE_EMULATORS", "false");
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv("VITE_RECAPTCHA_ENTERPRISE_SITE_KEY", "test-site-key");
  mocks.auth.currentUser = { getIdToken: mocks.idToken };
  mocks.idToken.mockResolvedValue("id-token");
  mocks.appToken.mockResolvedValue({ token: "app-token" });
  mocks.initializeAppCheck.mockReturnValue(mocks.appCheck);
  mocks.startLifecycle.mockReturnValue(vi.fn());
});

afterEach(() => vi.unstubAllEnvs());

describe("callable token preparation", () => {
  it("prepares signed-out recovery with App Check without requiring a login token", async () => {
    mocks.auth.currentUser = null;
    const { preparePublicCallableSecurityContext } = await import("./firebase");
    await preparePublicCallableSecurityContext();
    expect(mocks.idToken).not.toHaveBeenCalled();
    expect(mocks.appToken).toHaveBeenCalledWith(mocks.appCheck, false);
  });

  it("refuses public recovery without App Check configuration outside emulators", async () => {
    mocks.auth.currentUser = null;
    vi.stubEnv("VITE_RECAPTCHA_ENTERPRISE_SITE_KEY", "");
    const { preparePublicCallableSecurityContext } = await import("./firebase");
    await expect(preparePublicCallableSecurityContext()).rejects.toThrow("アプリ認証の設定を確認できません");
  });

  it("records and propagates public recovery App Check failures", async () => {
    const error = { code: "appCheck/throttled" };
    mocks.appToken.mockRejectedValue(error);
    const { preparePublicCallableSecurityContext } = await import("./firebase");
    await expect(preparePublicCallableSecurityContext()).rejects.toBe(error);
    expect(mocks.recordError).toHaveBeenCalledWith(error);
  });
  it.each([false, true])("starts both checks together and waits for both (refresh=%s)", async (refresh) => {
    let finishAuth!: (value: string) => void;
    let finishApp!: (value: { token: string }) => void;
    mocks.idToken.mockReturnValue(new Promise<string>(resolve => { finishAuth = resolve; }));
    mocks.appToken.mockReturnValue(new Promise<{ token: string }>(resolve => { finishApp = resolve; }));
    const { prepareCallableSecurityContext } = await import("./firebase");
    const ready = vi.fn();
    const preparation = prepareCallableSecurityContext(refresh).then(ready);

    expect(mocks.idToken).toHaveBeenCalledWith(refresh);
    expect(mocks.appToken).toHaveBeenCalledWith(mocks.appCheck, refresh);
    finishAuth("id-token");
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    finishApp({ token: "app-token" });
    await preparation;
    expect(ready).toHaveBeenCalledTimes(1);
    expect(mocks.recordSuccess).toHaveBeenCalledOnce();
    expect(mocks.recordSuccess).toHaveBeenCalledWith(refresh);
  });

  it.each(["auth", "app"])("does not mark credentials ready if %s verification fails", async (failedCheck) => {
    const error = new Error("Verification unavailable");
    (failedCheck === "auth" ? mocks.idToken : mocks.appToken).mockRejectedValue(error);
    const { prepareCallableSecurityContext } = await import("./firebase");
    await expect(prepareCallableSecurityContext()).rejects.toBe(error);
    if (failedCheck === "app") expect(mocks.recordError.mock.calls).toEqual([[error]]);
    else expect(mocks.recordError).not.toHaveBeenCalled();
  });

  it("rejects a signed-out user without requesting tokens", async () => {
    mocks.auth.currentUser = null;
    const { prepareCallableSecurityContext } = await import("./firebase");
    await expect(prepareCallableSecurityContext()).rejects.toMatchObject({ code: "functions/unauthenticated" });
    expect(mocks.idToken).not.toHaveBeenCalled();
    expect(mocks.appToken).not.toHaveBeenCalled();
  });

  it("keeps App Check mandatory outside the emulator", async () => {
    vi.stubEnv("VITE_RECAPTCHA_ENTERPRISE_SITE_KEY", "");
    const { prepareCallableSecurityContext } = await import("./firebase");
    await expect(prepareCallableSecurityContext()).rejects.toThrow("アプリ認証の設定を確認できません");
    expect(mocks.startLifecycle).not.toHaveBeenCalled();
  });

  it("delegates automatic token refresh to the visibility and connectivity lifecycle", async () => {
    await import("./firebase");
    expect(mocks.initializeAppCheck).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isTokenAutoRefreshEnabled: false }));
    expect(mocks.startLifecycle.mock.calls).toEqual([[mocks.appCheck]]);
  });

  it("records App Check failure even when an Auth failure rejects the parallel preparation first", async () => {
    let failApp!: (error: unknown) => void;
    const authError = Object.assign(new Error("auth unavailable"), { code: "auth/network-request-failed" });
    const appError = Object.assign(new Error("previous 403"), { code: "appCheck/throttled" });
    mocks.idToken.mockRejectedValueOnce(authError);
    mocks.appToken.mockReturnValueOnce(new Promise((_resolve, reject) => { failApp = reject; }));
    const { prepareCallableSecurityContext } = await import("./firebase");
    await expect(prepareCallableSecurityContext()).rejects.toBe(authError);
    expect(mocks.recordError).not.toHaveBeenCalled();
    failApp(appError);
    await Promise.resolve();
    expect(mocks.recordError.mock.calls).toEqual([[appError]]);
  });

  it("does not start App Check or its lifecycle for the emulator", async () => {
    vi.stubEnv("VITE_USE_FIREBASE_EMULATORS", "true");
    const { prepareCallableSecurityContext } = await import("./firebase");
    await prepareCallableSecurityContext();
    expect(mocks.initializeAppCheck).not.toHaveBeenCalled();
    expect(mocks.startLifecycle).not.toHaveBeenCalled();
    expect(mocks.appToken).not.toHaveBeenCalled();
  });
});
