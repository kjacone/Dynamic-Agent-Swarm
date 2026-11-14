import { useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ModelCfg } from "@/lib/api";

export const MODEL_PRESETS = [
  "groq:openai/gpt-oss-120b",
  "groq:qwen/qwen3.8-27b",
  "openrouter:openai/gpt-oss-120b",
  "litellm:groq/openai/gpt-oss-120b",
  "ollama:llama3.1:8b",
  "ollama:qwen2.5:7b-instruct",
  "ollama:qwen2.5:3b-instruct",
  "openai:gpt-4o-mini",
  "openai:gpt-4o",
  "anthropic:claude-3-5-sonnet-latest",
  "google_genai:gemini-1.5-pro",
];

const CUSTOM = "__custom__";

/** Model picker: registered models first, curated presets below, free-text as a fallback. */
export function ModelSelect({
  value,
  onChange,
  models = [],
  allowEmpty = false,
  emptyLabel = "Inherit supervisor model",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  models?: ModelCfg[];
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  const registered = models.filter((m) => m.name);
  const isKnown =
    !value || registered.some((m) => m.name === value) || MODEL_PRESETS.includes(value);
  const [custom, setCustom] = useState(false);

  return (
    <div className="min-w-0 space-y-1.5">
      <select
        aria-label="Model"
        className={cn(
          "h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm",
          "focus:outline-none focus:ring-1 focus:ring-ring",
          className,
        )}
        value={custom ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(e.target.value);
        }}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {value && !isKnown && <option value={value}>{value} · current</option>}
        {registered.length > 0 && (
          <optgroup label="Registered">
            {registered.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name} · {m.provider}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Presets">
          {MODEL_PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </optgroup>
        <option value={CUSTOM}>Custom model…</option>
      </select>
      {custom && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="provider:model or registered id"
        />
      )}
    </div>
  );
}
