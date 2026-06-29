import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { errorStack } from "./strict-helpers.ts";

const APP_DIST = resolve(process.env.EVENG2_APP_DIST || "dist");
const HOST = process.env.EVENG2_EVEN_DEV_HOST || "127.0.0.1";
const PORT = Number(process.env.EVENG2_EVEN_DEV_PORT || 35162);
const BASE_PATH = normalizeBasePath(process.env.EVENG2_EVEN_DEV_BASE_PATH || "/openclaw-even-g2-node/");
const PUBLIC_URL =
  process.env.EVENG2_EVEN_DEV_PUBLIC_URL ||
  `http://${HOST}:${PORT}${BASE_PATH}`;

function normalizeBasePath(value: string): string {
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "application/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

function stripBasePath(pathname: string): string {
  if (pathname === BASE_PATH.slice(0, -1)) return "/";
  if (pathname.startsWith(BASE_PATH)) return `/${pathname.slice(BASE_PATH.length)}`;
  return pathname;
}

function rewriteIndexHtml(html: string): string {
  return html.replace(/(href|src)="\/assets\//g, `$1="${BASE_PATH}assets/`);
}

export function staticFilePathForRequestPath(pathname: string, appDist = APP_DIST): string | null {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = normalize(join(appDist, relativePath));
  const pathFromDist = relative(appDist, filePath);
  if (pathFromDist === ".." || pathFromDist.startsWith(`..${sep}`) || isAbsolute(pathFromDist)) return null;
  return filePath;
}

async function serveFile(res: ServerResponse, pathname: string): Promise<void> {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = staticFilePathForRequestPath(pathname);
  if (!filePath) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("forbidden");
    return;
  }
  let body = await readFile(filePath);
  if (relativePath === "index.html") {
    body = Buffer.from(rewriteIndexHtml(body.toString("utf8")), "utf8");
  }
  res.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": "no-store",
  });
  res.end(body);
}

async function main() {
  if (!existsSync(join(APP_DIST, "index.html"))) {
    throw new Error(`App dist not found at ${APP_DIST}. Run "pnpm build" first.`);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
      if (url.pathname === "/health" || url.pathname === `${BASE_PATH}health`) {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, basePath: BASE_PATH }));
        return;
      }
      await serveFile(res, stripBasePath(decodeURIComponent(url.pathname)));
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    }
  });

  await new Promise<void>((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, resolveServer);
  });

  console.log(JSON.stringify({
    ok: true,
    localUrl: `http://${HOST}:${PORT}${BASE_PATH}`,
    publicUrl: PUBLIC_URL,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(errorStack(err));
    process.exit(1);
  });
}
