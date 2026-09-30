import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: "127.0.0.1",
      port: 4300,
      strictPort: true,
      proxy: {
        "/api": {
          target: env.API_URL || "http://localhost:4301",
          changeOrigin: false,
        },
        "/docs": { target: env.API_URL || "http://localhost:4301" },
        "/openapi.json": { target: env.API_URL || "http://localhost:4301" },
        "/health": { target: env.API_URL || "http://localhost:4301" },
      },
    },
    preview: { host: "127.0.0.1", port: 4300, strictPort: true },
  };
});
