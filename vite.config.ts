import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { configDefaults, defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

const EVEN_HUB_EVENT_PATH = "/__openclaw-even-g2-node/even-hub-event";
const EVEN_HUB_EVENT_LOG_DIR = ".openclaw-even-g2-node";
const EVEN_HUB_EVENT_LOG_FILE = "even-hub-events.ndjson";
const ROOT = process.cwd();

type RootPackageJson = {
  version?: string;
};

function readPackageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as RootPackageJson;
  return packageJson.version || "0.0.0-dev";
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: unknown) => {
      if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
        chunks.push(Buffer.from(chunk));
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(payload)}\n`);
}

function evenG2EventLogger(): Plugin {
  return {
    name: "openclaw-even-g2-node-event-logger",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== EVEN_HUB_EVENT_PATH) {
          next();
          return;
        }
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        try {
          const body = await readRequestBody(req);
          const line = body.trim() || "{}";
          const logDir = path.join(server.config.root, EVEN_HUB_EVENT_LOG_DIR);
          const logPath = path.join(logDir, EVEN_HUB_EVENT_LOG_FILE);
          fs.mkdirSync(logDir, { recursive: true });
          fs.appendFileSync(logPath, `${line}\n`, "utf8");
          server.config.logger.info(`[Even G2 event]\n${JSON.stringify(JSON.parse(line), null, 2)}`);
          sendJson(res, 200, { ok: true });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          server.config.logger.error(`[Even G2 event] ${message}`);
          sendJson(res, 500, { ok: false, error: message });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), evenG2EventLogger()],
  define: {
    __OPENCLAW_EVEN_G2_VERSION__: JSON.stringify(readPackageVersion()),
  },
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, ".openclaw-even-g2-node/**"],
  },
});
