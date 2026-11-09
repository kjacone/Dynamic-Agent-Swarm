import type { ReactNode } from "react";
import "langgraph-kit/styles.css";
import { AppThemeProvider } from "./theme";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <AppThemeProvider>{children}</AppThemeProvider>
      </body>
    </html>
  );
}