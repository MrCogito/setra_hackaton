import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import webfontDownload from "vite-plugin-webfont-dl";

export default defineConfig({
  assetsInclude: ["**/*.onnx"],
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
    fs: {
      allow: [".."],
    },
    middlewareMode: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    react(),
    webfontDownload(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/onnxruntime-web/dist/*.wasm",
          dest: "./",
        },
      ],
    }),
    {
      name: 'configure-response-headers',
      configureServer: (server) => {
        server.middlewares.use((req, res, next) => {
          // Only set MIME type for .wasm files
          if (req.url && req.url.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
          }
          next();
        });
      }
    }
  ],
});
