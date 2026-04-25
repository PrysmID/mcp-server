import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  splitting: false,
  shims: true,
  banner: { js: "#!/usr/bin/env node" },
});
