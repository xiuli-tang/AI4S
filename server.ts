import express from "express";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { createApiApp } from "./server/api";
import { createNetworkClient } from "./server/network";
import { HubStore } from "./server/hubStore";
import { resolve } from "node:path";
import { UmlipService } from "./server/umlip/service";
import { closeSynthesisEngine } from "./server/synthesis";
import { MPSummaryStore } from "./server/mpSummaryStore";
import compression from "compression";
import { productionAssets } from "./server/productionAssets";

dotenv.config();
dotenv.config({ path: ".env.umlip.local" });

async function startServer() {
  const network = createNetworkClient();
  const umlip = new UmlipService({ root: process.cwd(), env: process.env });
  const hub = new HubStore(resolve(process.env.AI4S_HUB_DB || "data/ai4s_hub.db"));
  const mpSummary = process.env.AI4S_MP_SUMMARY_DB ? new MPSummaryStore(resolve(process.env.AI4S_MP_SUMMARY_DB)) : undefined;
  const port = Number(process.env.PORT || 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be 1–65535");
  const hmrPort = Number(process.env.HMR_PORT || (port < 55000 ? port + 10000 : port - 10000));
  if (!Number.isSafeInteger(hmrPort) || hmrPort < 1 || hmrPort > 65535) throw new Error("HMR_PORT must be 1–65535");
  const app = express();
  app.disable("x-powered-by");
  app.use(compression());
  app.use(createApiApp({ network, hub, umlip, mpSummary }));
  const vite = process.env.NODE_ENV !== "production"
    ? await createViteServer({ server: {
      middlewareMode: true,
      hmr: process.env.DISABLE_HMR === "true" ? false : { host: "127.0.0.1", port: hmrPort },
    }, appType: "spa" }) : null;
  if (vite) app.use(vite.middlewares);
  else app.use(productionAssets());

  const bindHost = process.env.AI4S_BIND_HOST || "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0"].includes(bindHost)) throw new Error("Invalid AI4S_BIND_HOST");
  const server = app.listen(port, bindHost, () => {
    console.log(`Server running on http://127.0.0.1:${port}`);
  });
  server.once("error", () => {
    console.error(`Cannot start the local server. Check that port ${port} is available.`);
    network.close();
    hub.close();
    mpSummary?.close();
    umlip.close();
    void vite?.close();
    process.exitCode = 1;
  });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    closeSynthesisEngine();
    network.close();
    umlip.close();
    server.close(() => { hub.close(); mpSummary?.close(); });
    server.closeIdleConnections();
    void vite?.close();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

startServer().catch(() => {
  console.error("Server startup failed. Check the configured PORT, database path and installed dependencies.");
  process.exitCode = 1;
});
