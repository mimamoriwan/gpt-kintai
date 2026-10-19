import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut, type User } from "firebase/auth";
import { disableAnnouncementPush } from "./services/announcementPush";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import type { UserProfile } from "./types";
import { completeInitialPasswordChange as saveInitialPassword } from "./services/api";
import { getAppCheckRecoveryState, subscribeToAppCheckRecovery } from "./lib/appCheckRecovery";

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  profileError: "unavailable" | "missing" | "session-unavailable" | null;
  sessionReauthRequired: boolean;
}

interface AuthValue extends AuthState {
  passwordChangePending: boolean;
  passwordChangeNeedsReauth: boolean;
  completeInitialPasswordChange: (newPassword: string) => Promise<void>;
  retryProfile: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
interface PasswordAttempt { uid: string; phase: "change" | "renew"; inFlight: boolean }

function passwordFlowError(code: string) { return Object.assign(new Error("Password setup could not complete."), { code }); }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, profile: null, loading: true, profileError: null, sessionReauthRequired: false });
  const retryProfileRef = useRef<() => void>(() => {});
  const retryProfile = useCallback(() => retryProfileRef.current(), []);
  const [passwordChangePending, setPasswordChangePending] = useState(false);
  const [passwordChangeNeedsReauth, setPasswordChangeNeedsReauth] = useState(false);
  const passwordAttemptRef = useRef<PasswordAttempt | null>(null);
  const loginAttemptRef = useRef(0);
  const afterLoginRef = useRef<(user: User) => void>(() => {});

  useEffect(() => {
    let active = true;
    let generation = 0;
    let currentUser: User | null = null;
    let stopProfile = () => {};
    let recoveryNeeded = false;
    let recoveryQueued = false;
    let nextRecoveryAt = 0;

    function subscribeProfile(nextUser: User | null) {
      const subscriptionGeneration = ++generation;
      recoveryNeeded = false;
      stopProfile();
      stopProfile = () => {};
      setState({ user: nextUser, profile: null, loading: Boolean(nextUser), profileError: null, sessionReauthRequired: false });
      if (!nextUser) return;

      const isCurrent = () => active && generation === subscriptionGeneration;
      let snapshotGeneration = 0;
      const unavailable = () => {
        snapshotGeneration++;
        if (isCurrent()) {
          recoveryNeeded = true;
          setState({ user: nextUser, profile: null, loading: false, profileError: "unavailable", sessionReauthRequired: false });
        }
      };
      try {
        stopProfile = onSnapshot(doc(db, "users", nextUser.uid), { includeMetadataChanges: true }, (snapshot) => {
          if (!isCurrent()) return;
          const thisSnapshot = ++snapshotGeneration;
          const profile = snapshot.exists() ? snapshot.data() as UserProfile : null;
          // An empty offline cache cannot confirm that the server profile is missing.
          const profileError = profile ? null : snapshot.metadata.fromCache ? "unavailable" : "missing";
          recoveryNeeded = profileError === "unavailable";
          if (!profile?.active || profile.passwordChangeRequired || profile.passwordAuthTimeAfter === undefined) {
            setState({ user: nextUser, profile, loading: false, profileError, sessionReauthRequired: false });
            return;
          }
          // Only accounts with a completed reset need the additional token check.
          const tokenUser = auth.currentUser;
          const currentSnapshot = () => isCurrent() && snapshotGeneration === thisSnapshot;
          const tokenUnavailable = () => {
            if (currentSnapshot()) {
              recoveryNeeded = true;
              setState({ user: nextUser, profile: null, loading: false, profileError: "session-unavailable", sessionReauthRequired: false });
            }
          };
          if (!tokenUser || tokenUser.uid !== nextUser.uid || !Number.isFinite(profile.passwordAuthTimeAfter)) {
            tokenUnavailable();
            return;
          }
          setState({ user: tokenUser, profile: null, loading: true, profileError: null, sessionReauthRequired: false });
          void tokenUser.getIdTokenResult().then((result) => {
            if (!currentSnapshot()) return;
            if (auth.currentUser !== tokenUser) {
              // Same-UID sign-in can replace the User without emitting an auth event.
              subscribeProfile(auth.currentUser);
              return;
            }
            const authTime = result.claims.auth_time;
            const sessionReauthRequired = typeof authTime !== "number" || !Number.isFinite(authTime) || authTime <= profile.passwordAuthTimeAfter!;
            recoveryNeeded = false;
            setState({ user: tokenUser, profile, loading: false, profileError: null, sessionReauthRequired });
          }).catch(tokenUnavailable);
        }, unavailable);
      } catch {
        unavailable();
      }
    }

    // A successful sign-in with the same UID does not restart onAuthStateChanged.
    retryProfileRef.current = () => {
      if (active && auth.currentUser) {
        currentUser = auth.currentUser;
        subscribeProfile(currentUser);
      }
    };
    afterLoginRef.current = (user) => {
      if (active && auth.currentUser === user && currentUser?.uid === user.uid && (currentUser !== user || recoveryNeeded)) {
        currentUser = user;
        subscribeProfile(user);
      }
    };

    function canRecover() {
      return active && recoveryNeeded && document.visibilityState === "visible" && navigator.onLine !== false &&
        getAppCheckRecoveryState() !== "throttled" && auth.currentUser !== null && auth.currentUser.uid === currentUser?.uid;
    }
    function recoverOnResume() {
      if (!canRecover() || recoveryQueued) return;
      recoveryQueued = true;
      // Browsers can emit several resume events together. Retry only a failed
      // subscription, and never replace a healthy screen containing user input.
      queueMicrotask(() => {
        recoveryQueued = false;
        if (!canRecover() || Date.now() < nextRecoveryAt) return;
        // Event-driven cooldown: no timer or background retry loop is needed.
        nextRecoveryAt = Date.now() + 5_000;
        currentUser = auth.currentUser;
        subscribeProfile(currentUser);
      });
    }
    let lastAppCheckState = getAppCheckRecoveryState();
    const stopAppCheckRecovery = subscribeToAppCheckRecovery(() => {
      const next = getAppCheckRecoveryState();
      const recovered = lastAppCheckState !== null && next === null;
      lastAppCheckState = next;
      if (recovered) {
        nextRecoveryAt = 0;
        recoverOnResume();
      }
    });
    document.addEventListener("visibilitychange", recoverOnResume);
    window.addEventListener("focus", recoverOnResume);
    window.addEventListener("pageshow", recoverOnResume);
    window.addEventListener("online", recoverOnResume);
    const stopAuth = onAuthStateChanged(auth, (nextUser) => {
      if (!active) return;
      if (currentUser?.uid !== nextUser?.uid) {
        loginAttemptRef.current++;
        nextRecoveryAt = 0;
        passwordAttemptRef.current = null;
        setPasswordChangePending(false);
        setPasswordChangeNeedsReauth(false);
      }
      currentUser = nextUser;
      subscribeProfile(nextUser);
    });

    return () => {
      active = false;
      generation++;
      loginAttemptRef.current++;
      retryProfileRef.current = () => {};
      afterLoginRef.current = () => {};
      passwordAttemptRef.current = null;
      document.removeEventListener("visibilitychange", recoverOnResume);
      window.removeEventListener("focus", recoverOnResume);
      window.removeEventListener("pageshow", recoverOnResume);
      window.removeEventListener("online", recoverOnResume);
      stopAppCheckRecovery();
      stopProfile();
      stopAuth();
    };
  }, []);

  const value = useMemo<AuthValue>(() => ({
    ...state,
    retryProfile,
    passwordChangePending: passwordChangePending || state.sessionReauthRequired,
    passwordChangeNeedsReauth: passwordChangeNeedsReauth || state.sessionReauthRequired,
    async completeInitialPasswordChange(newPassword) {
      const user = auth.currentUser;
      if (!user?.email || user.uid !== state.user?.uid) throw passwordFlowError("auth/requires-recent-login");
      let attempt = passwordAttemptRef.current;
      if (!attempt || attempt.uid !== user.uid) {
        attempt = { uid: user.uid, phase: state.sessionReauthRequired ? "renew" : "change", inFlight: false };
        passwordAttemptRef.current = attempt;
      }
      if (attempt.inFlight) throw passwordFlowError("auth/password-change-in-progress");
      attempt.inFlight = true;
      setPasswordChangePending(true);
      if (attempt.phase === "renew") setPasswordChangeNeedsReauth(true);
      const ensureCurrent = () => {
        if (passwordAttemptRef.current !== attempt || auth.currentUser?.uid !== user.uid) throw passwordFlowError("auth/initial-password-change-cancelled");
      };
      try {
        if (attempt.phase === "change") {
          await saveInitialPassword({ newPassword });
          ensureCurrent();
          attempt.phase = "renew";
          setPasswordChangeNeedsReauth(true);
        }
        try {
          await signInWithEmailAndPassword(auth, user.email, newPassword);
        } catch {
          ensureCurrent();
          throw passwordFlowError("auth/password-change-reauth-required");
        }
        ensureCurrent();
        // Profile updates can arrive before sign-in finishes. Keep the gate closed
        // until credentials are renewed, then wait for a fresh profile listener.
        retryProfile();
        passwordAttemptRef.current = null;
        setPasswordChangePending(false);
        setPasswordChangeNeedsReauth(false);
      } finally {
        if (passwordAttemptRef.current === attempt) attempt.inFlight = false;
      }
    },
    async login(email, password) {
      const attempt = ++loginAttemptRef.current;
      const result = await signInWithEmailAndPassword(auth, email.trim(), password);
      if (attempt === loginAttemptRef.current) afterLoginRef.current(result.user);
    },
    async logout() { loginAttemptRef.current++; await disableAnnouncementPush().catch(() => {}); await firebaseSignOut(auth); }
  }), [passwordChangeNeedsReauth, passwordChangePending, retryProfile, state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
