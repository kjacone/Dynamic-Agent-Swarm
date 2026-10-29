export function JsonView({ data, className }: { data: unknown; className?: string }) {
  return (
    <pre
      className={
        "max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed " +
        (className || "")
      }
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}