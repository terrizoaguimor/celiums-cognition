/// <reference types="vite/client" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The plugin serves this bundle under /plugins/celiums-cognition/ via
// registerHttpRoute. The base is configured so asset URLs in the built
// HTML resolve correctly when the gateway mounts the SPA at that prefix.
export default defineConfig({
  base: "/plugins/celiums-cognition/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    // Allow files to be loaded via .jsx extension which the prototype uses
    rollupOptions: {
      input: {
        main: "./index.html",
      },
    },
  },
  // Allow the prototype's bare .jsx imports without rewriting every file.
  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".json"],
  },
});
