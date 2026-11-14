import { useEffect, useMemo, useRef, useState } from "react";
import { Hand, MousePointerClick, PauseCircle, RotateCcw } from "lucide-react";
import { Chat, LangGraphKitProvider, useAgentReadable, useAgentTool } from "langgraph-kit";
import "langgraph-kit/styles.css";
import { api, API_BASE, type Agent, type Tool } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { AsyncButton } from "@/components/common/AsyncButton";
import { useToast } from "@/components/ui/toast";

type FilterArgs = {
  label?: string;
  title?: string;
  query?: string;
  category?: string;
  max_price?: number | string | null;
  sort?: string;
};

type DemoSession = { agent: Agent; tools: Tool[]; key: string; keyId: string };

// Inline SVG thumbnails keep the demo offline and give the card strip something
// to show; a real catalogue returns its own image URLs.
function thumb(id: string, brand: string, name: string): string {
  const hue = (Number(id) * 47) % 360;
  const initials = `${brand.charAt(0)}${name.charAt(0)}`.toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="288" height="180">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 55% 46%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 38) % 360} 60% 28%)"/>
    </linearGradient></defs>
    <rect width="288" height="180" fill="url(#g)"/>
    <circle cx="144" cy="78" r="34" fill="rgba(255,255,255,.14)"/>
    <text x="144" y="88" text-anchor="middle" font-family="system-ui,sans-serif" font-size="26" font-weight="700" fill="rgba(255,255,255,.95)">${initials}</text>
    <text x="144" y="150" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="rgba(255,255,255,.75)">${brand}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const PRODUCTS = [
  { id: "344", name: "Iphone 18 Duo", brand: "Apple", price: 200000, category: "electronics", stock: 10, store: "74", tags: "phone smartphone 256gb" },
  { id: "341", name: "Iphone 16 Promax", brand: "Apple", price: 200000, category: "electronics", stock: 144, store: "66", tags: "phone smartphone 5g" },
  { id: "349", name: "Sucre Rollex Grande", brand: "Sucre", price: 200000, category: "fashion & apparel", stock: 20, store: "59", tags: "watch luxury" },
  { id: "410", name: "Techno Spark 30", brand: "Tecno", price: 380000, category: "electronics", stock: 35, store: "74", tags: "phone budget" },
  { id: "380", name: "Sony WH-1000XM5", brand: "Sony", price: 320000, category: "electronics", stock: 12, store: "66", tags: "headphones audio noise cancelling" },
  { id: "392", name: "JBL Flip 6", brand: "JBL", price: 95000, category: "electronics", stock: 48, store: "74", tags: "speaker bluetooth audio" },
  { id: "355", name: "Apple Watch SE", brand: "Apple", price: 210000, category: "electronics", stock: 26, store: "66", tags: "watch wearable smart" },
  { id: "366", name: "Nike Air Zoom", brand: "Nike", price: 120000, category: "fashion & apparel", stock: 18, store: "59", tags: "shoes sport running" },
  { id: "371", name: "Ceramic Dinner Set", brand: "Kariba", price: 45000, category: "home & living", stock: 30, store: "74", tags: "kitchen plates home" },
].map((p) => ({ ...p, image: thumb(p.id, p.brand, p.name) }));
type Product = (typeof PRODUCTS)[number];

const ORDERS = [
  { id: "ORD-100245", date: "2026-11-04", status: "In transit", items: "Iphone 16 Promax ×1", total: 200000, eta: "Today, by 18:00", courier: "NMB Express" },
  { id: "ORD-100246", date: "2026-11-08", status: "Processing", items: "Sucre Rollex Grande ×1", total: 200000, eta: "13 Nov", courier: "Not assigned yet" },
];
type Order = (typeof ORDERS)[number];

const STORES = [
  { name: "Kariakoo Flagship", market: "Dar es Salaam", hours: "08:00–18:00" },
  { name: "NMB House Store", market: "Dar es Salaam", hours: "09:00–17:00" },
  { name: "Arusha Central", market: "Arusha", hours: "08:30–17:30" },
];

