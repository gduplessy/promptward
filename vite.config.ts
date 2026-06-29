import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import { manifest } from "./src/manifest";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: "src/sidepanel.html",
        offscreen: "src/offscreen.html"
      }
    }
  }
});
