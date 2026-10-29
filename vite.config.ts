import { defineConfig } from "vite";

// Relative base keeps the build portable: GitHub Pages, itch.io, or any static host.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    assetsInlineLimit: 4096,
  },
});
