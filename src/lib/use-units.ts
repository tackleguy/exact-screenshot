"use client";

import { useSyncExternalStore } from "react";
import { getUnits, UNITS_EVENT, type Units } from "./units";

/** The current units; components re-render when the setting changes. */
export function useUnits(): Units {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener(UNITS_EVENT, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(UNITS_EVENT, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    getUnits,
    () => "imperial",
  );
}
