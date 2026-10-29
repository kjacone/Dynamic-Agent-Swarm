import { useState } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon } from "../ui/icons";
import { IconButton } from "../ui/IconButton";

/** `‹ 2 / 3 ›` — switch between versions created by editing or regenerating. */
export function BranchSwitcher({ branch, branchOptions, onSelect, disabled }: {
  branch?: string; branchOptions?: string[]; onSelect: (branch: string) => void; disabled?: boolean;
}) {
  if (!branch || !branchOptions || branchOptions.length < 2) return null;
  const i = branchOptions.indexOf(branch);
  return (
    <div className="lgk-branch" role="group" aria-label="Message versions">
      <IconButton label="Previous version" disabled={disabled || i <= 0} onClick={() => onSelect(branchOptions[i - 1])}><ChevronLeftIcon /></IconButton>
      <span>{i + 1} / {branchOptions.length}</span>
      <IconButton label="Next version" disabled={disabled || i >= branchOptions.length - 1} onClick={() => onSelect(branchOptions[i + 1])}><ChevronRightIcon /></IconButton>
    </div>
  );
}

export function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? "Copied" : "Copy"} disabled={disabled || !text}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  );
}
