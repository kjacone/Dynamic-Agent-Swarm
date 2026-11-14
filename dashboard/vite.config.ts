import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
    // langgraph-kit is linked from ../agent-kit and carries its own React; keep one copy.
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: { include: ["langgraph-kit"] },
  server: {
    port: 5173,
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), path.resolve(__dirname, "../agent-kit")] },
  },
  build: { outDir: "dist", sourcemap: false },
});