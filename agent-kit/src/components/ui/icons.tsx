



import type { ReactNode, SVGProps } from "react";

/** Shared look for the customer screens: same lagoon palette and type as the phone page. */

export const uiCss = `
@import url("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=DM+Sans:wght@400;500;600&display=swap");

.ui-root {
  --ink: #0c2b35;
  --mute: #58777d;
  --line: #d5e3e0;
  --paper: #ffffff;
  --wash: #f2f6f4;
  --teal: #14586a;
  --foam: #7ee6c4;
  --foam-ink: #04251c;
  min-height: 100dvh;
  color: var(--ink);
  font-family: "DM Sans", system-ui, sans-serif;
  background: radial-gradient(800px 420px at 100% 0%, #dcefe9 0%, transparent 70%), var(--wash);
}
.ui-fill { height: 100dvh; min-height: 0; }

.ui-page { max-width: 900px; margin: 0 auto; padding: 36px 28px 64px; display: grid; gap: 24px; align-content: start; }
.ui-head h1 {
  margin: 0; font-family: "Bricolage Grotesque", sans-serif; font-weight: 700;
  font-size: clamp(28px, 3.6vw, 38px); letter-spacing: -0.02em; line-height: 1.08;
}
.ui-head p { margin: 8px 0 0; max-width: 60ch; color: var(--mute); font-size: 15px; line-height: 1.55; }
.ui-title { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
.ui-hint { margin: 0 0 12px; font-size: 13.5px; color: var(--mute); }

/* link to the phone line */
.ui-callout {
  display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 18px;
  text-decoration: none; color: #eafaf5; background: linear-gradient(135deg, #0f3b47, #14586a);
  transition: transform .2s, box-shadow .2s;
}
.ui-callout:hover { transform: translateY(-1px); box-shadow: 0 14px 30px -16px rgba(12, 43, 53, .7); }
.ui-callout:focus-visible, .ui-agent:focus-visible, .ui-chip:focus-visible, .ui-btn:focus-visible, .ui-report:focus-visible {
  outline: 2px solid var(--teal); outline-offset: 3px;
}
.ui-callout-icon {
  font-size: 20px; flex: none; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center;
  background: var(--foam); color: var(--foam-ink);
}
.ui-callout strong { display: block; font-size: 15px; }
.ui-callout .sub { font-size: 13px; color: #a9d9ce; }
.ui-callout-arrow { margin-left: auto; opacity: .8; display: flex; font-size: 18px; }

/* agent picker */
.ui-agents { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
.ui-agent {
  display: flex; align-items: center; gap: 12px; text-align: left; cursor: pointer; padding: 14px;
  border-radius: 16px; border: 1.5px solid var(--line); background: var(--paper); font: inherit; color: inherit;
  transition: border-color .2s, box-shadow .2s;
}
.ui-agent:hover { border-color: #9cc3c0; }
.ui-agent[aria-checked="true"] { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(126, 230, 196, .45); }
.ui-avatar {
  flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
  background: var(--wash); color: var(--teal); font-family: "Bricolage Grotesque", sans-serif; font-weight: 700;
}
.ui-agent[aria-checked="true"] .ui-avatar { background: var(--teal); color: #fff; }
.ui-agent-name { display: block; font-weight: 600; font-size: 15px; overflow-wrap: anywhere; }
.ui-pill {
  display: inline-block; margin-top: 3px; font-size: 11.5px; font-weight: 600; padding: 2px 8px;
  border-radius: 999px; background: #e3f5ef; color: #0c5a45;
}

/* loading, error, empty */
.ui-state {
  display: flex; align-items: center; gap: 12px; padding: 18px 20px; border-radius: 16px;
  background: #fff; border: 1px solid var(--line); font-size: 15px;
}
.ui-state.error { flex-direction: column; align-items: flex-start; gap: 6px; border-color: #f3c4bd; background: #fff6f4; }
.ui-state.error strong { color: #b42318; }
.ui-state p { margin: 0; font-size: 14px; color: var(--mute); line-height: 1.5; }
.ui-spinner {
  width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--line);
  border-top-color: var(--teal); animation: ui-spin .8s linear infinite;
}
@keyframes ui-spin { to { transform: rotate(360deg); } }

/* filter chips */
.ui-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.ui-chip {
  cursor: pointer; display: inline-flex; gap: 8px; align-items: center; padding: 8px 14px; border-radius: 999px;
  border: 1px solid var(--line); background: #fff; font: inherit; font-size: 14px; color: inherit;
  text-transform: capitalize; transition: background .2s, border-color .2s;
}
.ui-chip b { font-weight: 600; font-size: 12.5px; color: var(--mute); }
.ui-chip:hover { border-color: #9cc3c0; }
.ui-chip[aria-pressed="true"] { background: var(--teal); border-color: var(--teal); color: #fff; }
.ui-chip[aria-pressed="true"] b { color: #bff5e2; }

/* table */
.ui-table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 18px; background: #fff; }
.ui-table { width: 100%; min-width: 560px; border-collapse: collapse; font-size: 14px; }
.ui-table th {
  text-align: left; font-weight: 500; font-size: 13px; color: var(--mute); padding: 12px 16px;
  border-bottom: 1px solid var(--line); background: #fafcfb;
}
.ui-table td { padding: 14px 16px; border-bottom: 1px solid #edf3f1; vertical-align: middle; }
.ui-table tr:last-child td { border-bottom: 0; }
.ui-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.ui-order-id { font-weight: 600; }
.ui-sub { display: block; font-size: 12.5px; color: var(--mute); }
.ui-badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; text-transform: capitalize; }
.ui-badge.open { background: #fef3c7; color: #92400e; }
.ui-badge.shipped { background: #dff1f5; color: #0f4d5e; }
.ui-badge.delivered { background: #dcfce7; color: #166534; }
.ui-empty { padding: 36px 16px; text-align: center; color: var(--mute); }

/* tool cards inside the chat */
.ui-tool { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; font-size: 14px; }
.ui-tool svg { flex: none; font-size: 16px; color: #0c8a68; }
.ui-report {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 12px 14px;
  border-radius: 14px; cursor: pointer;
}
.ui-report-icon {
  font-size: 20px; flex: none; width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center;
  background: #e3f5ef; color: #0c5a45;
}
.ui-report-text { display: grid; gap: 2px; min-width: 0; }
.ui-report-text strong { overflow-wrap: anywhere; }
.ui-report-text small { display: flex; align-items: center; gap: 6px; font-size: 12.5px; opacity: .75; }
.ui-dot { width: 7px; height: 7px; border-radius: 50%; background: #14a37f; animation: ui-pulse 1.2s ease-in-out infinite; }
@keyframes ui-pulse { 50% { opacity: .25; } }

/* report document in the side panel */
.ui-doc {
  white-space: pre-wrap; max-width: 68ch; font-size: 15px; line-height: 1.7;
  font-family: "DM Sans", system-ui, sans-serif;
}
.ui-doc-actions { margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5ece9; display: flex; gap: 8px; }
.ui-btn {
  cursor: pointer; font: inherit; font-size: 14px; font-weight: 500; padding: 9px 16px; border-radius: 10px;
  border: 1px solid #14586a; background: #14586a; color: #fff;
}
.ui-btn:hover { background: #0f4655; }

@media (max-width: 560px) {
  .ui-page { padding: 24px 16px 48px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-spinner, .ui-dot { animation: none; }
  .ui-callout { transition: none; }
}
`;

