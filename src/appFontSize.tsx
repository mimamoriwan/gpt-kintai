import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

export type AppFontSize = "standard" | "large" | "extra-large";

const appFontSizeStorageKey = "gyoumulog-help-font-size";

type AppFontSizeContextValue = {
  fontSize: AppFontSize;
  setFontSize: (size: AppFontSize) => void;
};

const AppFontSizeContext = createContext<AppFontSizeContextValue | null>(null);

function readAppFontSize(): AppFontSize {
  const saved = window.localStorage.getItem(appFontSizeStorageKey);
  return saved === "standard" || saved === "large" || saved === "extra-large" ? saved : "large";
}

export function AppFontSizeProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSizeState] = useState<AppFontSize>(readAppFontSize);

  useLayoutEffect(() => {
    document.documentElement.dataset.fontSize = fontSize;
  }, [fontSize]);

  const value = useMemo<AppFontSizeContextValue>(() => ({
    fontSize,
    setFontSize: (size) => {
      setFontSizeState(size);
      window.localStorage.setItem(appFontSizeStorageKey, size);
    }
  }), [fontSize]);

  return <AppFontSizeContext.Provider value={value}>{children}</AppFontSizeContext.Provider>;
}

export function useAppFontSize() {
  const value = useContext(AppFontSizeContext);
  if (!value) throw new Error("AppFontSizeProvider is missing");
  return value;
}
