import http from "node:http";
import { config } from "./config.js";
import { chat } from "./core/claude-driver.js";
import { listPending, resolveConfirmation, killSwitchActive } from "./core/permission-gate.js";
import { usageSummary, searchMessages, allFacts, clearSession } from "./core/memory.js";

/**
 * Loopback HTTP API. This is the socket the voice stack (Phase 5) and any
 * other local front-end plugs into. No auth because it binds 127.0.0.1;
 * if you ever bind wider, add auth first or you deserve what happens.
 *
 *   POST /chat            { "text": "...", "channel": "http" }  -> { text, sessionId, costUsd }
 *   GET  /health          -> status, auth mode, kill switch, 24h usage
 *   GET  /confirmations   -> pending destructive-action confirmations
 *   POST /confirm         { "id": "...", "approved": true }
 *   GET  /memory/facts    -> durable facts
 *   GET  /memory/search?q=term
 *   POST /session/reset   { "channel": "http" } -> start fresh conversation
 */

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

export function startServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    try {
      if (req.method === "POST" && url.pathname === "/chat") {
        const body = await readBody(req);
        const text = String(body.text ?? "").trim();
        if (!text) return json(res, 400, { error: "text required" });
        const channel = String(body.channel ?? "http");
        const result = await chat(channel, text);
        return json(res, 200, result);
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          status: "ok",
          authMode: config.authMode,
          killSwitch: killSwitchActive(),
          usage24h: usageSummary(24),
        });
      }

      if (req.method === "GET" && url.pathname === "/confirmations") {
        return json(res, 200, { pending: listPending() });
      }

      if (req.method === "POST" && url.pathname === "/confirm") {
        const body = await readBody(req);
        const ok = resolveConfirmation(String(body.id ?? ""), Boolean(body.approved));
        return json(res, ok ? 200 : 404, { resolved: ok });
      }

      if (req.method === "GET" && url.pathname === "/memory/facts") {
        return json(res, 200, { facts: allFacts() });
      }

      if (req.method === "GET" && url.pathname === "/memory/search") {
        const q = url.searchParams.get("q") ?? "";
        if (!q) return json(res, 400, { error: "q required" });
        return json(res, 200, { results: searchMessages(q) });
      }

      if (req.method === "POST" && url.pathname === "/session/reset") {
        const body = await readBody(req);
        clearSession(String(body.channel ?? "http"));
        return json(res, 200, { reset: true });
      }

      return json(res, 404, { error: "not found" });
    } catch (err) {
      return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.listen(config.port, config.host, () => {
    console.log(`[jarvis] http listening on ${config.host}:${config.port}`);
  });
  return server;
}
