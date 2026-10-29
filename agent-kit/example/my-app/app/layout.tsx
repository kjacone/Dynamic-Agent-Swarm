import type { ReactNode } from "react";
import { LangGraphKitProvider } from "langgraph-kit";
import "langgraph-kit/styles.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        {/* Leave apiUrl/assistantId out and <Playground /> shows a setup form instead. */}
        <LangGraphKitProvider
          apiUrl={process.env.NEXT_PUBLIC_API_URL}
          assistantId={process.env.NEXT_PUBLIC_ASSISTANT_ID}
          persistKey="lgk"        // remember endpoint + token (token is bound to its origin)
          branching               // edit / regenerate / switch versions (default true)
          submitOptions={{ streamSubgraphs: true }}
        >
          {children}
        </LangGraphKitProvider>
      </body>
    </html>
  );
}
