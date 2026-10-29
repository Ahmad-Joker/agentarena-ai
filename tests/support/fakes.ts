import type { Sandbox, SandboxRunInput, SandboxRunOutput } from "@/lib/evaluation/sandbox";

/** Deterministic sandbox double: returns canned values per source snippet. */
export class FakeSandbox implements Sandbox {
  readonly calls: SandboxRunInput[] = [];
  constructor(
    private readonly responder: (input: SandboxRunInput) => Partial<SandboxRunOutput>,
    private readonly available = true,
  ) {}
  async isAvailable() {
    return this.available ? { available: true } : { available: false, reason: "fake sandbox disabled" };
  }
  async run(input: SandboxRunInput): Promise<SandboxRunOutput> {
    this.calls.push(input);
    return { status: "ok", results: [], durationMs: 5, limits: { network: "none" }, ...this.responder(input) };
  }
}

/** Builds a Response whose body streams the given SSE frames, optionally split at odd offsets. */
export function sseResponse(frames: unknown[], opts: { chunkSize?: number; status?: number } = {}): Response {
  const text = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  const size = opts.chunkSize ?? 7;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
  return new Response(stream, { status: opts.status ?? 200, headers: { "Content-Type": "text/event-stream" } });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export interface RecordedRequest {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
}

/** fetch double that records requests and routes them to handlers by "METHOD /path". */
export function fakeFetch(routes: Record<string, (req: RecordedRequest) => Response | Promise<Response>>) {
  const requests: RecordedRequest[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    let body: unknown = init?.body;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    const req = { url, method: init?.method ?? "GET", headers, body };
    requests.push(req);
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return jsonResponse({ error: { type: "invalid_request_error", code: "not_found", message: `no route ${req.method} ${url.pathname}` } }, 404);
    return handler(req);
  }) as typeof fetch;
  return { impl, requests };
}
