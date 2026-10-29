import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

interface Props extends ButtonProps {
  onRun: () => Promise<unknown>;
}

export function AsyncButton({ onRun, children, ...props }: Props) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      {...props}
      disabled={busy || props.disabled}
      onClick={async (e) => {
        setBusy(true);
        try {
          await onRun();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "…" : children}
    </Button>
  );
}