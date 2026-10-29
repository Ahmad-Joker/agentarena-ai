import { readSseStream, type RawStreamEvent } from "./sse";
import { HarnessRouterError, errorFromResponse } from "./errors";
import {
  harnessListSchema,
  responseObjectSchema,
  sessionFilesSchema,
  sessionSchema,
  uhpDiscoverySchema,
  uploadedFileSchema,
  type AgentStreamEvent,
  type HarnessSummary,
  type InputContent,
  type ResponseObject,
  type SessionFile,
  type SessionObject,
} from "./types";
import { assertSafeId, buildProviderUrl, validateBaseUrl } from "@/lib/security/url-guard";

/**
 * Thin, server-only client for the documented HarnessRouter HTTP API.
 *
 * Contract sources (see docs/HARNESSROUTER_RESEARCH.md):
 *  - Bearer auth, `UHP-Version` header, `Idempotency-Key` on task creation
 *  - POST /v1/responses with `metadata.harness_id`, `stream: true` → data-only SSE
 *  - GET /v1/responses/{id}, POST /v1/responses/{id}/cancel
 *  - GET /v1/sessions/{sid}, GET /v1/sessions/{sid}/files?changed=true
 *  - GET /v1/containers/{cid}/files/{fid}/content
 *  - POST /v1/files (multipart), GET /v1/harnesses, GET /v1/uhp
 */
export interface HarnessRouterClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Overrides discovery; otherwise the version comes from GET /v1/uhp. */
  uhpVersion?: string;
  requestTimeoutMs?: number;
}

export interface CreateResponseParams {
  harnessId: string;
  input: string | Array<{ role: "user"; content: InputContent[] }>;
  model?: string;
  idempotencyKey: string;
  timeoutSeconds?: number;
  maxCostUsd?: number;
  signal?: AbortSignal;
}

const MAX_DOWNLOAD_BYTES = 512 * 1024;

export class HarnessRouterClient {
  private readonly base: URL;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private uhpVersion?: string;

  constructor(opts: HarnessRouterClientOptions) {
    this.base = validateBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.uhpVersion = opts.uhpVersion;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
  }

  private get secrets(): string[] {
    return this.apiKey ? [this.apiKey] : [];
  }

  private requireKey(): string {
    if (!this.apiKey) {
      throw new HarnessRouterError(401, "authentication_error", "missing_credential", "HR_API_KEY is not configured on the server");
    }
    return this.apiKey;
  }

  /** GET /v1/uhp — needs no key. Returns the version to send in `UHP-Version`. */
  async discoverProtocolVersion(): Promise<string | undefined> {
    if (this.uhpVersion) return this.uhpVersion;
    const res = await this.raw("GET", "/v1/uhp", { auth: false });
    const parsed = uhpDiscoverySchema.safeParse(await res.json());
    if (!parsed.success) return undefined;
    this.uhpVersion = parsed.data.version_to_send ?? parsed.data.default_version;
    return this.uhpVersion;
  }

  async listHarnesses(): Promise<HarnessSummary[]> {
    const res = await this.raw("GET", "/v1/harnesses");
    return harnessListSchema.parse(await res.json()).harnesses;
  }

  async uploadFile(filename: string, content: string): Promise<string> {
    const form = new FormData();
    form.set("purpose", "user_data");
    form.set("file", new Blob([content], { type: "text/plain" }), filename);
    const res = await this.raw("POST", "/v1/files", { body: form });
    return assertSafeId(uploadedFileSchema.parse(await res.json()).id, "file id");
  }

  /** Starts a streamed task and yields normalized events until the stream closes. */
  async *streamResponse(params: CreateResponseParams): AsyncGenerator<AgentStreamEvent> {
    const body: Record<string, unknown> = {
      input: params.input,
      stream: true,
      metadata: { harness_id: params.harnessId },
    };
    if (params.model) body.model = params.model;
    if (params.timeoutSeconds) body.timeout_seconds = params.timeoutSeconds;
    if (params.maxCostUsd) body.max_cost_usd = params.maxCostUsd;

    const res = await this.raw("POST", "/v1/responses", {
      json: body,
      headers: { "Idempotency-Key": params.idempotencyKey, Accept: "text/event-stream" },
      signal: params.signal,
      // Streams are long-lived; the orchestrator owns the overall run timeout.
      noTimeout: true,
    });
    if (!res.body) throw new HarnessRouterError(502, "server_error", "empty_stream", "Response had no body");
    for await (const raw of readSseStream(res.body)) {
      const normalized = normalizeStreamEvent(raw);
      if (normalized) yield normalized;
    }
  }

  async getResponse(responseId: string): Promise<ResponseObject> {
    const id = assertSafeId(responseId, "response id");
    const res = await this.raw("GET", `/v1/responses/${encodeURIComponent(id)}`);
    return responseObjectSchema.parse(await res.json());
  }

  /** Idempotent per docs: repeating the call is safe. */
  async cancelResponse(responseId: string): Promise<void> {
    const id = assertSafeId(responseId, "response id");
    await this.raw("POST", `/v1/responses/${encodeURIComponent(id)}/cancel`);
  }