export function UiStyles() {
  return <style>{uiCss}</style>;
}

function Icon({ children, ...p }: { children: ReactNode } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...p}>
      {children}
    </svg>
  );
}
type P = SVGProps<SVGSVGElement>;

// Used by the customer screens
export const PhoneIcon = (p: P) => <Icon {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></Icon>;
export const ArrowIcon = (p: P) => <Icon {...p}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></Icon>;
export const DocIcon = (p: P) => <Icon {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h6" /></Icon>;

// General icon set
export const CopyIcon = (p: P) => <Icon {...p}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Icon>;
export const CheckIcon = (p: P) => <Icon {...p}><path d="M20 6 9 17l-5-5" /></Icon>;
export const RefreshIcon = (p: P) => <Icon {...p}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></Icon>;
export const PencilIcon = (p: P) => <Icon {...p}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></Icon>;
export const SendIcon = (p: P) => <Icon {...p}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></Icon>;
export const XIcon = (p: P) => <Icon {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>;
export const ChevronLeftIcon = (p: P) => <Icon {...p}><path d="m15 18-6-6 6-6" /></Icon>;
export const ChevronRightIcon = (p: P) => <Icon {...p}><path d="m9 18 6-6-6-6" /></Icon>;
export const ChevronDownIcon = (p: P) => <Icon {...p}><path d="m6 9 6 6 6-6" /></Icon>;
export const ChevronUpIcon = (p: P) => <Icon {...p}><path d="m18 15-6-6-6 6" /></Icon>;
export const PlusIcon = (p: P) => <Icon {...p}><path d="M5 12h14" /><path d="M12 5v14" /></Icon>;
export const PaperclipIcon = (p: P) => <Icon {...p}><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></Icon>;
export const FileIcon = (p: P) => <Icon {...p}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></Icon>;
export const ArrowDownIcon = (p: P) => <Icon {...p}><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></Icon>;
export const PanelLeftIcon = (p: P) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></Icon>;
export const NewChatIcon = (p: P) => <Icon {...p}><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" /></Icon>;
export const TrashIcon = (p: P) => <Icon {...p}><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Icon>;
export const SpinnerIcon = (p: P) => <Icon {...p} className={`lgk-spin ${p.className ?? ""}`}><path d="M21 12a9 9 0 1 1-6.22-8.56" /></Icon>;
export const HistoryIcon = (p: P) => <Icon {...p}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></Icon>;