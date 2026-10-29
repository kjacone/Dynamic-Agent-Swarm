/** Token storage, bound to the server origin it was entered for. */
const origin = (url: string) => { try { return new URL(url).origin; } catch { return null; } };

export function getStoredToken(ns: string, apiUrl: string): string | undefined {
  try {
    const raw = localStorage.getItem(`${ns}:token`);
    if (!raw) return undefined;
    const { origin: o, token } = JSON.parse(raw) as { origin: string; token: string };
    // Never hand a token to a different server than the one it was saved for.
    return o && o === origin(apiUrl) ? token : undefined;
  } catch { return undefined; }
}

export function setStoredToken(ns: string, apiUrl: string, token: string | undefined) {
  try {
    const o = origin(apiUrl);
    if (!token || !o) localStorage.removeItem(`${ns}:token`);
    else localStorage.setItem(`${ns}:token`, JSON.stringify({ origin: o, token }));
  } catch { /* storage unavailable */ }
}
