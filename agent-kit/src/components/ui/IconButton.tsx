import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Icon-only button. `label` is both the accessible name and the hover tooltip. */
export function IconButton({ label, children, className = "", ...rest }:
  { label: string; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title">) {
  return (
    <button type="button" className={`lgk-icon-btn ${className}`} title={label} aria-label={label} {...rest}>
      {children}
    </button>
  );
}
