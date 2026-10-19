import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { initializeAppUpdates } from "./pwaUpdate";
import { AppUpdateProvider } from "./components/AppUpdateNotice";
import App from "./App";
import { AppFontSizeProvider } from "./appFontSize";
import { AuthProvider } from "./auth";
import { I18nProvider } from "./i18n";
import "./styles.css";

initializeAppUpdates(registerSW);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppFontSizeProvider><I18nProvider><AppUpdateProvider><AuthProvider><App /></AuthProvider></AppUpdateProvider></I18nProvider></AppFontSizeProvider>
  </StrictMode>
);