  async getSession(sessionId: string): Promise<SessionObject> {
    const id = assertSafeId(sessionId, "session id");
    const res = await this.raw("GET", `/v1/sessions/${encodeURIComponent(id)}`);
    return sessionSchema.parse(await res.json());
  }

  async listChangedFiles(sessionId: string): Promise<SessionFile[]> {
    const id = assertSafeId(sessionId, "session id");
    const res = await this.raw("GET", `/v1/sessions/${encodeURIComponent(id)}/files`, { query: { changed: "true" } });
    return sessionFilesSchema.parse(await res.json()).files;
  }

  /**
   * Downloads a produced file. The URL is rebuilt from validated ids against the configured
   * base — the provider's `download_url` is never followed (SSRF protection).
   */
  async downloadFileText(containerId: string, fileId: string): Promise<string> {
    const cid = assertSafeId(containerId, "container id");
    const fid = assertSafeId(fileId, "file id");
    const res = await this.raw("GET", `/v1/containers/${encodeURIComponent(cid)}/files/${encodeURIComponent(fid)}/content`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_DOWNLOAD_BYTES) {
      throw new HarnessRouterError(413, "invalid_request_error", "artifact_too_large", "Artifact exceeds the download limit");
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new HarnessRouterError(413, "invalid_request_error", "artifact_too_large", "Artifact exceeds the download limit");
    }
    return new TextDecoder().decode(buf);
  }

  private async raw(
    method: "GET" | "POST",
    path: string,
    opts: {
      auth?: boolean;
      json?: unknown;
      body?: FormData;
      headers?: Record<string, string>;
      query?: Record<string, string>;
      signal?: AbortSignal;
      noTimeout?: boolean;
    } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.auth !== false) {
      headers.Authorization = `Bearer ${this.requireKey()}`;
      const version = await this.discoverProtocolVersion();
      if (version) headers["UHP-Version"] = version;
    }
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.body) {
      body = opts.body;
    }

    const signals: AbortSignal[] = [];
    if (opts.signal) signals.push(opts.signal);
    if (!opts.noTimeout) signals.push(AbortSignal.timeout(this.requestTimeoutMs));

    let res: Response;
    try {
      res = await this.fetchImpl(buildProviderUrl(this.base, path, opts.query), {
        method,
        headers,
        body,
        signal: signals.length ? AbortSignal.any(signals) : undefined,
        redirect: "error",
        cache: "no-store",
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) throw err;
      throw new HarnessRouterError(0, "network_error", "network_error", "Could not reach HarnessRouter");
    }
    if (!res.ok) throw await errorFromResponse(res, this.secrets);
    return res;
  }
}

/** Maps documented UHP stream events onto the app's normalized event model. */
export function normalizeStreamEvent(ev: RawStreamEvent): AgentStreamEvent | undefined {
  const raw = ev.type;
  switch (ev.type) {
    case "response.created":
    case "response.in_progress": {
      const r = responseObjectSchema.partial({ output: true }).safeParse(ev.response);
      if (!r.success) return undefined;
      if (ev.type === "response.in_progress") return { kind: "progress", message: "Agent is working", raw };
      return { kind: "created", responseId: r.data.id, sessionId: r.data.metadata?.session_id, raw };
    }
    case "response.output_item.added": {
      const item = ev.item as { type?: unknown; name?: unknown } | undefined;
      if (item?.type === "function_call" && typeof item.name === "string") {
        return { kind: "tool", name: item.name.slice(0, 100), raw };
      }
      if (typeof item?.type === "string") return { kind: "progress", message: `Started ${item.type.replace(/_/g, " ")}`, raw };
      return undefined;
    }
    case "response.output_text.delta":
      return typeof ev.delta === "string" ? { kind: "text_delta", delta: ev.delta, raw } : undefined;
    case "response.completed":
    case "response.incomplete":
    case "response.failed": {
      const parsed = responseObjectSchema.safeParse(ev.response);
      const response = parsed.success ? parsed.data : undefined;
      let status: "completed" | "incomplete" | "failed" | "cancelled" =
        ev.type === "response.completed" ? "completed" : ev.type === "response.incomplete" ? "incomplete" : "failed";
      // Documented: a cancelled task ends with response.failed whose response.status is "cancelled".
      if (ev.type === "response.failed" && response?.status === "cancelled") status = "cancelled";
      const reason = response?.incomplete_details?.reason ?? response?.error?.code;
      return { kind: "terminal", status, response, reason, raw };
    }
    default:
      return undefined;
  }
}

/** The answer is the output_text of the last `message` item in the terminal response (documented). */
export function extractFinalText(response: ResponseObject | undefined): string | undefined {
  if (!response) return undefined;
  const messages = response.output.filter((o) => o.type === "message");
  const last = messages[messages.length - 1];
  if (!last?.content) return undefined;
  const text = last.content
    .filter((c) => c.type === "output_text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("");
  return text || undefined;
}

export function parseSpendUsd(session: SessionObject): number | undefined {
  const v = session.spend_usd;
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
