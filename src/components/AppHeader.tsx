import { useLayoutEffect, useRef, type ReactNode } from "react";

export function AppHeader({ children }: { children: ReactNode }) {
  const header = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = header.current;
    if (!element) return;
    // Keep generated reports and keyboard navigation clear of the variable-height
    // update and announcement banners, including after rotation or a font change.
    const measure = () => {
      const height = getComputedStyle(element).position === "sticky" ? element.offsetHeight : 0;
      document.documentElement.style.setProperty("--app-header-height", `${height}px`);
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      document.documentElement.style.removeProperty("--app-header-height");
    };
  }, []);
  return <div className="app-header" ref={header}>{children}</div>;
}
