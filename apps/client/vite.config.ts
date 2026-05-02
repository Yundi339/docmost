import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import * as path from "path";

const envPath = path.resolve(process.cwd(), "..", "..");

export default defineConfig(({ mode }) => {
  const {
    APP_URL,
    FILE_UPLOAD_SIZE_LIMIT,
    FILE_IMPORT_SIZE_LIMIT,
    DRAWIO_URL,
    CLOUD,
    SUBDOMAIN_HOST,
    COLLAB_URL,
    BILLING_TRIAL_DAYS,
  } = loadEnv(mode, envPath, "");
  const proxyTarget = APP_URL?.replace("localhost", "127.0.0.1");

  return {
    define: {
      "process.env": {
        APP_URL,
        FILE_UPLOAD_SIZE_LIMIT,
        FILE_IMPORT_SIZE_LIMIT,
        DRAWIO_URL,
        CLOUD,
        SUBDOMAIN_HOST,
        COLLAB_URL,
        BILLING_TRIAL_DAYS,
      },
      APP_VERSION: JSON.stringify(process.env.npm_package_version),
    },
    plugins: [react()],
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: "vendor-mantine", test: /@mantine/ },
              { name: "vendor-katex", test: /katex/ },
            ],
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": "/src",
      },
    },
    server: {
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: false,
        },
        "/socket.io": {
          target: proxyTarget,
          ws: true,
          rewriteWsOrigin: true,
        },
        "/collab": {
          target: proxyTarget,
          ws: true,
          rewriteWsOrigin: true,
        },
      },
    },
  };
});
