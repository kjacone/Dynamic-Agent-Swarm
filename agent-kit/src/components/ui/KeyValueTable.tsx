import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "./icons";

const isComplex = (v: unknown) => Array.isArray(v) || (typeof v === "object" && v !== null);
const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//.test(v);

export function Value({ value }: { value: unknown }) {
  if (isComplex(value)) return <code className="lgk-inline-code">{JSON.stringify(value, null, 2)}</code>;
  if (isUrl(value)) return <a href={value} target="_blank" rel="noopener noreferrer">{value}</a>;
  return <>{String(value)}</>;
}

/** Two-column view of an object's entries (or an array's items). */
export function KeyValueTable({ data, maxRows }: { data: Record<string, unknown> | unknown[]; maxRows?: number }) {
  const [all, setAll] = useState(false);
  const entries: [string | number, unknown][] = Array.isArray(data)
    ? data.map((v, i) => [i, v])
    : Object.entries(data);
  const limited = maxRows && !all ? entries.slice(0, maxRows) : entries;
  return (
    <>
      <table className="lgk-kv">
        <tbody>
          {limited.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td><Value value={v} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {maxRows && entries.length > maxRows && (
        <button type="button" className="lgk-more" onClick={() => setAll((a) => !a)}>
          {all ? <ChevronUpIcon /> : <ChevronDownIcon />} {all ? "Show less" : `Show ${entries.length - maxRows} more`}
        </button>
      )}
    </>
  );
}

/** Long text, clipped until the reader asks for more. */
export function ExpandableText({ text, maxLines = 4, maxChars = 500 }: { text: string; maxLines?: number; maxChars?: number }) {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n");
  const long = lines.length > maxLines || text.length > maxChars;
  const shown = !long || open ? text
    : text.length > maxChars ? `${text.slice(0, maxChars)}…`
    : `${lines.slice(0, maxLines).join("\n")}\n…`;
  return (
    <>
      <pre className="lgk-pre">{shown}</pre>
      {long && (
        <button type="button" className="lgk-more" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronUpIcon /> : <ChevronDownIcon />} {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}
