import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/, set by the Pages workflow.
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  server: { host: true, port: 5173, allowedHosts: true },
});
