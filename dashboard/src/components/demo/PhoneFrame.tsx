import type { ReactNode } from "react";
import { BatteryFull, Signal, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "light" | "dark" | "whatsapp";

const BAR_TONE: Record<Tone, string> = {
  light: "text-slate-900",
  dark: "text-slate-100",
  whatsapp: "text-white",
};

/** A phone bezel with a status bar. The screen is a fixed-height flex column so each
 * channel can pin its own header/footer and scroll only the transcript. */
export function PhoneFrame({
  tone = "light",
  children,
  caption,
  className,
  screenClassName,
  screenHeight = "h-[640px]",
}: {
  tone?: Tone;
  children: ReactNode;
  caption?: ReactNode;
  className?: string;
  screenClassName?: string;
  screenHeight?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[372px]", className)}>
      <div className="relative rounded-[2.75rem] border border-slate-300/60 bg-slate-950 p-[10px] shadow-[0_30px_60px_-25px_rgba(15,23,42,0.55)]">
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 h-[22px] w-[94px] -translate-x-1/2 rounded-full bg-slate-950" />
        <div className={cn("relative flex flex-col overflow-hidden rounded-[2.15rem] bg-white",
          tone === "dark" ? "" : "text-slate-900", screenHeight, screenClassName)}>
          <div
            className={cn(
              "flex shrink-0 items-center justify-between px-6 pb-1 pt-2.5 text-[11px] font-semibold tabular-nums",
              BAR_TONE[tone],
            )}
          >
            <span>9:41</span>
            <span className="flex items-center gap-1">
              <Signal className="h-3 w-3" />
              <Wifi className="h-3 w-3" />
              <BatteryFull className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
      </div>
      {caption ? <div className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">{caption}</div> : null}
    </div>
  );
}