const SECTIONS: Record<string, string> = {
  catalogue: "Catalogue", stores: "Stores", orders: "Orders", cart: "Cart", support: "Support",
};

type ListArgs = { title?: string; label?: string; query?: string; category?: string; max_price?: number | string | null; sort?: string };
type CartArgs = { product_id?: string; name?: string; quantity?: number | string | null };
type CartLine = { id: string; name: string; price: number; qty: number };

type ListResult = {
  ok: boolean; title?: string; shown?: number; total?: number; error?: string;
  items?: Pick<Product, "id" | "name" | "brand" | "price" | "category" | "stock" | "store">[];
};
type OrderResult = { ok: boolean; order?: Order; error?: string };
type NavResult = { ok: boolean; target?: string; label?: string; error?: string };
type CartResult = {
  ok: boolean; declined?: boolean; error?: string;
  added?: { name: string; qty: number; price: number };
  count?: number; total?: number; cart?: { name: string; qty: number; price: number }[];
};

type Pending = { title: string; detail: string; applyLabel: string; args: ListArgs | CartArgs };

const storageKey = (tenant: string, agentId: string) => `nmb_live_demo:${tenant}:${agentId}`;

const blank = (v: unknown): boolean => {
  if (typeof v === "number") return !Number.isFinite(v);
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s === "" || s === "null" || s === "none" || s === "undefined";
};

function normalize(f: FilterArgs): FilterArgs {
  const max = f.max_price === null || f.max_price === undefined || blank(f.max_price)
    ? undefined : Number(f.max_price);
  let sort = blank(f.sort) ? undefined : f.sort!.trim().toLowerCase().replace(/\s+/g, "_");
  if (sort) {
    if (/cheap|low|asc/.test(sort)) sort = "price_asc";
    else if (/expen|high|premium|desc/.test(sort)) sort = "price_desc";
    else if (/rel|popular|best/.test(sort)) sort = "relevance";
  }
  return {
    label: blank(f.label) ? undefined : f.label!.trim(),
    title: blank(f.title) ? undefined : f.title!.trim(),
    query: blank(f.query) ? undefined : f.query!.trim(),
    category: blank(f.category) ? undefined : f.category!.trim(),
    max_price: max !== undefined && Number.isFinite(max) ? max : undefined,
    sort,
  };
}

function matches(p: Product, f: FilterArgs) {
  const hay = `${p.name} ${p.brand} ${p.category} ${p.tags}`.toLowerCase();
  const q = (f.query ?? "").toLowerCase();
  if (q && !q.split(/\s+/).every((w) => hay.includes(w.replace(/s$/, "")))) return false;
  const c = (f.category ?? "").toLowerCase();
  if (c) {
    const words = c.split(/[^a-z0-9]+/).filter((w) => w && w !== "and");
    if (words.length && !words.every((w) => hay.includes(w.replace(/s$/, "")))) return false;
  }
  if (f.max_price != null && f.max_price !== "" && p.price > Number(f.max_price)) return false;
  return true;
}

function visibleProducts(f: FilterArgs): Product[] {
  const out = PRODUCTS.filter((p) => matches(p, f));
  if (f.sort?.includes("asc")) out.sort((a, b) => a.price - b.price);
  else if (f.sort?.includes("desc")) out.sort((a, b) => b.price - a.price);
  return out;
}

