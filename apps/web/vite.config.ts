import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// In production the API serves this app, so every request is same-origin. For
// local dev, Vite proxies /api and /auth to the API (FLOATERS_DEV_API_URL,
// default http://localhost:3000). login.flux.am can't sign in to localhost, so
// the proxy can add the API key itself (FLOATERS_DEV_API_KEY, the API's
// CONNECT_SECRET). These are read here in Node and never reach the bundle:
// only VITE_* variables are embedded, and there are none. With the key set,
// the dev server listens on localhost only, so nobody else on the network can
// use it as a signed-in proxy.
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "FLOATERS_DEV_");
  const target = env.FLOATERS_DEV_API_URL || "http://localhost:3000";
  const apiKey = env.FLOATERS_DEV_API_KEY;
  const proxy: ProxyOptions = {
    target,
    changeOrigin: true,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  };

  return {
    server: {
      host: apiKey ? "localhost" : "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: { "/api": proxy, "/auth": proxy },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
