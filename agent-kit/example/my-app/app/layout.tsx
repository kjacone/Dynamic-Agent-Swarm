import type { ReactNode } from "react";
import "langgraph-kit/styles.css";
import { AppThemeProvider } from "./theme";

const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL && process.env.NEXT_PUBLIC_GATEWAY_KEY
  ? {
      baseUrl: process.env.NEXT_PUBLIC_GATEWAY_URL,
      publishableKey: process.env.NEXT_PUBLIC_GATEWAY_KEY,
      userId: process.env.NEXT_PUBLIC_GATEWAY_USER ?? "demo-user",
    }
  : undefined;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <AppThemeProvider gateway={gateway}>{children}</AppThemeProvider>
      </body>
    </html>
  );
}