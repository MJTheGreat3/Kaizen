import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import type { Plugin } from "vite";

const host = process.env.TAURI_DEV_HOST;

/**
 * Serves Excalidraw's fonts from the app (`public/excalidraw/fonts`) so the
 * canvas works offline and within the CSP. Xiaolai (CJK, 12 MB) is left out;
 * Chinese and Japanese text falls back to a system font.
 */
function excalidrawFonts(): Plugin {
  const copy = () => {
    const from = path.resolve(import.meta.dirname, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
    const to = path.resolve(import.meta.dirname, "public/excalidraw/fonts");
    for (const family of fs.readdirSync(from)) {
      if (family === "Xiaolai" || fs.existsSync(path.join(to, family))) continue;
      fs.cpSync(path.join(from, family), path.join(to, family), { recursive: true });
    }
  };
  return { name: "excalidraw-fonts", buildStart: copy, configureServer: copy };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), excalidrawFonts()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "node",
  },
}));
