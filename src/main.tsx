import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { AppFontSizeProvider } from "./appFontSize";
import { AuthProvider } from "./auth";
import { I18nProvider } from "./i18n";
import "./styles.css";

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppFontSizeProvider><I18nProvider><AuthProvider><App /></AuthProvider></I18nProvider></AppFontSizeProvider>
  </StrictMode>
);
