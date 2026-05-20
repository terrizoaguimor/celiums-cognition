/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Static file server for the Celiums Cognition UI bundle.
//
// The plugin's `package.json` build script copies the Vite-built SPA into
// `dist/ui/`. At runtime, OpenClaw's gateway dispatches HTTP requests
// matching `/plugins/celiums-cognition/*` to this handler, which resolves
// them as file lookups under `dist/ui/`. Defaults to serving `index.html`
// for the root URL.
//
// MIME types are deduced from file extension. The handler is best-effort
// and never throws — a missing file produces a 404, a path-traversal
// attempt produces a 400.

import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".map":  "application/json",
  ".txt":  "text/plain; charset=utf-8",
};

export interface UiStaticOptions {
  /** Absolute path to the Vite `dist/` directory (with index.html at root). */
  rootDir: string;
  /** HTTP path prefix the gateway routes to us (used to strip). */
  pathPrefix: string;
  logger?: { warn?: (m: string) => void };
}

export function makeUiStaticHandler(opts: UiStaticOptions) {
  const root = opts.rootDir;
  const prefix = opts.pathPrefix.replace(/\/$/, "");

  return async function handler(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      const url = (req.url || "/").split("?")[0];
      // Strip the gateway's plugin prefix to get a relative path inside dist/ui
      let rel = url.startsWith(prefix) ? url.slice(prefix.length) : url;
      if (rel === "" || rel === "/") rel = "/index.html";
      // SPA fallback: any path without an extension that isn't /api/
      // should serve index.html (client-side router handles the route).
      // (Currently the SPA uses hash routing so this won't actually fire,
      // but it future-proofs against switching to History API routing.)
      if (!extname(rel) && !rel.startsWith("/api/")) rel = "/index.html";

      // Resolve safely under root — refuse any normalized path that
      // escapes the dist directory.
      const safe = normalize(join(root, rel));
      if (!safe.startsWith(root + sep) && safe !== root) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain");
        res.end("bad path");
        return;
      }

      let body: Buffer;
      try {
        body = await readFile(safe);
      } catch {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain");
        res.end("not found");
        return;
      }
      const ext = extname(safe).toLowerCase();
      const mime = MIME[ext] ?? "application/octet-stream";
      res.statusCode = 200;
      res.setHeader("Content-Type", mime);
      // Aggressive cache for hashed assets; no-cache for index.html so
      // operators always get the latest deployed bundle on refresh.
      if (rel === "/index.html") {
        res.setHeader("Cache-Control", "no-cache");
      } else if (/\/assets\//.test(rel)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
      res.end(body);
    } catch (err) {
      opts.logger?.warn?.(
        `ui-static: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain");
        res.end("internal error");
      }
    }
  };
}