function findProduct(raw: CartArgs): Product | undefined {
  const id = String(raw.product_id ?? "").trim();
  if (id) {
    const byId = PRODUCTS.find((p) => p.id === id);
    if (byId) return byId;
  }
  const tokens = String(raw.name ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return undefined;
  return PRODUCTS.find((p) => {
    const hay = `${p.name} ${p.brand} ${p.tags}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

function describe(f: FilterArgs) {
  const bits: string[] = [];
  if (f.query) bits.push(`“${f.query}”`);
  if (f.category) bits.push(f.category);
  if (f.max_price != null && f.max_price !== "") bits.push(`under TZS ${Number(f.max_price).toLocaleString()}`);
  if (f.sort) bits.push(String(f.sort).replace("_", " "));
  return bits.join(" · ") || "show the full catalogue";
}

export function LiveDemo({ tenant, onOpenSolutions }: { tenant: string; onOpenSolutions?: () => void }) {
  const toast = useToast();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [selected, setSelected] = useState("");
  const [session, setSession] = useState<DemoSession | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    Promise.all([api.listAgents(tenant), api.listTools(tenant)])
      .then(([a, t]) => { if (!off) { setAgents(a); setTools(t); } })
      .catch((e) => { if (!off) { setAgents(null); setFailed(e.message); } });
    return () => { off = true; };
  }, [tenant]);

  const options = useMemo(() => {
    const front = new Map(tools.filter((t) => t.type === "frontend").map((t) => [t.id, t]));
    return (agents ?? [])
      .map((agent) => ({ agent, tools: agent.tool_ids.map((id) => front.get(id)).filter(Boolean) as Tool[] }))
      .filter((o) => o.tools.length > 0);
  }, [agents, tools]);

  useEffect(() => {
    if (session || !options.length) return;
    const entry = options.find((o) => o.agent.id === selected) ?? options[0];
    if (entry.agent.id !== selected) { setSelected(entry.agent.id); return; }
    const raw = sessionStorage.getItem(storageKey(tenant, entry.agent.id));
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as { id: string; key: string };
      if (stored.key) setSession({ agent: entry.agent, tools: entry.tools, key: stored.key, keyId: stored.id });
    } catch { /* stale entry */ }
  }, [options, selected, session, tenant]);

  async function start() {
    const entry = options.find((o) => o.agent.id === selected);
    if (!entry) return;
    try {
      const created = await api.createKey({
        name: `live demo · ${entry.agent.name}`.slice(0, 80),
        agent_id: entry.agent.id,
        tenant_id: tenant,
        allowed_origins: [window.location.origin],
        rate_limit_per_min: 120,
      });
      if (!created.key) throw new Error("The key was created but not returned.");
      sessionStorage.setItem(storageKey(tenant, entry.agent.id), JSON.stringify({ id: created.id, key: created.key }));
      setSession({ agent: entry.agent, tools: entry.tools, key: created.key, keyId: created.id });
      setFailed(null);
    } catch (e: any) {
      toast.push(e.message, "error");
      setFailed(e.message);
    }
  }

  function stop() {
    if (!session) return;
    sessionStorage.removeItem(storageKey(tenant, session.agent.id));
    setSession(null);
    api.revokeKey(session.keyId).catch(() => {});
  }

  return (
    <div>
      <PageHeader icon={MousePointerClick} title="Live demo"
        description="The page acts as the host app. Browser tools (useAgentTool) let the agent pause and ask this page for an action, then resume the same run - and the tool card renders as generative UI: product lists, order cards, navigation."
        actions={session && (
          <Button variant="outline" onClick={stop}>Stop demo</Button>
        )} />

      {!session && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 py-5">
              <div className="text-sm font-medium">1 · Choose an agent with a browser tool</div>
              {agents === null ? (
                <div className="h-9 w-72 animate-pulse rounded-lg bg-muted/60" />
              ) : options.length === 0 ? (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>No installed agent declares a browser tool yet. Install or update the
                    Marketplace Concierge pack (v1.2.0) - it ships <code className="font-mono text-xs">show_products</code>,
                    <code className="font-mono text-xs">navigate</code>, <code className="font-mono text-xs">show_order</code>,
                    <code className="font-mono text-xs">add_to_cart</code> and <code className="font-mono text-xs">set_filter</code>.</p>
                  {onOpenSolutions && <Button size="sm" variant="outline" onClick={onOpenSolutions}>Open Solutions</Button>}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <select value={selected} onChange={(e) => setSelected(e.target.value)}
                    className="h-9 rounded-lg border bg-background px-2 text-sm">
                    {options.map((o) => <option key={o.agent.id} value={o.agent.id}>{o.agent.name}</option>)}
                  </select>
                  <AsyncButton onRun={start} disabled={!selected}>Start demo</AsyncButton>
                  <span className="text-xs text-muted-foreground">
                    Mints a publishable key for {window.location.origin} and talks to {API_BASE}.
                  </span>
                </div>
              )}
              {failed && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{failed}</div>}
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-3">
            <Step icon={PauseCircle} title="Graph pauses" body="The model asks for a browser tool; the run stops with a frontend-tool interrupt." />
            <Step icon={Hand} title="This page acts" body="Read-only tools render product lists and order cards immediately. Changes to the page wait for your Apply." />
            <Step icon={RotateCcw} title="Run resumes" body="The handler result is sent back and the same run continues, with guardrails and citations intact." />
          </div>
        </div>
      )}

      {session && (
        <LangGraphKitProvider gateway={{ baseUrl: API_BASE, publishableKey: session.key, userId: "demo-buyer" }}>
          <DemoAgent session={session} />
        </LangGraphKitProvider>
      )}
    </div>
  );
}

function Step({ icon: Icon, title, body }: { icon: typeof Hand; title: string; body: string }) {
  return (
    <Card>
      <CardContent className="space-y-1.5 py-4">
        <div className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 text-primary" /> {title}</div>
        <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

function DemoAgent({ session }: { session: DemoSession }) {
  const [filter, setFilter] = useState<FilterArgs>({});
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [detail, setDetail] = useState<Product | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const decideRef = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDetail(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  useAgentReadable("Catalogue filters currently applied on the page", filter);
  useAgentReadable("Items in the buyer's cart", cart.map((l) => ({ name: l.name, qty: l.qty, price: l.price })));

  function ask(next: Pending) {
    return new Promise<boolean>((resolve) => {
      decideRef.current = resolve;
      setPending(next);
    });
  }

  function decide(ok: boolean) {
    const resolve = decideRef.current;
    decideRef.current = null;
    setPending(null);
    resolve?.(ok);
  }

  function goTo(key: string) {
    document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlash(key);
    window.setTimeout(() => setFlash((cur) => (cur === key ? null : cur)), 1600);
  }

  async function handleSetFilter(raw: FilterArgs) {
    const args = normalize(raw ?? {});
    const ok = await ask({ title: "The assistant wants to change this page", detail: describe(args), applyLabel: "Apply filter", args });
    if (!ok) return { ok: false, declined: true, reason: "The buyer declined the change; keep the current view." };
    setFilter(args);
    return { ok: true, applied: args, visible: visibleProducts(args).length, total: PRODUCTS.length };
  }

  function handleShowProducts(raw: ListArgs): ListResult {
    const args = normalize(raw ?? {});
    const items = visibleProducts(args);
    return {
      ok: true,
      title: args.title || args.label || "Matching listings",
      shown: items.length,
      total: PRODUCTS.length,
      items: items.map(({ id, name, brand, price, category, stock, store }) => ({ id, name, brand, price, category, stock, store })),
    };
  }

  function handleNavigate(raw: { target?: string }): NavResult {
    const wanted = String(raw?.target ?? "").trim().toLowerCase();
    const key = Object.keys(SECTIONS).find((k) => wanted.includes(k));
    if (!key) return { ok: false, error: `Unknown section. Use one of: ${Object.keys(SECTIONS).join(", ")}.` };
    goTo(key);
    return { ok: true, target: key, label: SECTIONS[key] };
  }

  function handleShowOrder(raw: { order_id?: string }): OrderResult {
    const id = String(raw?.order_id ?? "").trim().toUpperCase();
    const order = ORDERS.find((o) => o.id === id) ?? ORDERS.find((o) => id.length > 3 && o.id.endsWith(id));
    if (!order) return { ok: false, error: id ? `Order ${id} is not in this demo account.` : "An order id is required, for example ORD-100245." };
    goTo("orders");
    return { ok: true, order };
  }

  async function handleAddToCart(raw: CartArgs): Promise<CartResult> {
    const qty = Math.max(1, Math.floor(Number(raw?.quantity ?? 1)) || 1);
    const p = findProduct(raw ?? {});
    if (!p) return { ok: false, error: "That listing is not in this demo catalogue." };
    const ok = await ask({ title: "Add to cart?", detail: `${p.name} · qty ${qty}`, applyLabel: "Add to cart", args: raw ?? {} });
    if (!ok) return { ok: false, declined: true };
    const line = cart.find((l) => l.id === p.id);
    const next = line
      ? cart.map((l) => (l.id === p.id ? { ...l, qty: l.qty + qty } : l))
      : [...cart, { id: p.id, name: p.name, price: p.price, qty }];
    setCart(next);
    goTo("cart");
    return {
      ok: true,
      added: { name: p.name, qty, price: p.price },
      count: next.reduce((n, l) => n + l.qty, 0),
      total: next.reduce((n, l) => n + l.price * l.qty, 0),
      cart: next.map((l) => ({ name: l.name, qty: l.qty, price: l.price })),
    };
  }

  function addDirect(p: Product) {
    const line = cart.find((l) => l.id === p.id);
    setCart(line
      ? cart.map((l) => (l.id === p.id ? { ...l, qty: l.qty + 1 } : l))
      : [...cart, { id: p.id, name: p.name, price: p.price, qty: 1 }]);
    setDetail(null);
    goTo("cart");
  }

  useAgentTool<FilterArgs>({
    name: "set_filter",
    handler: handleSetFilter,
    render: ({ args, status }) => (
      <div className="rounded-lg border border-teal-500/30 bg-teal-500/5 px-3 py-2 text-xs">
        <div className="font-semibold text-teal-700 dark:text-teal-400">
          {status === "running" || status === "pending" ? "Paused - waiting for the page"
            : status === "error" ? "Page action failed" : "Page updated"}
        </div>
        <div className="text-muted-foreground">{describe(normalize(args ?? {}))}</div>
      </div>
    ),
  });

  useAgentTool<ListArgs, ListResult>({
    name: "show_products",
    handler: handleShowProducts,
    render: ({ args, result }) => {
      const a = normalize(args ?? {});
      const items = result?.items ?? visibleProducts(a).map(({ id, name, brand, price, category, stock, store }) => (
        { id, name, brand, price, category, stock, store }
      ));
      return (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
          <div className="flex items-baseline justify-between gap-2 text-xs font-semibold">
            <span>{result?.title ?? a.title ?? a.label ?? "Matching listings"}</span>
            <span className="font-normal text-muted-foreground">{items.length} of {result?.total ?? PRODUCTS.length} listings</span>
          </div>
          {items.length === 0 ? (
            <div className="rounded-lg border bg-background px-3 py-6 text-center text-xs text-muted-foreground">Nothing matches this view.</div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {items.map((p) => {
                const full: Product = PRODUCTS.find((x) => x.id === p.id)
                  ?? { ...p, tags: "", image: thumb(p.id, p.brand, p.name) };
                return (
                  <button key={p.id} type="button" onClick={() => setDetail(full)} title={`View ${p.name}`}
                    className="w-36 shrink-0 snap-start overflow-hidden rounded-lg border bg-background text-left transition-colors hover:border-teal-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60">
                    <img src={full.image} alt="" loading="lazy" className="h-20 w-full object-cover" />
                    <div className="space-y-0.5 p-2">
                      <div className="truncate text-xs font-medium">{p.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{p.brand} · {p.category}</div>
                      <div className="pt-1 text-xs font-semibold tabular-nums">TZS {p.price.toLocaleString()}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      );
    },
  });

  useAgentTool<{ target?: string }, NavResult>({
    name: "navigate",
    handler: handleNavigate,
    render: ({ args, result }) => (
      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
        <div className="font-semibold">
          {result && result.ok === false ? "Page section not found" : `Jumped to ${result?.label ?? args?.target ?? "the page"}`}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(SECTIONS).map(([key, label]) => (
            <button key={key} type="button" onClick={() => goTo(key)}
              className="rounded-full border bg-background px-2 py-0.5 text-[11px] hover:bg-muted">{label}</button>
          ))}
        </div>
      </div>
    ),
  });

  useAgentTool<{ order_id?: string }, OrderResult>({
    name: "show_order",
    handler: handleShowOrder,
    render: ({ args, result }) => {
      if (result && result.ok === false) {
        return <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs">{result.error}</div>;
      }
      const order = result?.order;
      const id = order?.id ?? String(args?.order_id ?? "").trim();
      if (!order) {
        return <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">Looking up {id || "the order"}…</div>;
      }
      const rows: [string, string][] = [
        ["Items", order.items],
        ["Total", `TZS ${order.total.toLocaleString()}`],
        ["Delivery", order.eta],
        ["Courier", order.courier],
        ["Placed", order.date],
      ];
      return (
        <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">Order {order.id}</span>
            <span className="rounded-full border border-teal-500/40 bg-teal-500/10 px-2 py-0.5 text-[11px] text-teal-700 dark:text-teal-300">{order.status}</span>
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    },
  });

  useAgentTool<CartArgs, CartResult>({
    name: "add_to_cart",
    handler: handleAddToCart,
    render: ({ args, status, result }) => {
      if (result && result.ok === false) {
        return (
          <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
            <div className="font-semibold">{result.declined ? "Not added" : "Could not add to cart"}</div>
            <div className="text-muted-foreground">
              {result.declined ? "The buyer declined; the cart is unchanged." : result.error}
            </div>
          </div>
        );
      }
      const lines = result?.cart ?? [];
      const waiting = status === "running" || status === "pending";
      return (
        <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
          <div className="font-semibold">
            {waiting ? "Waiting for the buyer to confirm" : result?.added ? `${result.added.name} added` : "Cart"}
          </div>
          {lines.length > 0 ? (
            <div className="mt-2 space-y-1">
              {lines.map((l) => (
                <div key={l.name} className="flex justify-between gap-3">
                  <span>{l.name} × {l.qty}</span>
                  <span className="tabular-nums">TZS {(l.price * l.qty).toLocaleString()}</span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-1 font-medium">
                <span>Total</span>
                <span className="tabular-nums">TZS {(result?.total ?? 0).toLocaleString()}</span>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground">
              {waiting ? `About to add ${String(args?.name ?? "this item")} after confirmation.` : "Nothing has been added yet."}
            </div>
          )}
        </div>
      );
    },
  });

  const shown = useMemo(() => visibleProducts(filter), [filter]);
  const cartCount = cart.reduce((n, l) => n + l.qty, 0);
  const cartTotal = cart.reduce((n, l) => n + l.price * l.qty, 0);

  const chips = [
    filter.query && `“${filter.query}”`,
    filter.category,
    filter.max_price != null && filter.max_price !== "" && `≤ TZS ${Number(filter.max_price).toLocaleString()}`,
    filter.sort && String(filter.sort).replace("_", " "),
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        {pending && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                <PauseCircle className="h-3.5 w-3.5" /> Graph paused - {pending.title}
              </div>
              <div className="text-xs text-muted-foreground">{pending.detail}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => decide(false)}>Ignore</Button>
              <Button size="sm" onClick={() => decide(true)}>{pending.applyLabel}</Button>
            </div>
          </div>
        )}

        <Card id="sec-catalogue" className={flash === "catalogue" ? "ring-2 ring-teal-500/60" : undefined}>
          <CardContent className="space-y-3 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Catalogue · this page</div>
                <div className="text-xs text-muted-foreground">{shown.length} of {PRODUCTS.length} listings</div>
              </div>
              <div className="flex items-center gap-2">
                {chips.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setFilter({})}>Clear filter</Button>
                )}
                <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{session.agent.name}</span>
              </div>
            </div>

            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span key={c} className="rounded-full border bg-muted/60 px-2 py-0.5 text-[11px]">{c}</span>
                ))}
              </div>
            )}

            <div className="max-h-72 divide-y overflow-y-auto rounded-xl border">
              {shown.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches this view.</div>
              ) : shown.map((p) => (
                <button key={p.id} type="button" onClick={() => setDetail(p)} title={`View ${p.name}`}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40">
                  <img src={p.image} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.brand} · {p.category} · store #{p.store} · {p.stock} in stock</div>
                  </div>
                  <div className="whitespace-nowrap text-sm tabular-nums">TZS {p.price.toLocaleString()}</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Ask the assistant to change this view. The handler waits for your click, so the run stays paused until you decide.
            </p>
          </CardContent>
        </Card>

        <Card id="sec-stores" className={flash === "stores" ? "ring-2 ring-teal-500/60" : undefined}>
          <CardContent className="space-y-2 py-4">
            <div className="text-sm font-semibold">Stores</div>
            <div className="divide-y rounded-xl border">
              {STORES.map((s) => (
                <div key={s.name} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.market}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">{s.hours}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card id="sec-orders" className={flash === "orders" ? "ring-2 ring-teal-500/60" : undefined}>
          <CardContent className="space-y-2 py-4">
            <div className="text-sm font-semibold">Your orders</div>
            <div className="divide-y rounded-xl border">
              {ORDERS.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{o.id}</div>
                    <div className="text-xs text-muted-foreground">{o.items} · {o.date}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs">{o.status}</div>
                    <div className="text-sm tabular-nums">TZS {o.total.toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card id="sec-cart" className={flash === "cart" ? "ring-2 ring-teal-500/60" : undefined}>
          <CardContent className="space-y-2 py-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Cart {cartCount > 0 && <span className="text-muted-foreground">· {cartCount} item(s)</span>}</div>
              {cart.length > 0 && <Button size="sm" variant="ghost" onClick={() => setCart([])}>Empty cart</Button>}
            </div>
            {cart.length === 0 ? (
              <div className="rounded-xl border px-3 py-6 text-center text-sm text-muted-foreground">Your cart is empty. Items are only added when you confirm in the chat.</div>
            ) : (
              <div className="divide-y rounded-xl border">
                {cart.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="text-sm">{l.name} × {l.qty}</div>
                    <div className="text-sm tabular-nums">TZS {(l.price * l.qty).toLocaleString()}</div>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 px-3 py-2 font-medium">
                  <span className="text-sm">Total</span>
                  <span className="text-sm tabular-nums">TZS {cartTotal.toLocaleString()}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card id="sec-support" className={flash === "support" ? "ring-2 ring-teal-500/60" : undefined}>
          <CardContent className="space-y-1 py-4 text-sm">
            <div className="font-semibold">Support</div>
            <p className="text-xs text-muted-foreground">
              Refunds, cancellations and address changes are handled by human support. Demo number 0800 123 456,
              Monday to Saturday 08:00–20:00.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="h-[620px] overflow-hidden rounded-xl border bg-card">
        <Chat
          title={session.agent.name}
          suggestions={[
            "Show me phones under 250,000 TZS",
            "Take me to my orders",
            "Where is order ORD-100245?",
            "Add the Sucre watch to my cart",
          ]}
          features={{ branching: false, artifacts: false }}
        />
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="pd-name" onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm overflow-hidden rounded-xl border bg-card shadow-xl">
            <img src={detail.image} alt="" className="h-40 w-full object-cover" />
            <div className="space-y-3 p-4">
              <div>
                <div id="pd-name" className="text-base font-semibold">{detail.name}</div>
                <div className="text-xs text-muted-foreground">{detail.brand} · {detail.category}</div>
              </div>
              <div className="text-lg font-semibold tabular-nums">TZS {detail.price.toLocaleString()}</div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Availability</dt><dd>{detail.stock} in stock</dd>
                <dt className="text-muted-foreground">Store</dt><dd>#{detail.store}</dd>
                <dt className="text-muted-foreground">Category</dt><dd>{detail.category}</dd>
              </dl>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => addDirect(detail)}>Add to cart</Button>
                <Button size="sm" variant="outline" onClick={() => setDetail(null)}>Close</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
