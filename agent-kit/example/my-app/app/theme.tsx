"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LangGraphKitProvider,
  type LangGraphKitProviderProps,

} from "langgraph-kit";

const STORAGE_KEY = "lgk-theme";

/** Default = blue primary, follows OS. */
const DEFAULT_THEME: ThemeConfig = {
  mode: "system",
  tokens: { accent: "#2563eb", accentInk: "#ffffff" },
};

interface AppThemeCtx {
  theme: ThemeConfig;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: string, ink?: string) => void;
  setTokens: (tokens: ThemeTokens) => void;
  reset: () => void;
}

const Ctx = createContext<AppThemeCtx | null>(null);

export function useAppTheme(): AppThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("langgraph-kit: wrap your app in <AppThemeProvider>");
  return v;
}

type AppThemeProviderProps = { children: ReactNode } & Omit<LangGraphKitProviderProps, "theme" | "children">;

export function AppThemeProvider({ children, ...rest }: AppThemeProviderProps) {
  const [theme, setTheme] = useState<ThemeConfig>(DEFAULT_THEME);
  const [hydrated, setHydrated] = useState(false);

  // Load once on mount (client-only, keeps SSR output stable).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as ThemeConfig;
        setTheme((t) => ({ ...t, ...saved, tokens: { ...t.tokens, ...saved.tokens } }));
      }
    } catch { /* storage unavailable */ }
    setHydrated(true);
  }, []);

  // Persist after hydration.
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(theme)); } catch { /* unavailable */ }
  }, [theme, hydrated]);

  const value = useMemo<AppThemeCtx>(() => ({
    theme,
    setMode: (mode) => setTheme((t) => ({ ...t, mode })),
    setAccent: (accent, ink = "#ffffff") =>
      setTheme((t) => ({ ...t, tokens: { ...t.tokens, accent, accentInk: ink } })),
    setTokens: (tokens) => setTheme((t) => ({ ...t, tokens: { ...t.tokens, ...tokens } })),
    reset: () => setTheme(DEFAULT_THEME),
  }), [theme]);

  return (
    <Ctx.Provider value={value}>
      <LangGraphKitProvider {...rest} theme="light">
        {children}
      </LangGraphKitProvider>
    </Ctx.Provider>
  );
}