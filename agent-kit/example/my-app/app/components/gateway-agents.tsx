"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowIcon,
  ChatSidebar,
  LangGraphKitProvider,
  PhoneIcon,
  UiStyles,
  listGatewayAgents,
  type GatewayAgent,
  type GatewayConfig,
  type GatewayTheme,
  type ThemeVars,
} from "langgraph-kit";

const baseUrl = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_GATEWAY_KEY ?? "";
const userId = process.env.NEXT_PUBLIC_GATEWAY_USER ?? "demo-user";

/** Agent wrapper theme -> kit CSS variables, applied in both light and dark. */
function kitThemeVars(theme?: GatewayTheme): { light?: ThemeVars; dark?: ThemeVars } | undefined {
  if (!theme) return undefined;
  const vars: ThemeVars = {};
  if (theme.accent) vars["--lgk-accent"] = theme.accent;
  if (theme.accentInk) vars["--lgk-accent-ink"] = theme.accentInk;
  if (theme.surface) vars["--lgk-panel"] = theme.surface;
  if (theme.text) vars["--lgk-ink"] = theme.text;
  if (theme.muted) vars["--lgk-bg"] = theme.muted;
  if (typeof theme.radius === "number") vars["--lgk-radius"] = `${theme.radius}px`;
  return Object.keys(vars).length ? { light: vars, dark: vars } : undefined;
}

/** Customer-side wrapper: lists the agents this publishable key may use, then chats with the chosen one. */
export function GatewayAgents() {
  const [agents, setAgents] = useState<GatewayAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    listGatewayAgents({ baseUrl, publishableKey, userId }, { signal: controller.signal })
      .then((list) => {
        setAgents(list);
        setSelected(list.find((a) => a.default)?.id ?? list[0]?.id ?? "");
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message || "Could not load agents");
      });
    return () => controller.abort();
  }, []);

  const gateway = useMemo<GatewayConfig>(
    () => ({
      baseUrl,
      publishableKey,
      userId,
      ...(selected ? { agentId: selected } : {}),
    }),
    [selected],
  );

  if (error) {
    return (
      <div className="ui-root">
        <UiStyles />
        <main className="ui-page">
          <header className="ui-head">
            <h1>Service assistant</h1>
          </header>
          <div className="ui-state error" role="alert">
            <strong>Could not load agents</strong>
            <p>{error}</p>
            <p>Check that the gateway allows this origin for the publishable key.</p>
          </div>
        </main>
      </div>
    );
  }

  if (!agents) {
    return (
      <div className="ui-root">
        <UiStyles />
        <main className="ui-page">
          <div className="ui-state" role="status">
            <span className="ui-spinner" aria-hidden="true" />
            Loading agents…
          </div>
        </main>
      </div>
    );
  }

  const current = agents.find((a) => a.id === selected);

  const page = (
    <div className="ui-root">
      <UiStyles />
      <main className="ui-page">
        <header className="ui-head">
          <h1>Service assistant</h1>
          <p>Agents offered to this customer app. Pick one, then chat in the panel.</p>
        </header>

        <a href="/phone" className="ui-callout">
          <span className="ui-callout-icon"><PhoneIcon /></span>
          <span>
            <strong>Open the phone line</strong>
            <span className="sub">Talk live or record a voice dataset</span>
          </span>
          <span className="ui-callout-arrow"><ArrowIcon /></span>
        </a>

        {agents.length === 0 ? (
          <div className="ui-state">
            No agent is available for this key. Publish an agent in the console to offer it here.
          </div>
        ) : (
          <section aria-labelledby="agent-heading">
            <h2 id="agent-heading" className="ui-title">Choose an agent</h2>
            <p className="ui-hint">Switching agent starts a fresh conversation.</p>
            <div className="ui-agents" role="radiogroup" aria-labelledby="agent-heading">
              {agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={a.id === selected}
                  className="ui-agent"
                  onClick={() => setSelected(a.id)}
                >
                  <span className="ui-avatar" aria-hidden="true">{a.name.charAt(0).toUpperCase()}</span>
                  <span>
                    <span className="ui-agent-name">{a.name}</span>
                    {a.default && <span className="ui-pill">Default</span>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );

  if (agents.length === 0) return page;

  return (
    <LangGraphKitProvider
      key={selected}
      gateway={gateway}
      theme={current?.wrapper?.theme?.mode}
      themeVars={kitThemeVars(current?.wrapper?.theme)}
    >
      <ChatSidebar mode="panel" title={current?.name ?? "Service assistant"} suggestions={current?.suggestions}>
        {page}
      </ChatSidebar>
    </LangGraphKitProvider>
  );
}