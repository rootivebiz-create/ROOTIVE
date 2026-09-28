import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // .tsx の画面を試験で描くとき、React を import しなくても動く書き方（automatic）にする
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      { find: /^@\/lib\/(.*)$/, replacement: path.resolve(__dirname, "../lib/$1") },
      { find: /^@\/components\/ui$/, replacement: path.resolve(__dirname, "../components/ui.tsx") },
      { find: /^~\/(.*)$/, replacement: path.resolve(__dirname, "./$1") },
      { find: "server-only", replacement: path.resolve(__dirname, "tests/stubs/server-only.ts") },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
  },
});
