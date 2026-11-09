"use client";

import { type CSSProperties } from "react";
import { useAppTheme } from "../theme";


const MODES = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const ACCENTS = [
  { hex: "#2563eb", name: "Blue" },
  { hex: "#7c3aed", name: "Violet" },
  { hex: "#db2777", name: "Pink" },
  { hex: "#16a34a", name: "Green" },
  { hex: "#ea580c", name: "Orange" },
  { hex: "#0f172a", name: "Slate" },
];

/** Pick a foreground that stays legible on top of an arbitrary accent. */
function readableInk(hex: string): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return "#ffffff";
  const n = Number.parseInt(full, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? "#0b1020" : "#ffffff";
}

/** <input type="color"> only accepts #rrggbb. */
function asHex6(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#2563eb";
}

const ghostBtn: CSSProperties = {
  font: "inherit",
  fontSize: 12,
  cursor: "pointer",
  padding: "2px 8px",
  borderRadius: 6,
  border: "1px solid var(--lgk-line)",
  background: "transparent",
  color: "inherit",
};

export function ThemeSwitcher() {
  const { theme, setMode, setAccent, reset } = useAppTheme();
  const accent = theme.tokens.accent;

  return (
    <div style={{ display: "grid", gap: 12, fontSize: 13 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <strong
          style={{
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.55,
          }}
        >
          Theme
        </strong>
        <button type="button" onClick={reset} style={ghostBtn}>
          Reset
        </button>
      </div>

      {/* Color mode */}
      <div
        role="group"
        aria-label="Color mode"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 4,
          padding: 4,
          borderRadius: 10,
          border: "1px solid var(--lgk-line)",
        }}
      >
        {MODES.map((m) => {
          const active = theme.mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              aria-pressed={active}
              onClick={() => setMode(m.value)}
              style={{
                padding: "6px 0",
                font: "inherit",
                cursor: "pointer",
                borderRadius: 7,
                border: "1px solid transparent",
                background: active ? theme.tokens.accent : "transparent",
                color: active ? theme.tokens.accentInk : "inherit",
                transition: "background .15s, color .15s",
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Accent */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {ACCENTS.map((a) => {
          const active = accent.toLowerCase() === a.hex;
          return (
            <button
              key={a.hex}
              type="button"
              title={a.name}
              aria-label={`${a.name} accent`}
              aria-pressed={active}
              onClick={() => setAccent(a.hex, readableInk(a.hex))}
              style={{
                width: 24,
                height: 24,
                padding: 0,
                borderRadius: 999,
                cursor: "pointer",
                background: a.hex,
                border: "1px solid rgb(0 0 0 / 0.18)",
                outline: active ? `2px solid ${a.hex}` : "none",
                outlineOffset: 2,
              }}
            />
          );
        })}

        {/* Custom accent */}
        <label
          title="Custom accent"
          style={{
            position: "relative",
            width: 24,
            height: 24,
            borderRadius: 999,
            overflow: "hidden",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            border: "1px dashed var(--lgk-line)",
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          +
          <input
            type="color"
            aria-label="Custom accent color"
            value={asHex6(accent)}
            onChange={(e) => setAccent(e.target.value, readableInk(e.target.value))}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              padding: 0,
              border: "none",
              opacity: 0,
              cursor: "pointer",
            }}
          />
        </label>
      </div>
    </div>
  );
}