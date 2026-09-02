import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { getToken as getAppCheckToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true" ||
  (!import.meta.env.VITE_FIREBASE_PROJECT_ID && import.meta.env.DEV);

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "demo-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "demo-kintai.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-kintai",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "demo-kintai.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "000000000000",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:000000000000:web:demo"
};

const app = initializeApp(config);
const recaptchaEnterpriseSiteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
export const appCheck = !useEmulators && recaptchaEnterpriseSiteKey && typeof window !== "undefined"
  ? initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey),
    isTokenAutoRefreshEnabled: true
  })
  : null;
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, "asia-northeast1");
export const storage = getStorage(app);

void setPersistence(auth, browserLocalPersistence);

if (useEmulators && typeof window !== "undefined" && !window.__firebaseEmulatorsConnected) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  window.__firebaseEmulatorsConnected = true;
}

export const usingEmulators = useEmulators;

export async function prepareCallableSecurityContext(forceRefresh = false): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    const error = new Error("ログイン状態を確認できません。もう一度ログインしてください。") as Error & { code: string };
    error.code = "functions/unauthenticated";
    throw error;
  }
  await currentUser.getIdToken(forceRefresh);
  if (appCheck) {
    await getAppCheckToken(appCheck, forceRefresh);
  } else if (!useEmulators) {
    throw new Error("アプリ認証の設定を確認できません。管理担当者へ連絡してください。");
  }
}

declare global {
  interface Window { __firebaseEmulatorsConnected?: boolean }
}
