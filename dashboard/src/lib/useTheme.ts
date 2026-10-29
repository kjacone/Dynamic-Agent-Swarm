import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "auto" | "light" | "dark";

const STORAGE_KEY = "nmb-theme";
const ORDER: ThemeMode[] = ["auto", "light", "dark"];

function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "auto") {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return mode;
}

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "auto") return value;
  } catch {
    /* localStorage unavailable — fall through to auto */
  }
  return "auto";
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readStoredMode);

  useEffect(() => {
    const apply = () => {
      const isDark = resolveMode(mode) === "dark";
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.dataset.themeMode = mode;
    };

    apply();

    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore quota / private mode */
    }

    if (mode !== "auto") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((prev) => ORDER[(ORDER.indexOf(prev) + 1) % ORDER.length]);
  }, []);

  const set = useCallback((next: ThemeMode) => setMode(next), []);

  return { mode, toggle, set };
}