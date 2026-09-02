import http from "node:http";
import { WebSocketServer } from "ws";
import { JobQueue } from "./queue.js";
import type { AiJobRequest, BridgeOptions } from "./types.js";

async function readJson(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(response: http.ServerResponse, status: number, body?: unknown) {
  response.statusCode = status;
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(body === undefined ? "" : JSON.stringify(body));
}

export class BridgeServer {
  readonly queue: JobQueue;
  private server?: http.Server;
  private sockets?: WebSocketServer;
  constructor(private options: BridgeOptions = {}) { this.queue = new JobQueue(options); }

  async start() {
    if (this.server) return this;
    const host = this.options.host ?? "127.0.0.1";
    const port = this.options.port ?? 4317;
    this.server = http.createServer(async (request, response) => {
      if (request.method === "OPTIONS") return send(response, 204);
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
      try {
        if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true });
        if (request.method === "GET" && url.pathname === "/jobs") return send(response, 200, this.queue.list());
        if (request.method === "POST" && url.pathname === "/jobs") {
          const body = (await readJson(request)) as AiJobRequest;
          if (!body.prompt || !body.provider || !body.selections?.length) return send(response, 400, { error: "provider, prompt and at least one selection are required" });
          return send(response, 201, this.queue.enqueue(body));
        }
        const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)(?:\/(retry|cancel))?$/);
        if (jobMatch) {
          const [, id, action] = jobMatch;
          if (request.method === "GET" && !action) { const job = this.queue.get(id); return job ? send(response, 200, job) : send(response, 404, { error: "job not found" }); }
          if (request.method === "POST" && action === "retry") { const job = this.queue.retry(id); return job ? send(response, 200, job) : send(response, 409, { error: "job cannot be retried" }); }
          if (request.method === "POST" && action === "cancel") { const job = this.queue.cancel(id); return job ? send(response, 200, job) : send(response, 404, { error: "job not found" }); }
          if (request.method === "DELETE" && !action) return this.queue.delete(id) ? send(response, 204) : send(response, 409, { error: "running jobs cannot be deleted" });
        }
        if (request.method === "POST" && url.pathname === "/cache/reset") { this.queue.resetCache(); return send(response, 204); }
        return send(response, 404, { error: "not found" });
      } catch (error) {
        return send(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    });
    this.sockets = new WebSocketServer({ server: this.server, path: "/events" });
    this.queue.on("job", (job) => {
      const payload = JSON.stringify({ type: "job", job });
      for (const socket of this.sockets?.clients ?? []) if (socket.readyState === socket.OPEN) socket.send(payload);
    });
    await new Promise<void>((resolve, reject) => { this.server!.once("error", reject); this.server!.listen(port, host, resolve); });
    return this;
  }

  async stop() {
    if (this.sockets) await new Promise<void>((resolve) => this.sockets!.close(() => resolve()));
    if (this.server) await new Promise<void>((resolve, reject) => this.server!.close((error) => error ? reject(error) : resolve()));
    this.sockets = undefined; this.server = undefined;
  }
}

export async function startBridge(options: BridgeOptions = {}) { const bridge = new BridgeServer(options); return bridge.start(); }
