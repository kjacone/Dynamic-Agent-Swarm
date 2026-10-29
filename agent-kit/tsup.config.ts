import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  external: ["react", "react-dom"],
  // Everything here is client-side; lets Next.js import it from server components.
  banner: { js: '"use client";' },
  onSuccess: "cp src/styles.css dist/styles.css",
});
