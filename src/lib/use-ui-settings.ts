"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  applyUiSettingsToDocument,
  DEFAULT_UI_SETTINGS,
  getUiSettings,
  UI_SETTINGS_EVENT,
  type UiSettings,
} from "./ui-settings";

/** Subscribes a React component to persistent UI settings. */
export function useUiSettings(): UiSettings {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener(UI_SETTINGS_EVENT, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(UI_SETTINGS_EVENT, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    getUiSettings,
    () => DEFAULT_UI_SETTINGS,
  );
}

/** Synchronizes UI settings to <html> on mount, across tabs, and on OS color-scheme changes. */
export function useApplyUiSettings(): UiSettings {
  const settings = useUiSettings();
  useEffect(() => {
    applyUiSettingsToDocument(settings);
    if (settings.theme !== "system" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onSchemeChange = () => applyUiSettingsToDocument(settings);
    mq.addEventListener("change", onSchemeChange);
    return () => mq.removeEventListener("change", onSchemeChange);
  }, [settings]);
  return settings;
}
