import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";

const app = new Hono();

app.use("*", cors());
app.use("*", logger());

// tRPC endpoint
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

// OAuth callback handler
app.get("/api/oauth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code) {
    return c.text("Authorization code missing", 400);
  }

  try {
    const { createOAuthCallbackHandler } = await import("./kimi/auth");
    const handler = createOAuthCallbackHandler();
    return handler(c);
  } catch (error) {
    console.error("OAuth callback error:", error);
    return c.text("Authentication failed", 500);
  }
});

// Health check
app.get("/api/health", (c) => {
  return c.json({ ok: true, ts: Date.now() });
});

// Serve static frontend files in production
if (process.env.NODE_ENV === "production") {
  import("node:fs").then(({ readFileSync, existsSync }) => {
    import("node:path").then(({ join, resolve }) => {
      const publicDir = resolve(process.cwd(), "dist/public");

      app.get("/*", async (c) => {
        const url = new URL(c.req.url);
        let filePath = join(publicDir, url.pathname);
        if (url.pathname === "/") {
          filePath = join(publicDir, "index.html");
        }
        if (!existsSync(filePath)) {
          filePath = join(publicDir, "index.html");
        }
        if (existsSync(filePath)) {
          const content = readFileSync(filePath);
          const ext = filePath.split(".").pop() || "";
          const mimeTypes: Record<string, string> = {
            html: "text/html",
            js: "application/javascript",
            css: "text/css",
            json: "application/json",
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            svg: "image/svg+xml",
            ico: "image/x-icon",
          };
          return c.body(content, 200, {
            "Content-Type": mimeTypes[ext] || "application/octet-stream",
          });
        }
        return c.text("Not Found", 404);
      });
    });
  });
}

// Start server
const port = parseInt(process.env.PORT || "3000");
console.log(`[MedRAG] Starting server on port ${port}...`);
serve({
  fetch: app.fetch,
  port,
});

export default app;
