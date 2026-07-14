import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import type { UserProfile } from "./types";

interface AuthValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stopProfile = () => {};
    const stopAuth = onAuthStateChanged(auth, (nextUser) => {
      stopProfile();
      stopProfile = () => {};
      setUser(nextUser);
      if (!nextUser) {
        setProfile(null);
        setLoading(false);
        return;
      }
      stopProfile = onSnapshot(doc(db, "users", nextUser.uid), (snapshot) => {
        setProfile(snapshot.exists() ? snapshot.data() as UserProfile : null);
        setLoading(false);
      }, () => {
        setProfile(null);
        setLoading(false);
      });
    });

    return () => {
      stopProfile();
      stopAuth();
    };
  }, []);

  const value = useMemo<AuthValue>(() => ({
    user,
    profile,
    loading,
    async login(email, password) {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    },
    async logout() { await firebaseSignOut(auth); }
  }), [loading, profile, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
