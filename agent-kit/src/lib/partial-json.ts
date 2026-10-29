/** Best-effort parse of a JSON string that is still streaming in. */
export function parsePartialJson(input: string): unknown {
  try { return JSON.parse(input); } catch { /* fall through */ }
  let s = input.trim();
  for (let attempt = 0; attempt < 8 && s; attempt++) {
    try { return JSON.parse(close(s)); } catch { /* drop the last incomplete member */ }
    const cut = Math.max(s.lastIndexOf(","), s.lastIndexOf("{"), s.lastIndexOf("["));
    if (cut <= 0) break;
    s = s.slice(0, s[cut] === "," ? cut : cut + 1);
  }
  return undefined;
}

function close(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  out = out.trimEnd();
  if (out.endsWith(",")) out = out.slice(0, -1);
  else if (out.endsWith(":")) out += "null";
  while (stack.length) out += stack.pop() === "{" ? "}" : "]";
  return out;
}
