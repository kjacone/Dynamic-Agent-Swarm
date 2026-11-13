import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function JsonView({ data, className }: { data: unknown; className?: string }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(data, null, 2) ?? "";
  return (
    <div className={cn("group relative overflow-hidden rounded-lg border bg-muted/30", className)}>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }).catch(() => {});
        }}
        className="absolute right-2 top-2 z-10 hidden items-center gap-1 rounded-md border bg-card/90 px-1.5 py-1 text-[10px] text-muted-foreground shadow-sm hover:text-foreground group-hover:inline-flex"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="max-h-96 overflow-auto p-3 pr-16 text-xs leading-relaxed">{text}</pre>
    </div>
  );
}
